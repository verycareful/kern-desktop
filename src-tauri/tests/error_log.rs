// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! The error log (`error_log.rs`): its time stamps, one line for each entry whatever the message
//! holds, the cut of a long message, rotation at the size limit, and appends from many threads.

use std::fs;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use kern_lib::error_log::{
    entry, stamp, ErrorLog, LOG_FILE, MAX_LOG_BYTES, MAX_MESSAGE_CHARS, ROTATED_FILE,
};

const DAY: u64 = 86_400;

fn at(secs: u64) -> SystemTime {
    UNIX_EPOCH + Duration::from_secs(secs)
}

#[test]
fn the_epoch_is_the_first_second_of_1970() {
    assert_eq!(stamp(UNIX_EPOCH), "1970-01-01T00:00:00Z");
}

#[test]
fn a_time_before_1970_is_written_as_the_epoch() {
    assert_eq!(
        stamp(UNIX_EPOCH - Duration::from_secs(1)),
        "1970-01-01T00:00:00Z"
    );
}

#[test]
fn a_billion_seconds_is_the_known_instant() {
    // 10^9 s after the epoch: 2001-09-09 01:46:40 UTC (a date every Unix reference gives).
    assert_eq!(stamp(at(1_000_000_000)), "2001-09-09T01:46:40Z");
}

#[test]
fn the_leap_day_of_2000_exists_and_the_one_of_2100_does_not() {
    // 2000-03-01 is 951 868 800 s after the epoch, so the day before it is 29 February.
    assert_eq!(stamp(at(951_868_800 - DAY)), "2000-02-29T00:00:00Z");
    // 2100-01-01 is 4 102 444 800 s; 2100 is not a leap year, so 59 days on is 1 March.
    assert_eq!(stamp(at(4_102_444_800)), "2100-01-01T00:00:00Z");
    assert_eq!(stamp(at(4_102_444_800 + 59 * DAY)), "2100-03-01T00:00:00Z");
}

#[test]
fn the_last_second_of_a_year_does_not_belong_to_the_next() {
    assert_eq!(stamp(at(951_868_800 - 1)), "2000-02-29T23:59:59Z");
    // 2001-01-01 is 978 307 200 s after the epoch.
    assert_eq!(stamp(at(978_307_200 - 1)), "2000-12-31T23:59:59Z");
    assert_eq!(stamp(at(978_307_200)), "2001-01-01T00:00:00Z");
}

#[test]
fn an_entry_is_one_line_with_time_source_and_message() {
    assert_eq!(
        entry(UNIX_EPOCH, "open", "report.xyz was not opened"),
        "1970-01-01T00:00:00Z [open] report.xyz was not opened\n"
    );
}

#[test]
fn a_newline_or_control_character_in_a_message_is_written_as_its_escape() {
    let line = entry(UNIX_EPOCH, "tree", "a\nb\r\tc\u{1b}d");
    assert_eq!(line, "1970-01-01T00:00:00Z [tree] a\\nb\\r\\tc\\u{1b}d\n");
    assert_eq!(line.matches('\n').count(), 1, "only the line's own end");
}

#[test]
fn a_message_that_is_not_ascii_is_kept_as_it_is() {
    assert!(entry(UNIX_EPOCH, "open", "caf\u{e9} \u{65e5}\u{672c}")
        .contains("caf\u{e9} \u{65e5}\u{672c}"));
}

#[test]
fn a_message_over_the_limit_is_cut_and_says_so() {
    let long = "x".repeat(MAX_MESSAGE_CHARS + 10);
    let line = entry(UNIX_EPOCH, "open", &long);
    assert!(line.ends_with("...(cut)\n"));
    let message = line.split("] ").nth(1).unwrap().trim_end_matches('\n');
    assert_eq!(
        message.chars().filter(|c| *c == 'x').count(),
        MAX_MESSAGE_CHARS
    );
    // Exactly at the limit nothing is cut.
    let exact = entry(UNIX_EPOCH, "open", &"y".repeat(MAX_MESSAGE_CHARS));
    assert!(!exact.contains("(cut)"));
}

