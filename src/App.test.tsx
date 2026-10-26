import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { WireTheme } from "./ipc/kernkraft";
import App from "./App";
import { useTabs } from "./store/tabs";

const themeGet = vi.hoisted(() =>
  vi.fn(() =>
    Promise.resolve({ css: ":root{}", fallbacks: [], problems: [] } as unknown as WireTheme)
  )
);
const userDirs = vi.hoisted(() =>
  vi.fn(() => Promise.resolve({ home: { k: "Utf8", v: "/home/t" }, dirs: [] }))
);

vi.mock("./ipc", async () => ({
  ...(await import("./ipc/wire-path")),
  EVENT_THEME_CHANGED: "kernkraft://theme-changed",
  on: () => Promise.resolve(() => undefined),
  settingsGet: () =>
    Promise.resolve({
      follow: { colours: true, accent: true, fonts: true, radius: true },
      theme_mode: "system",
      accent: "slate",
      density: "cozy",
    }),
  themeGet,
  userDirs,
  toWireError: (e: unknown) => e,
}));

beforeEach(() => {
  useTabs.setState({ tabs: [], activeId: null });
  userDirs.mockClear();
});

test("renders_shell_root", async () => {
  render(<App />);
  expect(screen.getByTestId("shell")).toBeInTheDocument();
  // The hook has settled once it has written the theme the mocked themeGet gave.
  await waitFor(() => expect(document.head.querySelector("style#kern-tokens")).not.toBeNull());
  expect(screen.queryByRole("alert")).toBeNull();
  // The Home folder tab opens once user_dirs answers.
  expect(await screen.findByRole("tab", { name: "t" })).toBeInTheDocument();
  expect(screen.getByTestId("status-bar")).toHaveTextContent("/home/t");
});

test("closing_the_last_tab_opens_home_again", async () => {
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Close t" }));
  expect(await screen.findByRole("tab", { name: "t" })).toBeInTheDocument();
  expect(useTabs.getState().tabs).toHaveLength(1);
  expect(userDirs).toHaveBeenCalledTimes(2);
});

test("home_lookup_failure_shows_the_error_with_retry", async () => {
  userDirs.mockImplementationOnce(() => Promise.reject({ kind: "Io", message: "no home" }));
  render(<App />);
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("no home");
  expect(screen.queryByRole("tab")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByRole("tab", { name: "t" })).toBeInTheDocument();
  expect(screen.queryByRole("alert")).toBeNull();
});
