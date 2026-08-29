import { describe, expect, it } from "vitest";
// See srs-algorithm.test.ts's own comment on why a plain relative import straight into
// public/dotto/ works fine from Vitest (a Node test runner, not the browser) despite the "public/
// can't be imported by app/" convention that governs the real running app. text-utils.js
// deliberately only holds escapeHtml/stripHtml (not the third original candidate,
// isLatinScriptText — see that file's own comment on why: it needs appState, and importing
// appState transitively runs core-state.js's own module-level DOM lookups, which throw under
// jsdom with no real app markup mounted, breaking importability for this whole module including
// these two appState-free functions).
import { escapeHtml, stripHtml } from "../../public/dotto/text-utils.js";

// First real test coverage for these two (public/dotto/text-utils.js, extracted from
// ai-assistant-suggestions.js in Phase 4.2) — zero coverage existed anywhere before this, despite
// escapeHtml/stripHtml being called from 7+ and 6+ other vanilla files respectively.

describe("escapeHtml", () => {
  it("escapes the five HTML-significant characters", () => {
    expect(escapeHtml(`<div class="a & b">'x'</div>`)).toBe(
      "&lt;div class=&quot;a &amp; b&quot;&gt;'x'&lt;/div&gt;",
    );
  });

  it("leaves plain text untouched", () => {
    expect(escapeHtml("hello world 123")).toBe("hello world 123");
  });

  it("coerces non-string input via String()", () => {
    expect(escapeHtml(42)).toBe("42");
    expect(escapeHtml(null)).toBe("null");
  });
});

describe("stripHtml", () => {
  // stripHtml builds a real detached <div> and reads its textContent — needs a DOM, which is
  // exactly what this project's jsdom Vitest environment (vitest.config.mts) provides.
  it("returns the plain-text content of an HTML string, trimmed", () => {
    expect(stripHtml("<b>Hello</b> <i>world</i>")).toBe("Hello world");
  });

  it("collapses nested tags to their combined text", () => {
    expect(stripHtml('<div><span class="x">a</span><span>b</span></div>')).toBe("ab");
  });

  it("returns an empty string for empty/null/undefined input", () => {
    expect(stripHtml("")).toBe("");
    expect(stripHtml(null as unknown as string)).toBe("");
    expect(stripHtml(undefined as unknown as string)).toBe("");
  });

  it("trims leading/trailing whitespace from the extracted text", () => {
    expect(stripHtml("  <p>  padded  </p>  ")).toBe("padded");
  });
});
