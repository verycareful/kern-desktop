// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! One running Kern per login session, and forwarding to it.
//!
//! The running instance owns the well-known name [`BUS_NAME`] on the session
//! bus (D-Bus Specification, "Message Bus Names": a name requested with
//! `DoNotQueue` fails at once when taken) and serves [`INTERFACE`] at
//! [`OBJECT_PATH`]. A second launch calls `Open(aay argv, ay cwd, s
//! activation_token)` on it and exits. Arguments and working directory go as
//! raw byte arrays so a non-UTF-8 file name survives; the activation token
//! (xdg-activation-v1, from `XDG_ACTIVATION_TOKEN`) lets the compositor
//! raise the window. Connections come from `kernkraft-bus`, which opens the
//! bus over its Unix socket only.

use std::ffi::OsString;
use std::os::unix::ffi::{OsStrExt, OsStringExt};
use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex, PoisonError};

use kernkraft_bus::BusError;
use zbus::blocking::Connection;
use zbus::fdo::RequestNameFlags;
use zbus::fdo::RequestNameReply;

pub const BUS_NAME: &str = "io.github.verycareful.kern";
pub const OBJECT_PATH: &str = "/io/github/verycareful/kern";
pub const INTERFACE: &str = "io.github.verycareful.Kern1";
pub const METHOD_OPEN: &str = "Open";

/// One forwarded launch.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Invocation {
    /// The arguments after the program name.
    pub argv: Vec<OsString>,
    pub cwd: PathBuf,
    /// Empty when the launcher had none.
    pub activation_token: String,
}

