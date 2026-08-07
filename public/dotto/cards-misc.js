import { escapeHtml } from './ai-assistant-suggestions.js';
import { appState } from './core-state.js';
import { saveSnapshot, scheduleWorkspaceSave } from './history-autosave.js';
import { findItemById } from './live-presence.js';
import { render } from './waypoints-render-loop.js';


    // Shared by embed's own card (below) and its outline/mini-preview labels elsewhere
    // (shared-canvases-outline.js, live-presence.js) — used to be Bookmark's too, before that card
    // kind was removed as redundant with waypoints/other menus.
    function shortUrl(url) {
        try { return new URL(url).hostname; } catch (e) { return url.slice(0, 24); }
    }

    // ---------- Embed card ----------
    // Rewrites common "watch"/share links into their dedicated iframe-embeddable equivalents.
    // YouTube/Vimeo deliberately block their normal watch/player page from being framed elsewhere
    // (X-Frame-Options/CSP frame-ancestors — an anti-clickjacking measure) and only allow embedding
    // through a separate /embed/ (YouTube) or player.vimeo.com (Vimeo) path — a plain pasted
    // "youtube.com/watch?v=..." link renders blank otherwise, which is exactly the confusing
    // failure mode this exists to avoid. Only rewrites the iframe's actual src — it.embedUrl itself
    // stays exactly what the user pasted, so re-opening editEmbed shows their original familiar
    // link, not a rewritten one. Anything not matching a known watch-link pattern passes through
    // unchanged (CodePen/JSFiddle/Gist links already use their own embeddable URL shape once
    // copied as an "embed" link, so those need no rewriting).
    // YouTube's IFrame player uses this to verify which site is embedding it as part of its own
    // postMessage handshake — omitting it (or stripping the referrer entirely, see renderEmbedHTML's
    // referrerpolicy below) is exactly what produces YouTube's "Error 153: video player
    // configuration error" instead of the video actually loading.
    function withYoutubeOrigin(embedUrl) {
        const u = new URL(embedUrl);
        u.searchParams.set('origin', window.location.origin);
        return u.toString();
    }
    function toEmbeddableUrl(rawUrl) {
        let u;
        try { u = new URL(rawUrl); } catch (e) { return rawUrl; }
        const host = u.hostname.replace(/^www\.|^m\./, '');
        if (host === 'youtube.com') {
            if (u.pathname === '/watch' && u.searchParams.get('v')) {
                const start = parseInt(u.searchParams.get('t'), 10);
                return withYoutubeOrigin(`https://www.youtube.com/embed/${u.searchParams.get('v')}${start ? '?start=' + start : ''}`);
            }
            const shorts = u.pathname.match(/^\/shorts\/([^/]+)/);
            if (shorts) return withYoutubeOrigin(`https://www.youtube.com/embed/${shorts[1]}`);
            if (u.pathname.startsWith('/embed/')) return withYoutubeOrigin(rawUrl); // already an embed link — still needs origin set
        } else if (host === 'youtu.be' && u.pathname.length > 1) {
            return withYoutubeOrigin(`https://www.youtube.com/embed/${u.pathname.slice(1)}`);
        } else if (host === 'vimeo.com') {
            const id = u.pathname.match(/^\/(\d+)/);
            if (id) return `https://player.vimeo.com/video/${id[1]}`;
        }
        return rawUrl;
    }
    // Embeds an external website or embeddable code snippet (CodePen/JSFiddle/Gist-style links)
    // live via <iframe> — the first iframe in this codebase (no prior card kind used one; media
    // embeds video/images via native <video>/<img> instead). sandbox is permissive enough to cover
    // common embeds (allow-scripts + allow-same-origin together is what most real embed widgets
    // need to actually function) rather than maximally locked down — this is showing the user's
    // own chosen URL, not arbitrary untrusted content injected by someone else. allow +
    // allowfullscreen cover what video embeds (YouTube/Vimeo) specifically need for their own play/
    // fullscreen controls to work. referrerpolicy is deliberately NOT "no-referrer" — YouTube's
    // player needs the referrer (alongside the origin param from withYoutubeOrigin above) to
    // complete its own embedding-origin check, and stripping it produces "Error 153: video player
    // configuration error" instead of the video loading; strict-origin-when-cross-origin still only
    // ever leaks this app's bare origin, never the full page URL. Even after toEmbeddableUrl's
    // rewriting, some sites still refuse to be framed at all and will just show blank inside the
    // iframe — that's a property of the target site, not something fixable from here.
    function renderEmbedHTML(it) {
        if (!it.embedUrl) {
            return `<div class="embed-empty">
                <div class="embed-icon">🌐</div>
                <div class="embed-title">New Embed</div>
                <div class="embed-hint">Click to add a website or code embed link</div>
            </div>`;
        }
        // .embed-header is a dedicated drag handle, separate from the iframe below it — a
        // cross-origin iframe is its own browsing context and NEVER dispatches pointerdown (or
        // any DOM event) to the parent page for interactions inside it, a hard browser security
        // boundary, not something this app can intercept. Without a handle outside the iframe,
        // a filled embed card (iframe filling the whole body) would have no draggable surface at
        // all once a URL is set. This also means the iframe itself is never covered by anything —
        // every click/drag/scroll directly on it always reaches the embedded page untouched,
        // which is the whole point of embedding it live in the first place.
        return `<div class="embed-header">
                <span class="embed-header-url">${escapeHtml(shortUrl(it.embedUrl))}</span>
                <div class="embed-edit" onmousedown="event.stopPropagation()" onclick="editEmbed(${it.id})" title="Edit embed link">✎</div>
            </div>
            <iframe class="embed-frame" src="${escapeHtml(toEmbeddableUrl(it.embedUrl))}" sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-popups-to-escape-sandbox" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
    }
    function editEmbed(id) {
        const it = findItemById(id); if (!it) return;
        const url = prompt('Embed URL (website or embeddable code snippet link):', it.embedUrl || 'https://');
        if (url === null) return;
        saveSnapshot();
        it.embedUrl = url.trim();
        render();
    }

    // ---------- Checklist card ----------
    function renderStatcardHTML(it) {
        const label = it.statKind === 'progress' ? 'Progress' : (it.statKind ? it.statKind[0].toUpperCase() + it.statKind.slice(1) : 'Stat');
        const cache = it.streamCache || {};
        const payloads = Object.values(cache);
        let value = '—', caption = 'Link a game, stopwatch, or shelf card to see stats.';
        if (it.statKind === 'progress' && payloads.length) {
            const seen = payloads.reduce((sum, p) => sum + ((p.delta && p.delta.seen) || 0), 0);
            value = String(seen);
            caption = 'Cards Seen';
        } else if (it.statKind === 'accuracy' && payloads.length) {
            let right = 0, wrong = 0;
            payloads.forEach(p => {
                const r = (p.delta && p.delta.ratings) || {};
                right += (r.hard || 0) + (r.easy || 0);
                wrong += (r.noclue || 0) + (r.wrong || 0);
            });
            value = `${right} / ${wrong}`;
            caption = 'Right / Wrong';
        }
        return `<div class="statcard-header">${label}</div>
            <div class="statcard-value">${value}</div>
            <div class="statcard-caption">${caption}</div>`;
    }
    function renderChecklistHTML(it) {
        const total = it.tasks.length, done = it.tasks.filter(t => t.done).length;
        const pct = total ? Math.round(done / total * 100) : 0;
        const rows = it.tasks.map(t => `
            <div class="checklist-row">
                <input type="checkbox" ${t.done ? 'checked' : ''} onmousedown="event.stopPropagation()" onchange="toggleTask(${it.id}, ${t.id})">
                <span class="checklist-text" contenteditable="true" onmousedown="event.stopPropagation()" oninput="updateTaskText(${it.id}, ${t.id}, this)" style="${t.done ? 'text-decoration:line-through;opacity:.5;' : ''}">${t.text}</span>
                <input type="date" class="checklist-date" value="${t.deadline || ''}" onmousedown="event.stopPropagation()" onchange="updateTaskDeadline(${it.id}, ${t.id}, this)">
                <span class="checklist-remove" onmousedown="event.stopPropagation()" onclick="removeTask(${it.id}, ${t.id})">✕</span>
            </div>`).join('');
        return `<div class="checklist-progress"><div class="checklist-fill" style="width:${pct}%"></div></div>
            <div class="checklist-rows">${rows}</div>
            <div class="checklist-add" onmousedown="event.stopPropagation()" onclick="addTask(${it.id})">+ Add task</div>`;
    }
    function addTask(id) {
        const it = findItemById(id); if (!it) return;
        saveSnapshot();
        it.tasks.push({ id: appState.idCounter++, text: '', done: false, deadline: '' });
        render();
    }
    function toggleTask(id, tid) {
        const it = findItemById(id); if (!it) return;
        saveSnapshot();
        const t = it.tasks.find(x => x.id === tid); if (t) t.done = !t.done;
        render();
    }
    function updateTaskText(id, tid, el) {
        const it = findItemById(id); if (!it) return;
        const t = it.tasks.find(x => x.id === tid); if (t) t.text = el.textContent;
        scheduleWorkspaceSave();
    }
    function updateTaskDeadline(id, tid, el) {
        const it = findItemById(id); if (!it) return;
        const t = it.tasks.find(x => x.id === tid); if (t) t.deadline = el.value;
        scheduleWorkspaceSave();
    }
    function removeTask(id, tid) {
        const it = findItemById(id); if (!it) return;
        saveSnapshot();
        it.tasks = it.tasks.filter(x => x.id !== tid);
        render();
    }

export { addTask, editEmbed, removeTask, renderChecklistHTML, renderEmbedHTML, renderStatcardHTML, shortUrl, toggleTask, updateTaskDeadline, updateTaskText };
