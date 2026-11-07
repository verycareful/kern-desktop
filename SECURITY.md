# Security Policy

## Reporting a vulnerability

Report it privately through GitHub: open the repository's **Security** tab and choose
**Report a vulnerability**, or go to
<https://github.com/verycareful/kern-desktop/security/advisories/new>. Do not open a
public issue, pull request or discussion about it.

Include the Kern version (Settings > About > Version), how you installed it, your
distribution, and the steps or the file that triggers the problem.

Kern is maintained by one person. I aim to acknowledge a report within 7 days, and I
cannot promise a date for the fix. Once it is fixed I publish a GitHub security
advisory, crediting you if you want to be named.

## What counts

Kern opens files from anywhere on the disk, and it promises never to touch the
network. Examples of what to report:

- any network connection made by Kern;
- a file name, folder name or document that runs script in Kern's window, or makes
  Kern run a command the user did not ask for (including through desktop-entry
  launching);
- a way for another process to use Kern's D-Bus `Open` call to make Kern read,
  overwrite or delete a file the user did not open;
- a way to make the install script or the release packages install something other
  than the published build;
- Kern reading or writing outside what the user opened or asked for, for example
  through a symbolic link.

A crash on a malformed file with no further effect is a bug: report it with the bug
report form. So is a file lost or changed on save, unless a crafted file can trigger it
from outside, in which case report it privately.

## Out of scope

- An attacker who can already run code as the user. Kern runs with the user's own
  permissions and is not a sandbox.
- Bugs in WebKitGTK, Tauri or another dependency. Report them upstream. A note to me
  is welcome if you think Kern is exposed.

## Supported versions

Kern is in alpha. Fixes go into the latest release only.
