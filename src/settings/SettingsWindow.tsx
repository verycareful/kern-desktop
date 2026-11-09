// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { restartRequest, toWireError, type Settings } from "../ipc";
import { NO_FILE_KEYS_ATTR } from "../keys/file-keys";
import { errorText } from "../ops/error-text";
import { Modal } from "../ops/Modal";
import { RepeatFlash } from "../ops/repeat-flash";
import { noticesShown, useOps } from "../ops/useOps";
import { KernLogo } from "../shell/KernLogo";
import { setCloseCheck } from "../shell/useCloseGuard";
import { corruptText, useStoreErrors } from "../store/store-errors";
import { AboutSection } from "./AboutSection";
import { AppearanceSection } from "./AppearanceSection";
import { EditorSection } from "./EditorSection";
import { FilesSection } from "./FilesSection";
import { LibrarySection } from "./LibrarySection";
import { isDirty, SETTINGS_FILE, shown, useSettingsDraft } from "./settings-draft";
import { useSettingsNav } from "./settings-nav";
import { CATEGORIES, isCategory, rowsShown, searching, type Category } from "./settings-search";
import { SettingsQuery } from "./settings-query";
import { VERSION_LABEL } from "./version";
// The shared button, banner, modal and logo styles, then the window's own.
import "../files/files.css";
import "../ops/ops.css";
import "../shell/shell.css";
import "./settings.css";

// The Settings window: a sidebar of categories with a search box, the category's rows beside it,
// and a bar at the foot with Save. A change made here is only shown until Save stores it
// (settings-draft.ts); Revert drops it, Ctrl+S saves. Closing with changes not saved asks Save,
// Close without saving or Cancel. A saved change that applies only at start offers Restart Kern,
// which closes every window through its own question and starts Kern again (restart.rs).
//
// Typing in the search box shows every row it finds, under the category each belongs to. The
// window opens at a category when it is asked for one (the logo asks for About), and a
// settings.json Kern could not read is reported here, as it was found.

const SECTIONS: Record<Category, ComponentType<{ settings: Settings }>> = {
  appearance: AppearanceSection,
  files: FilesSection,
  library: LibrarySection,
  editor: EditorSection,
  about: AboutSection,
};

type CloseChoice = "save" | "discard" | "cancel";

function UnsavedPrompt(props: { saving: boolean; answer(choice: CloseChoice): void }) {
  const save = useRef<HTMLButtonElement>(null);
  const title = "Save the changes to the settings before closing?";
  return (
    <Modal
      role="alertdialog"
      label={title}
      onEscape={() => !props.saving && props.answer("cancel")}
      initialFocus={save}
      testId="settings-close-prompt"
    >
      <h2 className="kern-modal-title">{title}</h2>
      <p className="kern-modal-text">Closing without saving loses the changes made here.</p>
      <div className="kern-modal-actions">
        <button
          ref={save}
          type="button"
          className="kern-button"
          disabled={props.saving}
          onClick={() => props.answer("save")}
        >
          Save
        </button>
        <button
          type="button"
          className="kern-button"
          disabled={props.saving}
          onClick={() => props.answer("discard")}
        >
          Close without saving
        </button>
        <button
          type="button"
          className="kern-button"
          disabled={props.saving}
          onClick={() => props.answer("cancel")}
        >
          Cancel
        </button>
      </div>
    </Modal>
  );
}

