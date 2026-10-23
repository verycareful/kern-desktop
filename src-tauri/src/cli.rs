// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! Command-line arguments as paths.
//!
//! The arguments are the ones after the program name, as raw bytes: a file
//! name need not be UTF-8 and must reach the router unchanged. The desktop
//! entry's `%F` (Desktop Entry Specification 1.5, "The Exec key") arrives
//! as plain paths or, from some file managers, as `file:` URIs (RFC 8089,
//! sections 2 and 3: an authority that is empty or `localhost`, a path, and
//! `%XX` escapes decoded as bytes per RFC 3986, section 2.1). A relative
//! path is taken against the working directory of the process that was
//! launched, not the running instance's.

use std::ffi::{OsStr, OsString};
use std::fmt;
use std::os::unix::ffi::{OsStrExt, OsStringExt};
use std::path::{Path, PathBuf};

/// An argument that names no usable path. It is reported to the user, never
/// dropped.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ArgError {
    pub arg: OsString,
    pub reason: String,
}

impl fmt::Display for ArgError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {:?}", self.reason, self.arg)
    }
}

/// The paths of a command line, and the arguments that were refused.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ParsedArgs {
    pub paths: Vec<PathBuf>,
    pub errors: Vec<ArgError>,
}

/// What a launch asks for.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Plan {
    /// No arguments (a lone `--` included): the main window, with a Home
    /// folder tab.
    Home,
    /// Open these.
    Open(ParsedArgs),
}

/// Decides what a command line asks for. Every argument but the first `--`
/// gives a path or an error, so a command line that gives neither had no
/// arguments.
pub fn plan(argv: &[OsString], cwd: &Path) -> Plan {
    let parsed = parse_args_report(argv, cwd);
    if parsed.paths.is_empty() && parsed.errors.is_empty() {
        Plan::Home
    } else {
        Plan::Open(parsed)
    }
}

/// The paths of `argv` (the arguments without the program name). Arguments
/// that cannot be paths are left out; [`parse_args_report`] returns them
/// too, and is what the application uses. A lone `--` is skipped.
pub fn parse_args(argv: &[OsString], cwd: &Path) -> Vec<PathBuf> {
    parse_args_report(argv, cwd).paths
}

/// Like [`parse_args`], keeping the refused arguments.
pub fn parse_args_report(argv: &[OsString], cwd: &Path) -> ParsedArgs {
    let mut out = ParsedArgs::default();
    let mut options_ended = false;
    for arg in argv {
        // The first `--` ends the options; a later one is a path.
        if !options_ended && arg.as_bytes() == b"--" {
            options_ended = true;
            continue;
        }
        match one(arg, cwd) {
            Ok(p) => out.paths.push(p),
            Err(reason) => out.errors.push(ArgError {
                arg: arg.clone(),
                reason,
            }),
        }
    }
    out
}

/// The path of a `file://` URI, decoded as for a command-line argument.
/// Only the `file` scheme with an authority part is taken (RFC 8089,
/// section 2): the host must be empty or `localhost`. Anything else, such
/// as `file:/x`, another scheme or a plain path, is refused with the
/// reason.
pub fn file_uri_path(uri: &OsStr) -> Result<PathBuf, String> {
    let bytes = uri.as_bytes();
    if bytes.len() < 7 || !bytes[..7].eq_ignore_ascii_case(b"file://") {
        return Err("not a file:// URI".to_owned());
    }
    let path = PathBuf::from(OsString::from_vec(file_uri(bytes)?));
    if path.as_os_str().as_bytes().contains(&0) {
        return Err("path contains a NUL byte".to_owned());
    }
    Ok(path.components().collect())
}