#[derive(Debug, thiserror::Error)]
pub enum InstanceError {
    #[error(transparent)]
    Bus(#[from] BusError),
    #[error("D-Bus: {0}")]
    Zbus(#[from] zbus::Error),
}

/// Raw bytes of each argument, for the wire.
pub fn pack_args(argv: &[OsString]) -> Vec<Vec<u8>> {
    argv.iter().map(|a| a.as_bytes().to_vec()).collect()
}

/// The inverse of [`pack_args`] and of the cwd packing.
pub fn unpack(argv: Vec<Vec<u8>>, cwd: Vec<u8>, activation_token: String) -> Invocation {
    Invocation {
        argv: argv.into_iter().map(OsString::from_vec).collect(),
        cwd: PathBuf::from(OsString::from_vec(cwd)),
        activation_token,
    }
}

/// Launches this instance has accepted and not yet finished handling: each
/// `Open` answered on the bus, and the process's own. The application does
/// not exit while one is pending, since the launcher was told it is taken.
#[derive(Clone, Debug, Default)]
pub struct Launches(Arc<Mutex<LaunchCount>>);

#[derive(Debug, Default)]
struct LaunchCount {
    pending: usize,
    /// The application agreed to exit; no launch is accepted after that.
    closing: bool,
}

impl Launches {
    fn lock(&self) -> std::sync::MutexGuard<'_, LaunchCount> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Counts a launch in. False once the application has agreed to exit:
    /// the launch must then be refused, not accepted and dropped.
    pub fn begin(&self) -> bool {
        let mut c = self.lock();
        if c.closing {
            return false;
        }
        c.pending += 1;
        true
    }

    /// Counts a handled launch out and returns how many remain.
    pub fn finish(&self) -> usize {
        let mut c = self.lock();
        c.pending = c.pending.saturating_sub(1);
        c.pending
    }

    pub fn pending(&self) -> usize {
        self.lock().pending
    }

    /// The application is asked to exit. True allows it, and from then on
    /// every launch is refused; false defers it until the pending launches
    /// are handled.
    pub fn exit_requested(&self) -> bool {
        let mut c = self.lock();
        if may_exit(c.pending) {
            c.closing = true;
            true
        } else {
            false
        }
    }
}

/// Whether a request to exit may go ahead: only with no launch pending.
pub fn may_exit(pending: usize) -> bool {
    pending == 0
}

/// Whether the application should exit now that a launch is handled: no
/// launch is left and none of them left a window.
pub fn exit_when_drained(pending: usize, windows: usize) -> bool {
    pending == 0 && windows == 0
}

struct Kern1 {
    tx: Sender<Invocation>,
    launches: Launches,
}

#[zbus::interface(name = "io.github.verycareful.Kern1")]
impl Kern1 {
    /// Hands a launch to the running instance. It is counted as pending
    /// before the caller gets its answer, so the instance does not exit
    /// under it. An instance that is exiting refuses it, and the caller
    /// reports that instead of taking the launch for handled.
    fn open(
        &self,
        argv: Vec<Vec<u8>>,
        cwd: Vec<u8>,
        activation_token: String,
    ) -> zbus::fdo::Result<()> {
        if !self.launches.begin() {
            return Err(exiting());
        }
        if self.tx.send(unpack(argv, cwd, activation_token)).is_err() {
            self.launches.finish();
            return Err(exiting());
        }
        Ok(())
    }
}

pub(crate) fn exiting() -> zbus::fdo::Error {
    zbus::fdo::Error::Failed("Kern is exiting; launch it again".to_owned())
}

/// The outcome of asking for the name.
pub enum Claim {
    /// This process owns the name; launches arrive on the receiver.
    Owner(Receiver<Invocation>),
    /// Another instance owns it.
    Taken,
}

/// Serves [`INTERFACE`] on `conn`, then requests `name` without queueing.
/// The object is served first so that a caller that sees the name finds it.
pub fn claim(conn: &Connection, name: &str, launches: Launches) -> Result<Claim, InstanceError> {
    let (tx, rx) = mpsc::channel();
    conn.object_server()
        .at(OBJECT_PATH, Kern1 { tx, launches })?;
    match conn.request_name_with_flags(name, RequestNameFlags::DoNotQueue.into()) {
        Ok(RequestNameReply::PrimaryOwner | RequestNameReply::AlreadyOwner) => Ok(Claim::Owner(rx)),
        Ok(RequestNameReply::Exists | RequestNameReply::InQueue) | Err(zbus::Error::NameTaken) => {
            // Nothing will be called on this connection; remove the object
            // so it does not answer as an instance.
            let _ = conn.object_server().remove::<Kern1, _>(OBJECT_PATH);
            Ok(Claim::Taken)
        }
        Err(e) => Err(e.into()),
    }
}

/// Calls `Open` on the owner of `name`.
pub fn forward(conn: &Connection, name: &str, inv: &Invocation) -> Result<(), InstanceError> {
    conn.call_method(
        Some(name),
        OBJECT_PATH,
        Some(INTERFACE),
        METHOD_OPEN,
        &(
            pack_args(&inv.argv),
            inv.cwd.as_os_str().as_bytes().to_vec(),
            inv.activation_token.as_str(),
        ),
    )?;
    Ok(())
}

/// This process's own launch: its arguments after the program name, its
/// working directory and its activation token.
///
/// The token is taken out of the environment, as xdg-activation asks of the
/// process it was meant for, so a program Kern starts does not inherit it.
/// A working directory that no longer exists is sent empty: the receiver
/// then reports each relative argument and still opens the absolute ones.
pub fn own_invocation() -> Invocation {
    let activation_token = std::env::var("XDG_ACTIVATION_TOKEN").unwrap_or_default();
    std::env::remove_var("XDG_ACTIVATION_TOKEN");
    Invocation {
        argv: std::env::args_os().skip(1).collect(),
        cwd: std::env::current_dir().unwrap_or_default(),
        activation_token,
    }
}

/// What startup found.
pub enum Role {
    /// This process is the instance. `connection` stays in app state for
    /// the services that share it.
    Owner {
        connection: Connection,
        launches: Receiver<Invocation>,
    },
    /// No session bus, or it failed: run without forwarding.
    Standalone,
}

/// Connects, claims the name, and either becomes the instance, forwards this
/// launch to the existing one and exits, or runs standalone. Call before
/// anything creates a window.
///
/// A failed forward exits non-zero with the reason on stderr; no bus prints
/// the reason and returns [`Role::Standalone`].
pub fn start(own: &Invocation, launches: Launches) -> Role {
    let conn = match kernkraft_bus::session() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("kern: no session bus, running as a standalone instance: {e}");
            return Role::Standalone;
        }
    };
    match claim(&conn, BUS_NAME, launches) {
        Ok(Claim::Owner(launches)) => Role::Owner {
            connection: conn,
            launches,
        },
        Ok(Claim::Taken) => {
            let result = forward(&conn, BUS_NAME, own);
            match result {
                Ok(()) => std::process::exit(0),
                Err(e) => {
                    eprintln!(
                        "kern: another instance is running but would not take this launch: {e}"
                    );
                    std::process::exit(1);
                }
            }
        }
        Err(e) => {
            eprintln!("kern: claiming {BUS_NAME} failed, running as a standalone instance: {e}");
            Role::Standalone
        }
    }
}

/// The session-bus connection, in app state, for services that share it.
pub struct BusState(pub Option<Connection>);