function SaveBar() {
  const dirty = useSettingsDraft(isDirty);
  const saving = useSettingsDraft((s) => s.saving);
  const problem = useSettingsDraft((s) => s.problem);
  const restartNeeded = useSettingsDraft((s) => s.restartNeeded);
  const [restartError, setRestartError] = useState<string | null>(null);
  const restart = async () => {
    setRestartError(null);
    try {
      await restartRequest();
    } catch (e) {
      setRestartError(errorText(toWireError(e)));
    }
  };
  let status: string;
  if (saving) status = "Saving…";
  else if (dirty) status = "Changes not saved yet.";
  else if (restartNeeded) status = "Saved. Kern applies some of it when it starts again.";
  else status = "Changes apply when you press Save.";
  return (
    <footer className="kern-settings-bar" aria-label="Save the settings">
      <p role="status" className="kern-settings-bar-status" data-testid="settings-status">
        {status}
      </p>
      {problem && (
        <p role="alert" className="kern-modal-error" data-testid="settings-problem">
          {problem}
        </p>
      )}
      {restartError && (
        <p role="alert" className="kern-modal-error">
          {restartError}
        </p>
      )}
      <div className="kern-settings-bar-actions">
        {restartNeeded && (
          <button type="button" className="kern-button" onClick={() => void restart()}>
            Restart Kern
          </button>
        )}
        <button
          type="button"
          className="kern-button"
          disabled={!dirty || saving}
          onClick={() => useSettingsDraft.getState().revert()}
        >
          Revert
        </button>
        <button
          type="button"
          className="kern-button kern-button-primary"
          disabled={!dirty || saving}
          onClick={() => void useSettingsDraft.getState().save()}
        >
          Save
        </button>
      </div>
    </footer>
  );
}

function CategoryBody(props: {
  category: Category;
  settings: Settings;
  heading: "h1" | "h2";
  headingRef?: React.RefObject<HTMLHeadingElement | null>;
}) {
  const meta = CATEGORIES.find((c) => c.id === props.category)!;
  const Section = SECTIONS[props.category];
  const Heading = props.heading;
  return (
    <section className="kern-settings-category" aria-labelledby={`settings-${meta.id}`}>
      <Heading
        id={`settings-${meta.id}`}
        ref={props.headingRef}
        tabIndex={-1}
        className="kern-settings-heading"
      >
        {meta.label}
      </Heading>
      {props.heading === "h1" && <p className="kern-settings-blurb">{meta.blurb}</p>}
      <Section settings={props.settings} />
    </section>
  );
}

