"use client";

// Ported from the old renderChecklistHTML (public/dotto/cards-misc.js, now removed) — see
// EmbedCard.jsx for the pattern this follows (CanvasItemsLayer.jsx's CARD_KIND_COMPONENTS).
// addTask/toggleTask/updateTaskText/updateTaskDeadline/removeTask all stay vanilla, reached via
// the same window.* bridge every inline onclick="..." in this app already goes through
// (window-bridge.js) — no new plumbing needed here, unlike Embed's shortUrl/toEmbeddableUrl.
export default function ChecklistCard({ it }) {
  const total = it.tasks.length;
  const done = it.tasks.filter((t) => t.done).length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <>
      <div className="checklist-progress">
        <div className="checklist-fill" style={{ width: pct + "%" }} />
      </div>
      <div className="checklist-rows">
        {it.tasks.map((t) => (
          <div className="checklist-row" key={t.id}>
            <input
              type="checkbox"
              checked={t.done}
              onMouseDown={(e) => e.stopPropagation()}
              onChange={() => window.toggleTask(it.id, t.id)}
            />
            {/* contentEditable's live keystrokes are owned by the browser, not React — updateTaskText
                (vanilla) mutates t.text in place and only schedules an autosave, it never calls
                render(), so this component doesn't re-render mid-edit either; suppressContentEditableWarning
                is React's own sanctioned way to pair contentEditable with React-supplied initial/
                synced content (see https://react.dev/reference/react-dom/components/common#common-props
                — "contentEditable"), not a real bug suppression. */}
            <span
              className="checklist-text"
              contentEditable
              suppressContentEditableWarning
              onMouseDown={(e) => e.stopPropagation()}
              onInput={(e) => window.updateTaskText(it.id, t.id, e.currentTarget)}
              style={t.done ? { textDecoration: "line-through", opacity: 0.5 } : undefined}
            >
              {t.text}
            </span>
            {/* defaultValue, not value — updateTaskDeadline (like updateTaskText) never calls
                render(), so this is an initial value the browser's native date picker then owns,
                same as the original plain value="..." HTML attribute was. */}
            <input
              type="date"
              className="checklist-date"
              defaultValue={t.deadline || ""}
              onMouseDown={(e) => e.stopPropagation()}
              onChange={(e) => window.updateTaskDeadline(it.id, t.id, e.currentTarget)}
            />
            <span
              className="checklist-remove"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => window.removeTask(it.id, t.id)}
            >
              ✕
            </span>
          </div>
        ))}
      </div>
      <div
        className="checklist-add"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => window.addTask(it.id)}
      >
        + Add task
      </div>
    </>
  );
}
