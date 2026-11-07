// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! The error log: one line for each error Kern shows, each Rust panic and each time a window's
//! web process ends, in `kern.log` under `$XDG_STATE_HOME/kern/` beside the other state files
//! (XDG Base Directory Specification 0.8). It is a plain local file and nothing reads it but the
//! user; nothing leaves the machine.
//!
//! A line is `<UTC time> [<source>] <message>`, the message on one line (a newline or other
//! control character is written as its escape). The file is moved to `kern.log.1` when it reaches
//! [`MAX_LOG_BYTES`], replacing the one before, so the log never takes more than twice that.
//! A write that fails is said on standard error with the entry it could not keep, never dropped.
//!
//! The time is UTC from `std::time`; the date follows Howard Hinnant's `civil_from_days`
//! (<https://howardhinnant.github.io/date_algorithms.html>), whose constants are used as given.

use std::collections::BTreeSet;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock, PoisonError};
use std::time::{SystemTime, UNIX_EPOCH};

use kernkraft_fs::base_dirs;
use kernkraft_tauri::WireError;
use tauri::{Runtime, Webview};

use crate::store::APP_DIR;

/// The log file, in the state directory's `kern` folder.
pub const LOG_FILE: &str = "kern.log";
/// Where the log goes when it is full.
pub const ROTATED_FILE: &str = "kern.log.1";
/// A log this long is rotated before the next line is added: 1 MiB keeps some thousands of lines
/// and bounds the disk use at twice that.
pub const MAX_LOG_BYTES: u64 = 1024 * 1024;
/// The longest message kept, in characters. A longer one is cut and says so.
pub const MAX_MESSAGE_CHARS: usize = 4096;
/// The longest source name kept, in characters.
pub const MAX_SOURCE_CHARS: usize = 32;
/// What a cut message ends with.
const CUT: &str = "...(cut)";

const SECS_PER_MINUTE: u64 = 60;
const SECS_PER_HOUR: u64 = 60 * SECS_PER_MINUTE;
const SECS_PER_DAY: u64 = 24 * SECS_PER_HOUR;
/// Days from 0000-03-01 to 1970-01-01 (civil_from_days).
const DAYS_TO_EPOCH: i64 = 719_468;
/// Days in a 400-year era of the Gregorian calendar (civil_from_days).
const DAYS_PER_ERA: i64 = 146_097;

/// The date of `days` days after 1970-01-01, as (year, month 1 to 12, day 1 to 31).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + DAYS_TO_EPOCH;
    let era = z.div_euclid(DAYS_PER_ERA);
    let doe = z.rem_euclid(DAYS_PER_ERA);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    // `day` and `month` are in 1..=31 and 1..=12 by construction.
    (year, month as u32, day as u32)
}

/// `at` as `YYYY-MM-DDTHH:MM:SSZ` in UTC; a time before 1970 is written as 1970-01-01.
pub fn stamp(at: SystemTime) -> String {
    let secs = at.duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs());
    let (days, rest) = (secs / SECS_PER_DAY, secs % SECS_PER_DAY);
    // `days` is at most u64::MAX / 86400, far inside i64.
    let (year, month, day) = civil_from_days(days as i64);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rest / SECS_PER_HOUR,
        rest % SECS_PER_HOUR / SECS_PER_MINUTE,
        rest % SECS_PER_MINUTE
    )
}

/// `text` on one line: control characters (a newline among them) written as their escapes, and
/// cut after `max` characters.
fn one_line(text: &str, max: usize) -> String {
    let mut out = String::new();
    for (n, c) in text.chars().enumerate() {
        if n == max {
            out.push_str(CUT);
            break;
        }
        if c.is_control() {
            out.extend(c.escape_default());
        } else {
            out.push(c);
        }
    }
    out
}

/// One log line, newline included.
pub fn entry(at: SystemTime, source: &str, message: &str) -> String {
    format!(
        "{} [{}] {}\n",
        stamp(at),
        one_line(source, MAX_SOURCE_CHARS),
        one_line(message, MAX_MESSAGE_CHARS)
    )
}

/// A log file in one folder. Appends from any thread are serialised.
pub struct ErrorLog {
    dir: PathBuf,
    write: Mutex<()>,
}

impl ErrorLog {
    /// A log under `dir`, which is created with the first line.
    pub fn new(dir: PathBuf) -> ErrorLog {
        ErrorLog {
            dir,
            write: Mutex::new(()),
        }
    }

