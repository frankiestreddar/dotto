"use client";

// Ported from the old renderShelfHTML (app/dotto/lib/shelfSearch.ts — kept
// there, not deleted). Every handler here was already window-bridged for the original inline
// event attributes (startRenameShelfName/startRenameShelfSourceRow/handleShelfSourceRowClick/
// filterShelfRows/shelfSelectSession) — `this` in those original attributes becomes
// e.currentTarget here, same element each maps to. folderTitleForConnectedSource
// (drawing-connections.js) got a new bridge, same pattern cards-misc.js established.
//
// filterShelfRows is a direct DOM query/patch (toggles row display via a live search box), never
// going through React — deliberately unchanged: it doesn't touch `it` at all (purely ephemeral UI
// state), so there's nothing for a later real render to reconcile against or fight.
export default function ShelfCard({ it }) {
  const sessions = it.shelfSessions || [];
  const sourceEntries = Object.keys(it.stackSourceRows || {}).map((sid) => ({
    sourceItemId: Number(sid),
    title: window.__folderTitleForConnectedSource(Number(sid)),
    count: (it.stackSourceRows[sid] || []).length,
  }));

  const startRenameName = (e) => {
    e.stopPropagation();
    window.startRenameShelfName(e.currentTarget, it.id);
  };
  const nameEl = it.shelfName ? (
    <div className="shelf-header" onClick={startRenameName}>
      {it.shelfName}
    </div>
  ) : (
    <div
      className="shelf-header crumb-placeholder"
      data-placeholder="Stack"
      onClick={startRenameName}
    />
  );

  const searchEl =
    sourceEntries.length || sessions.length ? (
      <input
        type="text"
        className="shelf-search"
        placeholder="Search..."
        onMouseDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
        onClick={(e) => {
          e.stopPropagation();
          e.currentTarget.focus();
        }}
        onInput={(e) => window.filterShelfRows(e.currentTarget)}
      />
    ) : null;

  const sourcesEl = sourceEntries.length ? (
    <div className="shelf-sources">
      {sourceEntries.map((s) => (
        <div
          className="shelf-source-row"
          key={s.sourceItemId}
          onClick={(e) => {
            e.stopPropagation();
            window.handleShelfSourceRowClick(e.currentTarget, s.sourceItemId);
          }}
        >
          <span
            className="shelf-row-label"
            data-source-id={s.sourceItemId}
            onDoubleClick={(e) => {
              e.stopPropagation();
              window.startRenameShelfSourceRow(e.currentTarget, s.sourceItemId);
            }}
            title="Double-click to rename"
          >
            {s.title}
          </span>
          <span className="shelf-row-meta">
            {s.count} {s.count === 1 ? "entry" : "entries"}
          </span>
        </div>
      ))}
    </div>
  ) : null;

  if (!sessions.length) {
    if (sourceEntries.length) {
      return (
        <>
          {nameEl}
          {searchEl}
          {sourcesEl}
        </>
      );
    }
    return (
      <>
        {nameEl}
        <div className="shelf-empty">
          No sessions saved yet, and nothing connected. Connect a source here to combine it with
          others for flashcards, or link a stopwatch (that&apos;s linked to a game) here, then press
          Start then Stop on it, to save a session.
        </div>
      </>
    );
  }

  return (
    <>
      {nameEl}
      {searchEl}
      {sourcesEl}
      <div className="shelf-rows">
        {sessions.map((s) => {
          const selected = s.sessionId === it.shelfSelectedId;
          const totalSeen = s.payloads.reduce(
            (sum, p) => sum + ((p.delta && p.delta.seen) || 0),
            0,
          );
          return (
            <div
              className={"shelf-row" + (selected ? " selected" : "")}
              key={s.sessionId}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => window.shelfSelectSession(it.id, s.sessionId)}
            >
              <span className="shelf-row-label">{s.label}</span>
              <span className="shelf-row-meta">{totalSeen} seen</span>
            </div>
          );
        })}
      </div>
    </>
  );
}