#[test]
fn appending_creates_the_folder_and_keeps_every_line_in_order() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("state").join("kern");
    let log = ErrorLog::new(dir.clone());
    log.append_at(at(0), "open", "first").unwrap();
    log.append_at(at(DAY), "tree", "second").unwrap();
    assert_eq!(
        fs::read_to_string(dir.join(LOG_FILE)).unwrap(),
        "1970-01-01T00:00:00Z [open] first\n1970-01-02T00:00:00Z [tree] second\n"
    );
    assert_eq!(log.path(), dir.join(LOG_FILE));
}

#[test]
fn a_full_log_moves_to_the_rotated_file_and_a_new_one_starts() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().to_path_buf();
    let full = vec![b'o'; usize::try_from(MAX_LOG_BYTES).unwrap()];
    fs::write(dir.join(LOG_FILE), &full).unwrap();
    let log = ErrorLog::new(dir.clone());
    log.append_at(at(0), "open", "after").unwrap();
    assert_eq!(fs::read(dir.join(ROTATED_FILE)).unwrap(), full);
    assert_eq!(
        fs::read_to_string(dir.join(LOG_FILE)).unwrap(),
        "1970-01-01T00:00:00Z [open] after\n"
    );
}

#[test]
fn a_log_one_byte_short_of_the_limit_is_not_rotated() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().to_path_buf();
    fs::write(
        dir.join(LOG_FILE),
        vec![b'o'; usize::try_from(MAX_LOG_BYTES).unwrap() - 1],
    )
    .unwrap();
    ErrorLog::new(dir.clone())
        .append_at(at(0), "open", "x")
        .unwrap();
    assert!(!dir.join(ROTATED_FILE).exists());
}

#[test]
fn a_second_rotation_replaces_the_first_rotated_file() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().to_path_buf();
    fs::write(dir.join(ROTATED_FILE), "the oldest").unwrap();
    fs::write(
        dir.join(LOG_FILE),
        vec![b'n'; usize::try_from(MAX_LOG_BYTES).unwrap()],
    )
    .unwrap();
    ErrorLog::new(dir.clone())
        .append_at(at(0), "open", "x")
        .unwrap();
    let rotated = fs::read(dir.join(ROTATED_FILE)).unwrap();
    assert_eq!(rotated.len(), usize::try_from(MAX_LOG_BYTES).unwrap());
    assert!(rotated.iter().all(|b| *b == b'n'));
}

#[test]
fn a_write_that_cannot_be_made_is_an_error_not_silence() {
    let tmp = tempfile::tempdir().unwrap();
    // The log's folder is a file, so it can be neither created nor written into.
    let blocker = tmp.path().join("kern");
    fs::write(&blocker, "not a folder").unwrap();
    let log = ErrorLog::new(blocker);
    assert!(log.append_at(at(0), "open", "x").is_err());
}

#[test]
fn appends_from_many_threads_are_all_whole_lines() {
    let tmp = tempfile::tempdir().unwrap();
    let log = Arc::new(ErrorLog::new(tmp.path().to_path_buf()));
    let (threads, each) = (8_usize, 50_usize);
    let handles: Vec<_> = (0..threads)
        .map(|t| {
            let log = Arc::clone(&log);
            thread::spawn(move || {
                for n in 0..each {
                    log.append_at(at(0), "thread", &format!("t{t} n{n}"))
                        .unwrap();
                }
            })
        })
        .collect();
    for h in handles {
        h.join().unwrap();
    }
    let text = fs::read_to_string(tmp.path().join(LOG_FILE)).unwrap();
    let lines: Vec<&str> = text.lines().collect();
    assert_eq!(lines.len(), threads * each);
    assert!(lines
        .iter()
        .all(|l| l.starts_with("1970-01-01T00:00:00Z [thread] t") && l.contains(" n")));
}
