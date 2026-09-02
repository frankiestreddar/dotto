// Phase 4.5 port of public/dotto/cards-misc.js: the Embed card (shortUrl/withYoutubeOrigin/
// toEmbeddableUrl/editEmbed) and the Checklist/Statcard cards (renderStatcardHTML,
// renderChecklistHTML + its addTask/toggleTask/updateTaskText/updateTaskDeadline/removeTask
// handlers). EmbedCard.jsx/ChecklistCard.jsx (same app/dotto/ tree) now import these directly
// instead of going through window bridges. renderChecklistHTML's own generated HTML string still
// has literal onclick/onchange/oninput="toggleTask(...)" etc attributes though (consumed by
// app/dotto/lib/messagingCanvasPreview.ts's mini inline-canvas previews too), so addTask/editEmbed/
// removeTask/toggleTask/updateTaskDeadline/updateTaskText keep their exact plain (non-`__`) global
// names alongside the real exports — same dual-exposure convention window.setMediaFromLink/
// window.pushNotification already use.

interface Task {
  id: number;
  text: string;
  done: boolean;
  deadline: string;
}

interface Item {
  id: number;
  embedUrl?: string;
  statKind?: string;
  streamCache?: Record<string, { delta?: { seen?: number; ratings?: Record<string, number> } }>;
  tasks: Task[];
  [key: string]: unknown;
}

// Shared by embed's own card (below) and its outline/mini-preview labels elsewhere
// (app/dotto/lib/outlineTree.ts and app/dotto/lib/messagingCanvasPreview.ts) — used to be
// Bookmark's too, before that card kind was removed as redundant with waypoints/other menus.
export function shortUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url.slice(0, 24);
  }
}

// ---------- Embed card ----------
// Rewrites common "watch"/share links into their dedicated iframe-embeddable equivalents.
// YouTube/Vimeo deliberately block their normal watch/player page from being framed elsewhere
// (X-Frame-Options/CSP frame-ancestors — an anti-clickjacking measure) and only allow embedding
// through a separate /embed/ (YouTube) or player.vimeo.com (Vimeo) path — a plain pasted
// "youtube.com/watch?v=..." link renders blank otherwise, which is exactly the confusing failure
// mode this exists to avoid. Only rewrites the iframe's actual src — it.embedUrl itself stays
// exactly what the user pasted, so re-opening editEmbed shows their original familiar link, not a
// rewritten one. Anything not matching a known watch-link pattern passes through unchanged
// (CodePen/JSFiddle/Gist links already use their own embeddable URL shape once copied as an
// "embed" link, so those need no rewriting).
// YouTube's IFrame player uses this to verify which site is embedding it as part of its own
// postMessage handshake — omitting it (or stripping the referrer entirely, see EmbedCard.jsx's
// referrerPolicy) is exactly what produces YouTube's "Error 153: video player configuration error"
// instead of the video actually loading.
export function withYoutubeOrigin(embedUrl: string): string {
  const u = new URL(embedUrl);
  u.searchParams.set("origin", window.location.origin);
  return u.toString();
}

export function toEmbeddableUrl(rawUrl: string): string {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return rawUrl;
  }
  const host = u.hostname.replace(/^www\.|^m\./, "");
  if (host === "youtube.com") {
    if (u.pathname === "/watch" && u.searchParams.get("v")) {
      const start = parseInt(u.searchParams.get("t") || "", 10);
      return withYoutubeOrigin(
        `https://www.youtube.com/embed/${u.searchParams.get("v")}${start ? "?start=" + start : ""}`,
      );
    }
    const shorts = u.pathname.match(/^\/shorts\/([^/]+)/);
    if (shorts) return withYoutubeOrigin(`https://www.youtube.com/embed/${shorts[1]}`);
    if (u.pathname.startsWith("/embed/")) return withYoutubeOrigin(rawUrl); // already an embed link — still needs origin set
  } else if (host === "youtu.be" && u.pathname.length > 1) {
    return withYoutubeOrigin(`https://www.youtube.com/embed/${u.pathname.slice(1)}`);
  } else if (host === "vimeo.com") {
    const id = u.pathname.match(/^\/(\d+)/);
    if (id) return `https://player.vimeo.com/video/${id[1]}`;
  }
  return rawUrl;
}

// Embeds an external website or embeddable code snippet (CodePen/JSFiddle/Gist-style links) live
// via <iframe> — the first iframe in this codebase (no prior card kind used one; media embeds
// video/images via native <video>/<img> instead). sandbox is permissive enough to cover common
// embeds (allow-scripts + allow-same-origin together is what most real embed widgets need to
// actually function) rather than maximally locked down — this is showing the user's own chosen
// URL, not arbitrary untrusted content injected by someone else. allow + allowfullscreen cover
// what video embeds (YouTube/Vimeo) specifically need for their own play/fullscreen controls to
// work. referrerpolicy is deliberately NOT "no-referrer" — YouTube's player needs the referrer
// (alongside the origin param from withYoutubeOrigin above) to complete its own embedding-origin
// check, and stripping it produces "Error 153: video player configuration error" instead of the
// video loading; strict-origin-when-cross-origin still only ever leaks this app's bare origin,
// never the full page URL. Even after toEmbeddableUrl's rewriting, some sites still refuse to be
// framed at all and will just show blank inside the iframe — that's a property of the target
// site, not something fixable from here.
export function editEmbed(id: number): void {
  const it = window.__findItemById?.(id) as Item | undefined;
  if (!it) return;
  const url = prompt(
    "Embed URL (website or embeddable code snippet link):",
    it.embedUrl || "https://",
  );
  if (url === null) return;
  window.__saveSnapshot?.();
  it.embedUrl = url.trim();
  window.__render?.();
}