fn one(arg: &OsStr, cwd: &Path) -> Result<PathBuf, String> {
    let bytes = arg.as_bytes();
    if bytes.is_empty() {
        return Err("empty path".to_owned());
    }
    let path = if has_file_scheme(bytes) {
        PathBuf::from(OsString::from_vec(file_uri(bytes)?))
    } else if Path::new(arg).is_absolute() {
        PathBuf::from(arg)
    } else if cwd.is_absolute() {
        cwd.join(arg)
    } else {
        return Err("relative path, and the launching directory is unknown".to_owned());
    };
    if path.as_os_str().as_bytes().contains(&0) {
        return Err("path contains a NUL byte".to_owned());
    }
    // `.` components go; `..` stays, as resolving it textually would be
    // wrong across a symlink.
    Ok(path.components().collect())
}

fn has_file_scheme(b: &[u8]) -> bool {
    b.len() >= 5 && b[..5].eq_ignore_ascii_case(b"file:")
}

fn file_uri(b: &[u8]) -> Result<Vec<u8>, String> {
    let mut rest = &b[5..];
    if rest.starts_with(b"//") {
        let after = &rest[2..];
        let end = after.iter().position(|&c| c == b'/').unwrap_or(after.len());
        let host = &after[..end];
        if !(host.is_empty() || host.eq_ignore_ascii_case(b"localhost")) {
            return Err(format!(
                "file URI names another host ({}), which cannot be opened",
                String::from_utf8_lossy(host)
            ));
        }
        rest = &after[end..];
    }
    if !rest.starts_with(b"/") {
        return Err("file URI has no absolute path".to_owned());
    }
    // `?` and `#` begin a query and a fragment; a file name holding them
    // has them escaped.
    let end = rest
        .iter()
        .position(|&c| c == b'?' || c == b'#')
        .unwrap_or(rest.len());
    let path = &rest[..end];
    // An escaped `/` is data inside a segment, not a separator (RFC 3986,
    // sections 2.2 and 3.3), and a file name cannot hold one.
    if path
        .split(|&c| c == b'/')
        .any(|seg| percent_decode(seg).contains(&b'/'))
    {
        return Err("file URI has an escaped slash inside a name".to_owned());
    }
    Ok(percent_decode(&remove_dot_segments(path)))
}

/// The segment with each `%2E` or `%2e` as ".".
fn decode_dots(seg: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(seg.len());
    let mut i = 0;
    while i < seg.len() {
        if seg[i..].len() >= 3 && seg[i] == b'%' && seg[i + 1] == b'2' && seg[i + 2] | 0x20 == b'e'
        {
            out.push(b'.');
            i += 3;
        } else {
            out.push(seg[i]);
            i += 1;
        }
    }
    out
}

/// RFC 3986 section 5.2.4 on an absolute path: `.` segments go and `..`
/// removes the segment before it (never the root).
fn remove_dot_segments(path: &[u8]) -> Vec<u8> {
    let mut out: Vec<&[u8]> = Vec::new();
    let mut segs = path.split(|&c| c == b'/').skip(1).peekable();
    let mut trailing = false;
    while let Some(seg) = segs.next() {
        let last = segs.peek().is_none();
        // `%2E` is the unreserved "." (RFC 3986 section 6.2.2.2).
        let plain = decode_dots(seg);
        match plain.as_slice() {
            b"." => trailing = last,
            b".." => {
                out.pop();
                trailing = last;
            }
            _ => {
                out.push(seg);
                trailing = false;
            }
        }
    }
    let mut r = Vec::with_capacity(path.len());
    for s in &out {
        r.push(b'/');
        r.extend_from_slice(s);
    }
    if r.is_empty() || trailing {
        r.push(b'/');
    }
    r
}

/// `%XX` becomes that byte; a `%` not followed by two hex digits stays as it
/// is.
fn percent_decode(b: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        let hex = |c: u8| char::from(c).to_digit(16);
        if b[i] == b'%' {
            if let (Some(h), Some(l)) = (
                b.get(i + 1).copied().and_then(hex),
                b.get(i + 2).copied().and_then(hex),
            ) {
                // Both digits are below 16, so the byte fits.
                out.push((h * 16 + l) as u8);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    out
}
