"use client";

import { useLayoutEffect } from "react";

// Ported from the old default/untyped branch in renderLegacyCardBody (public/dotto/waypoints-
// render-loop.js) — the most common card kind on any canvas. Format-bar (bold/italic/underline/
// strikethrough/color) is real JSX with direct handlers (document.execCommand is a plain browser
// API, no bridge needed); the body's click-to-edit lifecycle stays vanilla as attachNoteBody,
// called via window.__findItemEl(it.id, paneId) each render — same technique TitleCard uses
// for its wrapper-level fontSize, needed here because attachNoteBody itself needs the wrapper (for
// resize and the click-to-edit classList toggle), not just the body — see that function's own
// comment for the full reasoning (coupled to appState.currentEditingEl/broadcastEditingState).
// Height is always automatic now (no more "More…" expand/collapse toggle) — width is the only
// thing you can drag (see the right-edge-only .resize handle below), and the card just grows/
// shrinks to fit its content at whatever width it's currently at, live, via plain CSS.
//
// Each format button calls e.preventDefault() on mousedown — without it, the browser's own default
// action (shifting focus to the button) still fires after execCommand runs, blurring the
// contentEditable body and closing the bar (attachNoteBody's onblur exempts a focus move INTO the
// format-bar via e.relatedTarget, but that exemption only matters if blur fires at all; not
// blurring in the first place is simpler and avoids relying on it). data-cmd + syncNoteFormatButtons
// (called here directly after execCommand, and from attachNoteBody's own onfocus/keyup/click
// alongside syncColorPicker) is what reflects each button's current on/off state via .active — the
// same "sync UI to live editor state" job syncColorPicker already does for the color swatch.
export default function NoteCard({ it, paneId }) {
  useLayoutEffect(() => {
    const el = window.__findItemEl(it.id, paneId);
    if (el) window.__attachNoteBody(el, it, paneId);
  });

  const runFormatCommand = (cmd) => (e) => {
    e.preventDefault();
    document.execCommand(cmd);
    const el = window.__findItemEl(it.id, paneId);
    const body = el && el.querySelector(".body");
    if (!body) return;
    window.__syncNoteFormatButtons(body);
    // With an actual text selection, queryCommandState reflects the just-applied toggle
    // synchronously (the call above already covers that case). With a collapsed selection (just a
    // caret, nothing selected — toggling on/off what the NEXT typed character will look like),
    // some browsers don't settle queryCommandState's answer until a tick later — turning a button
    // off then read back as still "on" until some later event (e.g. a keypress) happened to
    // re-sync it. This is a correction pass for exactly that case, cheap and invisible (runs
    // before the next paint) when the immediate call above was already correct.
    requestAnimationFrame(() => window.__syncNoteFormatButtons(body));
  };

  return (
    <>
      <div
        className="format-bar"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="format-btn"
          data-cmd="bold"
          onMouseDown={runFormatCommand("bold")}
        >
          B
        </button>
        <button
          type="button"
          className="format-btn"
          data-cmd="italic"
          onMouseDown={runFormatCommand("italic")}
        >
          I
        </button>
        <button
          type="button"
          className="format-btn"
          data-cmd="underline"
          onMouseDown={runFormatCommand("underline")}
        >
          U
        </button>
        <button
          type="button"
          className="format-btn"
          data-cmd="strikeThrough"
          onMouseDown={runFormatCommand("strikeThrough")}
        >
          S
        </button>
        <input
          type="color"
          className="text-color-swatch"
          onInput={(e) => document.execCommand("foreColor", false, e.target.value)}
        />
      </div>
      <div
        className="body"
        data-placeholder="Note..."
        dangerouslySetInnerHTML={{ __html: it.html || "" }}
      />
      {/* Width only — a vertical grip, not the diagonal corner arrow every other resizable kind
          uses (see setupResizing's it.kind === 'note' branch, resize-shortcuts-init.js). */}
      <div className="resize">
        <svg
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <path d="M4 2v8M8 2v8" />
        </svg>
      </div>
    </>
  );
}