// ---------- Checklist card ----------
export function renderStatcardHTML(it: Item): string {
  const label =
    it.statKind === "progress"
      ? "Progress"
      : it.statKind
        ? it.statKind[0].toUpperCase() + it.statKind.slice(1)
        : "Stat";
  const cache = it.streamCache || {};
  const payloads = Object.values(cache);
  let value = "—";
  let caption = "Link a game, stopwatch, or shelf card to see stats.";
  if (it.statKind === "progress" && payloads.length) {
    const seen = payloads.reduce((sum, p) => sum + (p.delta?.seen || 0), 0);
    value = String(seen);
    caption = "Cards Seen";
  } else if (it.statKind === "accuracy" && payloads.length) {
    let right = 0;
    let wrong = 0;
    payloads.forEach((p) => {
      const r = p.delta?.ratings || {};
      right += (r.hard || 0) + (r.easy || 0);
      wrong += (r.noclue || 0) + (r.wrong || 0);
    });
    value = `${right} / ${wrong}`;
    caption = "Right / Wrong";
  }
  return `<div class="statcard-header">${label}</div>
            <div class="statcard-value">${value}</div>
            <div class="statcard-caption">${caption}</div>`;
}

export function renderChecklistHTML(it: Item): string {
  const total = it.tasks.length;
  const done = it.tasks.filter((t) => t.done).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const rows = it.tasks
    .map(
      (t) => `
            <div class="checklist-row">
                <input type="checkbox" ${t.done ? "checked" : ""} onmousedown="event.stopPropagation()" onchange="toggleTask(${it.id}, ${t.id})">
                <span class="checklist-text" contenteditable="true" onmousedown="event.stopPropagation()" oninput="updateTaskText(${it.id}, ${t.id}, this)" style="${t.done ? "text-decoration:line-through;opacity:.5;" : ""}">${t.text}</span>
                <input type="date" class="checklist-date" value="${t.deadline || ""}" onmousedown="event.stopPropagation()" onchange="updateTaskDeadline(${it.id}, ${t.id}, this)">
                <span class="checklist-remove" onmousedown="event.stopPropagation()" onclick="removeTask(${it.id}, ${t.id})">✕</span>
            </div>`,
    )
    .join("");
  return `<div class="checklist-progress"><div class="checklist-fill" style="width:${pct}%"></div></div>
            <div class="checklist-rows">${rows}</div>
            <div class="checklist-add" onmousedown="event.stopPropagation()" onclick="addTask(${it.id})">+ Add task</div>`;
}

export function addTask(id: number): void {
  const it = window.__findItemById?.(id) as Item | undefined;
  if (!it) return;
  window.__saveSnapshot?.();
  const appState = window.__getAppState?.() as { idCounter: number } | undefined;
  const newTaskId = appState ? appState.idCounter++ : Date.now();
  it.tasks.push({ id: newTaskId, text: "", done: false, deadline: "" });
  window.__render?.();
}

export function toggleTask(id: number, tid: number): void {
  const it = window.__findItemById?.(id) as Item | undefined;
  if (!it) return;
  window.__saveSnapshot?.();
  const t = it.tasks.find((x) => x.id === tid);
  if (t) t.done = !t.done;
  window.__render?.();
}

export function updateTaskText(id: number, tid: number, el: HTMLElement): void {
  const it = window.__findItemById?.(id) as Item | undefined;
  if (!it) return;
  const t = it.tasks.find((x) => x.id === tid);
  if (t) t.text = el.textContent || "";
  window.__scheduleWorkspaceSave?.();
}

export function updateTaskDeadline(id: number, tid: number, el: HTMLInputElement): void {
  const it = window.__findItemById?.(id) as Item | undefined;
  if (!it) return;
  const t = it.tasks.find((x) => x.id === tid);
  if (t) t.deadline = el.value;
  window.__scheduleWorkspaceSave?.();
}

export function removeTask(id: number, tid: number): void {
  const it = window.__findItemById?.(id) as Item | undefined;
  if (!it) return;
  window.__saveSnapshot?.();
  it.tasks = it.tasks.filter((x) => x.id !== tid);
  window.__render?.();
}

// Guarded: this module's top level is reached during Next's server-side render pass (a
// pre-existing, project-wide issue across every Phase 4.4/4.5 bridge file, discovered and
// documented while finishing the history-autosave.js port — see PHASE4_ROADMAP.md), where
// `window` genuinely does not exist yet.
if (typeof window !== "undefined") {
  // Used by app/dotto/lib/outlineTree.ts and app/dotto/lib/messagingCanvasPreview.ts (different
  // lib files, so these stay bridges rather than real imports).
  window.__shortUrl = shortUrl;
  window.__toEmbeddableUrl = toEmbeddableUrl;
  window.__renderChecklistHTML = renderChecklistHTML;
  window.__renderStatcardHTML = renderStatcardHTML;
  // Plain (non-`__`) globals — real inline onclick/onchange/oninput targets built into
  // renderChecklistHTML's own HTML string above (also consumed by messagingCanvasPreview.ts's
  // mini inline-canvas previews). Formerly re-exported through window-bridge.js's own
  // centralized inline-handler list.
  window.editEmbed = editEmbed;
  window.addTask = addTask;
  window.toggleTask = toggleTask;
  window.updateTaskText = updateTaskText;
  window.updateTaskDeadline = updateTaskDeadline;
  window.removeTask = removeTask;
}