export function SettingsWindow() {
  const stored = useSettingsDraft((s) => s.stored);
  const sending = useSettingsDraft((s) => s.sending);
  const draft = useSettingsDraft((s) => s.draft);
  // Merged here, not in the selector: a merge made there is a new object on every read.
  const settings = useMemo(() => shown({ stored, sending, draft }), [stored, sending, draft]);
  const loadError = useSettingsDraft((s) => s.loadError);
  const listenError = useSettingsDraft((s) => s.listenError);
  // The whole list is selected and filtered here: a filtered list made in the selector is a new
  // array on every read, which the store takes for a change.
  const reports = useStoreErrors((s) => s.reports).filter((r) => r.file === SETTINGS_FILE);
  const reportsError = useStoreErrors((s) => s.error);
  const asked = useSettingsNav((s) => s.section);
  const notice = useOps((s) => s.notice);
  const earlier = useOps((s) => s.earlier);
  const [category, setCategory] = useState<Category>("appearance");
  const [query, setQuery] = useState("");
  const [unknown, setUnknown] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<((choice: CloseChoice) => void) | null>(null);
  const [promptSaving, setPromptSaving] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  /** The category whose heading takes the focus once it shows. */
  const focusHeading = useRef<Category | null>(null);

  useEffect(() => {
    let live = true;
    const stops: (() => void)[] = [];
    const keep = (stop: () => void) => (live ? stops.push(stop) : stop());
    void useSettingsDraft.getState().follow().then(keep);
    void useStoreErrors.getState().follow().then(keep);
    return () => {
      live = false;
      stops.forEach((stop) => stop());
    };
  }, []);

  // Closing with changes not saved asks first; Save that fails keeps the window open.
  useEffect(
    () =>
      setCloseCheck(async () => {
        // A save that is out is waited for: one that fails puts its changes back to be asked about.
        await useSettingsDraft.getState().settled();
        if (!isDirty(useSettingsDraft.getState())) return true;
        const choice = await new Promise<CloseChoice>((resolve) => setPrompt(() => resolve));
        if (choice === "cancel") {
          setPrompt(null);
          return false;
        }
        if (choice === "discard") {
          setPrompt(null);
          useSettingsDraft.getState().revert();
          return true;
        }
        setPromptSaving(true);
        const saved = await useSettingsDraft.getState().save();
        setPromptSaving(false);
        setPrompt(null);
        return saved;
      }),
    []
  );

  const select = (c: Category) => {
    setCategory(c);
    setQuery("");
    focusHeading.current = c;
  };

  useEffect(() => {
    if (asked === null) return;
    if (isCategory(asked)) {
      select(asked);
      setUnknown(null);
    } else {
      setUnknown(asked);
    }
    useSettingsNav.getState().taken();
  }, [asked]);

  useEffect(() => {
    if (focusHeading.current !== category || !heading.current) return;
    focusHeading.current = null;
    heading.current.scrollIntoView({ block: "start" });
    heading.current.focus();
  });

  const found = searching(query)
    ? CATEGORIES.filter((c) => rowsShown(c.id, query).length > 0)
    : null;

  return (
    <div
      className="kern-settings-window"
      data-testid="settings-window"
      {...{ [NO_FILE_KEYS_ATTR]: "" }}
      onKeyDown={(e) => {
        if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "s") {
          e.preventDefault();
          void useSettingsDraft.getState().save();
        }
      }}
    >
      <nav className="kern-settings-nav" aria-label="Settings categories">
        <input
          type="search"
          className="kern-settings-search"
          aria-label="Search settings"
          placeholder="Search settings"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            className="kern-settings-nav-item"
            aria-current={found === null && c.id === category ? "page" : undefined}
            onClick={() => select(c.id)}
          >
            {c.label}
            {found !== null && (
              <span className="kern-settings-nav-count" aria-hidden>
                {rowsShown(c.id, query).length}
              </span>
            )}
          </button>
        ))}
        <div className="kern-settings-nav-foot">
          <KernLogo onOpen={() => select("about")} version={VERSION_LABEL} />
        </div>
      </nav>
      <div className="kern-settings-pane">
        <main className="kern-settings-main">
          {reports.map((r, i) => (
            <div key={i} role="alert" className="kern-banner">
              {corruptText(r)}
            </div>
          ))}
          {reportsError && (
            <div role="alert" className="kern-banner">
              The reports of unreadable settings files could not be read: {errorText(reportsError)}
              <RepeatFlash watch={reportsError} />
            </div>
          )}
          {listenError && (
            <div role="alert" className="kern-banner">
              Settings changed in another window will not show here: {errorText(listenError)}
              <RepeatFlash watch={listenError} />
            </div>
          )}
          {unknown && (
            <div role="alert" className="kern-banner">
              Kern was asked to show the settings category “{unknown}”, which this version does not
              have.
            </div>
          )}
          {loadError && (
            <div role="alert" className="kern-banner">
              The settings could not be read: {errorText(loadError)}
              <RepeatFlash watch={loadError} />{" "}
              <button
                type="button"
                className="kern-button"
                onClick={() => void useSettingsDraft.getState().reload()}
              >
                Retry
              </button>
            </div>
          )}
          {!settings && !loadError && <p role="status">Reading the settings…</p>}
          <SettingsQuery.Provider value={query}>
            {settings &&
              (found === null ? (
                <CategoryBody
                  key={category}
                  category={category}
                  settings={settings}
                  heading="h1"
                  headingRef={heading}
                />
              ) : found.length === 0 ? (
                <p role="status" className="kern-settings-blurb">
                  No setting matches “{query.trim()}”.
                </p>
              ) : (
                found.map((c) => (
                  <CategoryBody key={c.id} category={c.id} settings={settings} heading="h2" />
                ))
              ))}
          </SettingsQuery.Provider>
        </main>
        <SaveBar />
      </div>
      {noticesShown({ notice, earlier }).length > 0 && (
        <ul className="kern-settings-notices" aria-label="Messages">
          {noticesShown({ notice, earlier }).map((n) => (
            <li key={n.id} role="status">
              {n.text}{" "}
              <button
                type="button"
                className="kern-button"
                onClick={() => useOps.getState().clearNotice(n.id)}
              >
                Dismiss
              </button>
            </li>
          ))}
        </ul>
      )}
      {prompt && <UnsavedPrompt saving={promptSaving} answer={prompt} />}
    </div>
  );
}
