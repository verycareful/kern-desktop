// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { expect, test } from "vitest";
import { classifyLink, linkAt } from "./links";

const rects: [number, number, number, number][] = [[0.1, 0.1, 0.3, 0.2]];

test("a_goto_link_names_its_page", () => {
  expect(classifyLink({ rects, page: 4 })).toEqual({ kind: "page", page: 4 });
  expect(classifyLink({ rects, page: 0, uri: "https://example.org" })).toEqual({
    kind: "page",
    page: 0,
  });
});

// A link is classified and nothing more: the address is read, never requested (the source is
// held to that by scripts/check-no-network.sh); the system opens it after the prompt.
test("a_web_link_is_external_and_never_fetched", () => {
  expect(classifyLink({ rects, uri: "https://example.org/a?b=c#d" })).toEqual({
    kind: "external",
    url: "https://example.org/a?b=c#d",
  });
  expect(classifyLink({ rects, uri: "http://example.org" })).toEqual({
    kind: "external",
    url: "http://example.org/",
  });
});

test("a_mail_and_tel_link_are_external", () => {
  expect(classifyLink({ rects, uri: "mailto:someone@example.org?subject=Hi" })).toEqual({
    kind: "external",
    url: "mailto:someone@example.org?subject=Hi",
  });
  expect(classifyLink({ rects, uri: "tel:+4912345" })).toEqual({
    kind: "external",
    url: "tel:+4912345",
  });
});

test("a_file_link_is_unsupported_and_the_user_is_told", () => {
  for (const uri of [
    "file:///etc/passwd",
    "ftp://example.org/a",
    "javascript:alert(1)",
    "data:text/html,x",
    "report.pdf",
    "",
  ]) {
    expect(classifyLink({ rects, uri }), uri).toEqual({ kind: "unsupported" });
  }
  expect(classifyLink({ rects })).toEqual({ kind: "unsupported" });
});

test("an_address_with_a_control_character_or_a_blank_or_no_host_is_not_opened", () => {
  // A parser drops a tab or a line break, so the address would open as another than the one read.
  expect(classifyLink({ rects, uri: "https://exa\tmple.org" })).toEqual({ kind: "unsupported" });
  expect(classifyLink({ rects, uri: "https://exa mple.org" })).toEqual({ kind: "unsupported" });
  expect(classifyLink({ rects, uri: "https://" })).toEqual({ kind: "unsupported" });
});

test("a_scheme_in_capitals_is_opened_as_the_lower_case_address_that_is_shown", () => {
  expect(classifyLink({ rects, uri: "HTTPS://Example.org/A" })).toEqual({
    kind: "external",
    url: "https://example.org/A",
  });
});

test("a_link_is_found_by_the_point_inside_any_of_its_boxes", () => {
  const links = [
    { rects: [[0, 0, 0.1, 0.1]] as [number, number, number, number][], page: 1 },
    {
      rects: [
        [0.5, 0.5, 0.6, 0.55],
        [0.1, 0.56, 0.3, 0.6],
      ] as [number, number, number, number][],
      uri: "tel:1",
    },
  ];
  expect(linkAt(links, 0.05, 0.05)).toBe(links[0]);
  expect(linkAt(links, 0.2, 0.58)).toBe(links[1]);
  expect(linkAt(links, 0.6, 0.5)).toBeUndefined();
});