    pub fn path(&self) -> PathBuf {
        self.dir.join(LOG_FILE)
    }

    /// Adds a line stamped with the time now.
    pub fn append(&self, source: &str, message: &str) -> io::Result<()> {
        self.append_at(SystemTime::now(), source, message)
    }

    /// Adds a line stamped with `at`.
    pub fn append_at(&self, at: SystemTime, source: &str, message: &str) -> io::Result<()> {
        // A panic while another thread held the lock leaves nothing half-written that a later
        // append could trip on: each append opens the file afresh.
        let _guard = self.write.lock().unwrap_or_else(PoisonError::into_inner);
        fs::create_dir_all(&self.dir)?;
        let file = self.path();
        if fs::metadata(&file).is_ok_and(|m| m.len() >= MAX_LOG_BYTES) {
            fs::rename(&file, self.dir.join(ROTATED_FILE))?;
        }
        let mut f = OpenOptions::new().create(true).append(true).open(&file)?;
        f.write_all(entry(at, source, message).as_bytes())
    }
}

/// The log of this process, set once at startup.
static LOG: OnceLock<ErrorLog> = OnceLock::new();

/// Starts the process's log under the user's state directory. An `Err` says why there is none:
/// `HOME` is not an absolute path, so the state directory is unknown.
pub fn init_from_env() -> Result<(), String> {
    let base = base_dirs().ok_or_else(|| {
        "HOME is not set to an absolute path; the error log directory is unknown".to_owned()
    })?;
    init_at(base.state.join(APP_DIR));
    Ok(())
}

/// Starts the process's log under `dir`. False when it was already started, and then the first
/// directory stays.
pub fn init_at(dir: PathBuf) -> bool {
    LOG.set(ErrorLog::new(dir)).is_ok()
}

/// Adds a line from Rust. A line that cannot be kept (no log, or a write that failed) is said on
/// standard error with the reason.
pub fn record(source: &str, message: &str) {
    match LOG.get() {
        Some(log) => {
            if let Err(e) = log.append(source, message) {
                eprintln!(
                    "kern: could not write the error log {}: {e}",
                    log.path().display()
                );
                eprintln!("kern: [{source}] {message}");
            }
        }
        None => eprintln!("kern: [{source}] {message}"),
    }
}

/// The frontend's errors: what a window showed the user, under a short source name (`open`,
/// `tree`, ...). Refused with the reason when the log cannot be written, so the window can say so.
#[tauri::command]
pub fn log_error(source: String, message: String) -> Result<(), WireError> {
    let Some(log) = LOG.get() else {
        return Err(WireError {
            kind: "NoLog".to_owned(),
            message: "there is no error log, since the state directory is unknown".to_owned(),
            path: None,
            details: None,
        });
    };
    log.append(&source, &message).map_err(|e| WireError {
        kind: "LogWrite".to_owned(),
        message: format!("{}: {e}", log.path().display()),
        path: None,
        details: None,
    })
}

/// Logs every panic, from any thread, then runs the hook that was there.
pub fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let thread = std::thread::current();
        record(
            "panic",
            &format!("thread {}: {info}", thread.name().unwrap_or("unnamed")),
        );
        previous(info);
    }));
}

/// The windows whose web process is being watched, by label.
static WATCHED: Mutex<BTreeSet<String>> = Mutex::new(BTreeSet::new());

/// Logs when the web process of this webview ends without the webview being closed, with the
/// reason WebKit gives (a crash, or the process going over its memory limit). WebKitGTK sends
/// `web-process-terminated` and, with nothing listening, leaves the view blank. Calling it again
/// for a webview already watched does nothing.
pub fn watch_web_process<R: Runtime>(webview: &Webview<R>) {
    let label = webview.label().to_owned();
    let first = WATCHED
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .insert(label.clone());
    if !first {
        return;
    }
    let name = label.clone();
    let hooked = webview.with_webview(move |platform| {
        use webkit2gtk::WebViewExt;
        platform
            .inner()
            .connect_web_process_terminated(move |_, reason| {
                record(
                    "web-process",
                    &format!("the web process of window {name} ended: {reason:?}"),
                );
            });
    });
    if let Err(e) = hooked {
        forget_webview(&label);
        record(
            "web-process",
            &format!("could not watch the web process of window {label}: {e}"),
        );
    }
}

/// The window `label` is closed: its webview is watched again if a window of that name opens.
pub fn forget_webview(label: &str) {
    WATCHED
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .remove(label);
}
