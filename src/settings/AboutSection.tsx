// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { ChevronRight, ExternalLink } from "lucide-react";
import { useRef, useState } from "react";
import { openUrl, toWireError, type Settings } from "../ipc";
import { errorText } from "../ops/error-text";
import { Modal } from "../ops/Modal";
import { LICENCE_TEXT } from "./licence";
import { Group, Row, RowButton } from "./settings-ui";
import { VERSION_LABEL } from "./version";

// About: the version label, what Kern does with the network (nothing: Kern has no network code,
// its dependencies are checked for none and its window allows no remote origin), the licence,
// whose full text opens in a dialog, and links to kernkraft (the core Kern is built on: formats,
// PDF, file operations), to Kern's own source and to the Android app. A link
// is opened by the default application for https links (kernkraft open_url, with the terminal
// the settings name for a browser that needs one); Kern itself connects to nothing.

const KERNKRAFT_URL = "https://github.com/verycareful/kernkraft";
const SOURCE_URL = "https://github.com/verycareful/kern-desktop";
const ANDROID_URL = "https://github.com/verycareful/kern";
/** The licence by its SPDX short name: the GNU AGPL, version 3. */
const LICENCE_NAME = "AGPL-3.0";

/** The address without its scheme, as the row shows it. */
const shortUrl = (url: string) => url.replace(/^https:\/\//, "");

function LicenceDialog(props: { close(): void }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const title = "GNU Affero General Public License, version 3";
  return (
    <Modal
      role="dialog"
      label={title}
      onEscape={props.close}
      initialFocus={closeButton}
      className="kern-settings-licence-dialog"
      testId="licence-dialog"
    >
      <h2 className="kern-modal-title">{title}</h2>
      <pre className="kern-settings-licence" data-testid="licence-text">
        {LICENCE_TEXT}
      </pre>
      <div className="kern-modal-actions">
        <button ref={closeButton} type="button" className="kern-button" onClick={props.close}>
          Close
        </button>
      </div>
    </Modal>
  );
}

export function AboutSection(props: { settings: Settings }) {
  const [error, setError] = useState<string | null>(null);
  const [licence, setLicence] = useState(false);
  const terminal = props.settings.terminal;

  const open = async (url: string) => {
    setError(null);
    try {
      await openUrl(url, terminal ?? undefined);
    } catch (e) {
      setError(`${url} could not be opened: ${errorText(toWireError(e))}`);
    }
  };

  const external = <ExternalLink size={16} aria-hidden />;

  return (
    <>
      <Group rows={["version", "network", "licence", "kernkraft", "source", "android"]}>
        <Row id="version" note="Alpha">
          <span className="kern-settings-meta" data-testid="about-version">
            {VERSION_LABEL}
          </span>
        </Row>
        <Row
          id="network"
          note="Kern opens no network connection. It has no accounts, no sync, no updates and no analytics: what it reads and writes stays on this computer."
        />
        <RowButton
          id="licence"
          note="Free software under the GNU Affero General Public License, version 3 or later. Copyright 2026 Sricharan Suresh."
          trail={
            <>
              <span className="kern-settings-meta">{LICENCE_NAME}</span>
              <ChevronRight size={16} aria-hidden />
            </>
          }
          onPress={() => setLicence(true)}
        />
        <RowButton
          id="kernkraft"
          note={`The core Kern is built on: formats, PDF and file operations. ${shortUrl(KERNKRAFT_URL)}`}
          trail={external}
          onPress={() => void open(KERNKRAFT_URL)}
        />
        <RowButton
          id="source"
          note={shortUrl(SOURCE_URL)}
          trail={external}
          onPress={() => void open(SOURCE_URL)}
        />
        <RowButton
          id="android"
          note={shortUrl(ANDROID_URL)}
          trail={external}
          onPress={() => void open(ANDROID_URL)}
        />
      </Group>
      {error && (
        <p role="alert" className="kern-modal-error">
          {error}
        </p>
      )}
      {licence && <LicenceDialog close={() => setLicence(false)} />}
    </>
  );
}
