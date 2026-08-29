import { escapeHtml } from './ai-assistant-suggestions.js';
import { appState, supabase } from './core-state.js';
import { saveSnapshot, scheduleWorkspaceSave } from './history-autosave.js';
import { findItemById } from './live-presence.js';
import { showSelectionToolbarFor } from './search-orchestration-selection.js';
import { render } from './waypoints-render-loop.js';


    // ---------- Media card ----------
    function renderMediaHTML(it) {
        if (it.mediaUploading) {
            return `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:8px;color:var(--ink-soft);width:100%;">
                <div style="font-size:13px;">Uploading ${escapeHtml(it.mediaName || 'file')}…</div>
            </div>`;
        }
        if (!it.mediaSrc) {
            return `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:8px;color:var(--ink-soft);width:100%;">
                <div style="font-size:13px;">Add photo, video, PDF, or EPUB</div>
                <div style="display:flex;gap:6px;" onmousedown="event.stopPropagation()">
                    <button class="format-btn" style="width:auto;padding:0 10px;" onclick="setMediaFromLink(${it.id})">Link</button>
                    <button class="format-btn" style="width:auto;padding:0 10px;" onclick="triggerMediaUpload(${it.id})">Upload</button>
                </div>
            </div>`;
        }
        const tag = it.mediaType === 'video'
            ? `<video src="${it.mediaSrc}" controls></video>`
            : `<img src="${it.mediaSrc}"/>`;
        return `<div class="media-change-btn" onmousedown="event.stopPropagation()" onclick="clearMedia(${it.id})" title="Remove media">✕</div>${tag}
            <div class="resize"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M10 2L2 10M10 6L6 10M10 10L10 10"/></svg></div>`;
    }
    // Probes an <img>/<video>'s real intrinsic dimensions, regardless of whether src is a data:
    // URL (upload) or a remote URL (paste-a-link) — only reads width/height metadata, never pixel
    // data, so CORS (which would block the latter) never applies here. Async by nature (the
    // element has to actually start loading first), so callers render once immediately with
    // whatever size the item already has, then again once this resolves.
    function measureMediaNaturalSize(src, isVideo, cb) {
        if (isVideo) {
            const v = document.createElement('video');
            v.preload = 'metadata';
            v.onloadedmetadata = () => cb(v.videoWidth, v.videoHeight);
            v.onerror = () => cb(0, 0);
            v.src = src;
        } else {
            const img = new Image();
            img.onload = () => cb(img.naturalWidth, img.naturalHeight);
            img.onerror = () => cb(0, 0);
            img.src = src;
        }
    }
    // Fits the media's real aspect ratio into a reasonable default card footprint — previously
    // every media card was a fixed 240x160 box with object-fit:cover force-cropping whatever was
    // set into it, silently losing part of the image/video instead of showing it true to shape.
    // Only ever caps the longer edge (never upscales a small image past its native size), so the
    // ratio itself is always exact, not just approximated.
    function computeMediaCardSize(naturalW, naturalH) {
        if (!naturalW || !naturalH) return { w: 240, h: 160 }; // fallback if measurement ever fails
        const scale = Math.min(320 / naturalW, 320 / naturalH, 1);
        return { w: Math.round(naturalW * scale), h: Math.round(naturalH * scale) };
    }
    function setMediaFromLink(id) {
        const url = prompt('Paste an image or video URL:');
        if (!url) return;
        const it = findItemById(id); if (!it) return;
        saveSnapshot();
        const isVideo = /\.(mp4|webm|ogg|mov)(\?|$)/i.test(url);
        it.mediaType = isVideo ? 'video' : 'image';
        it.mediaSrc = url.trim();
        // A real, globally-unique id per upload (crypto.randomUUID() — not appState.idCounter,
        // which is a plain local/per-session counter two different users could easily collide on)
        // — explicit request: "not just a unique code for the user... unique across the platform."
        // Lets the Files sidebar (renderFilesList, hamburger-collab.js) dedupe multiple canvas
        // cards that all point at the SAME underlying file down to one row, while the Outline
        // panel (which never looks at this field) keeps listing every individual card instance.
        it.mediaFileId = crypto.randomUUID();
        render();
        measureMediaNaturalSize(it.mediaSrc, isVideo, (w, h) => {
            const live = findItemById(id);
            if (!live || live.mediaSrc !== it.mediaSrc) return; // cleared/changed again before this resolved
            Object.assign(live, computeMediaCardSize(w, h));
            render();
        });
    }
    // The actual file-to-item pipeline, split out from triggerMediaUpload below so
    // upload-popup.js's own dropzone (a file already in hand, from a click-to-pick or a real drag-
    // and-drop — no native picker of its own) can reuse it without needing to fake a change event
    // on a file input just to get here.
    function processMediaFile(id, file) {
        if (!file) return;
        const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
        const isEpub = file.type === 'application/epub+zip' || /\.epub$/i.test(file.name);
        if (isPdf || isEpub) { uploadDocumentToStorage(id, file, isPdf ? 'pdf' : 'epub'); return; }
        const reader = new FileReader();
        reader.onload = () => {
            const it = findItemById(id); if (!it) return;
            saveSnapshot();
            const isVideo = file.type.startsWith('video');
            it.mediaType = isVideo ? 'video' : 'image';
            it.mediaSrc = reader.result;
            // See setMediaFromLink's own comment just above for why this needs to be a real
            // globally-unique id, not appState.idCounter.
            it.mediaFileId = crypto.randomUUID();
            render();
            measureMediaNaturalSize(it.mediaSrc, isVideo, (w, h) => {
                const live = findItemById(id);
                if (!live || live.mediaSrc !== it.mediaSrc) return;
                Object.assign(live, computeMediaCardSize(w, h));
                render();
            });
        };
        reader.readAsDataURL(file);
    }
    function triggerMediaUpload(id) {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = 'image/*,video/*,application/pdf,application/epub+zip,.epub';
        input.onchange = () => processMediaFile(id, input.files[0]);
        input.click();
    }
    // PDFs/EPUBs go through real Supabase Storage rather than the data: URL path images/video use
    // above — see the 20260805_add_documents_storage migration's own comment for why (a multi-MB
    // file base64-embedded directly in the item's JSON would bloat every single workspace
    // autosave). w/h get a fixed page-shaped default (not aspect-ratio-derived like
    // computeMediaCardSize — a document doesn't have one single "natural" ratio the way an image
    // does) — the user can still resize the card normally afterward.
    async function uploadDocumentToStorage(id, file, docType) {
        const it = findItemById(id); if (!it) return;
        if (!supabase || !appState.currentUser.id) { alert('Sign in to upload documents.'); return; }
        saveSnapshot();
        it.mediaType = docType; it.mediaSrc = null; it.mediaName = file.name; it.mediaUploading = true;
        // PDFs default a bit bigger than the base 340x440 (425x550) — a page of real body text
        // needs to be legibly sized at a glance without resizing by hand every time, but not so
        // big it dominates the canvas by default (now that cards are drag-to-resize anyway, see
        // setupResizing). EPUBs keep the smaller default; their own reflowable viewer doesn't
        // have the same "a whole page has to fit and stay readable" constraint a fixed-size PDF
        // page render does.
        if (docType === 'pdf') { it.w = 425; it.h = 550; } else { it.w = 340; it.h = 440; }
        render();
        const path = `${appState.currentUser.id}/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, '_')}`;
        const { error } = await supabase.storage.from('documents').upload(path, file, { contentType: file.type || undefined });
        const live = findItemById(id);
        if (!live) return; // card got deleted while the upload was in flight
        if (error) {
            console.error('[media] document upload failed:', error);
            live.mediaUploading = false; live.mediaType = null; live.mediaName = null;
            render();
            alert('Upload failed — try again.');
            return;
        }
        const { data } = supabase.storage.from('documents').getPublicUrl(path);
        live.mediaSrc = data.publicUrl;
        // See setMediaFromLink's own comment for why this needs to be a real globally-unique id,
        // not appState.idCounter.
        live.mediaFileId = crypto.randomUUID();
        live.mediaUploading = false;
        render();
    }
    function clearMedia(id) {
        const it = findItemById(id); if (!it) return;
        saveSnapshot();
        it.mediaType = null; it.mediaSrc = null; it.mediaName = null; it.mediaFileId = null;
        it.docPage = null; it.epubLocation = null;
        render();
    }

    // ---------- PDF viewer (media card, mediaType:'pdf') ----------
    // pdf.js ships a real ES module build (see public/vendor/pdfjs, copied from the pdfjs-dist
    // package — this classic, non-bundled script can't `import` straight from node_modules) —
    // loaded via dynamic import() rather than a <script> tag, and only on first actual use, so the
    // ~1.7MB library+worker never loads for a session that never touches a PDF card. A singleton
    // promise (not re-imported per card) so switching between multiple PDF cards only pays the
    // load cost once per session.
    function loadPdfjs() {
        if (!appState.pdfjsLibPromise) {
            appState.pdfjsLibPromise = import('/vendor/pdfjs/pdf.min.mjs').then(lib => {
                lib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
                return lib;
            });
        }
        return appState.pdfjsLibPromise;
    }
    // render() wipes and rebuilds #world's entire DOM on essentially every interaction anywhere on
    // the canvas (see the main render loop) — a PDF card's own view gets destroyed and rebuilt
    // right along with everything else, but the actual PARSED document (the expensive fetch +
    // parse step) must NOT be re-fetched every single time that happens, so it's cached here by
    // src, independent of the DOM lifecycle. Same reasoning as buildFolderInlineCanvas/
    // renderTableHTML already rebuilding their own presentational DOM from scratch on every
    // render() — only the network+parse cost specifically needs to survive that, not the DOM.
 // mediaSrc -> Promise<PDFDocumentProxy>
    function getCachedPdfDoc(src) {
        if (!appState.pdfDocCache.has(src)) {
            // getDocument only accepts a DocumentInitParameters object (`function getDocument(e={})`
            // in the vendored build) — it does NOT special-case a bare string into { url } the way
            // older pdf.js versions did, so passing `src` directly throws "expected either `data`,
            // `range`, or `url` parameter" (every property read off the raw string comes back
            // undefined).
            appState.pdfDocCache.set(src, loadPdfjs().then(lib => lib.getDocument({ url: src }).promise));
        }
        return appState.pdfDocCache.get(src);
    }
    // Builds a live PDF viewer: the current page rasterized to a <canvas>, with pdf.js's own
    // TextLayer — genuinely selectable, positioned <span>s, not an image of text — laid invisibly
    // on top of it in exact alignment. That's what makes the existing "select text -> Add to
    // source"/"Look up" toolbar (see the document-level selectionchange listener further down)
    // work on a PDF exactly like it already does on any other card's text — the only change needed
    // there is broadening its host check to also accept .pdf-text-layer alongside
    // [contenteditable="true"]. Current page number persists on it.docPage (survives the DOM
    // rebuild the same way every other card kind's live state does — e.g. flashcard's fcIndex).
    function buildPdfViewer(it) {
        const wrap = document.createElement('div');
        wrap.className = 'pdf-viewer';
        wrap.onclick = (e) => e.stopPropagation();
        // A tightly-fitted wrapper sized to exactly the rendered page's own w/h — canvas and
        // textLayer both anchor to ITS corner, not .pdf-viewer's, since .pdf-viewer centers its
        // content via flex (so canvas alone isn't flush at 0,0 within it) and the text layer's
        // position:absolute needs a positioned ancestor that IS exactly page-sized for its spans
        // to land in the right place over the canvas.
        const page = document.createElement('div');
        // The generic per-card drag-to-move system listens for 'pointerdown', not 'mousedown' —
        // see setupDraggingAndClicking's own exemption list (`.item-options`, `.resize`), which
        // .pdf-viewer-page is now also on, for the exact same reason: without it, click-dragging
        // to select text anywhere over the document started moving the whole card instead of
        // letting the browser's native text-selection drag happen. The nav bar below is
        // deliberately NOT exempted — it's the card's actual drag handle now that the document
        // itself can't be.
        page.className = 'pdf-viewer-page';
        const canvas = document.createElement('canvas');
        canvas.className = 'pdf-viewer-canvas';
        const textLayer = document.createElement('div');
        textLayer.className = 'pdf-text-layer';
        page.append(canvas, textLayer);
        const nav = document.createElement('div');
        nav.className = 'pdf-viewer-nav';
        const prevBtn = document.createElement('button');
        prevBtn.type = 'button'; prevBtn.className = 'pdf-viewer-nav-btn'; prevBtn.textContent = '‹';
        const pageLabel = document.createElement('span');
        pageLabel.className = 'pdf-viewer-page-label';
        const nextBtn = document.createElement('button');
        nextBtn.type = 'button'; nextBtn.className = 'pdf-viewer-nav-btn'; nextBtn.textContent = '›';
        nav.append(prevBtn, pageLabel, nextBtn);
        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'resize';
        resizeHandle.innerHTML = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M10 2L2 10M10 6L6 10M10 10L10 10"/></svg>';
        wrap.append(page, nav, resizeHandle);

        let pdfDoc = null;
        let pageNum = it.docPage || 1;
        let renderTask = null;
        let lastRenderedWidth = null; // see the ResizeObserver below

        async function renderPage() {
            if (!pdfDoc) return;
            pageNum = Math.max(1, Math.min(pageNum, pdfDoc.numPages));
            pageLabel.textContent = `${pageNum} / ${pdfDoc.numPages}`;
            const pdfPage = await pdfDoc.getPage(pageNum);
            const baseViewport = pdfPage.getViewport({ scale: 1 });
            // The PDF page's own true aspect ratio (independent of whatever size the card
            // currently happens to be) — setupResizing's media branch locks dragging to this
            // instead of the card's current (possibly still-default, not-yet-page-shaped) w/h.
            it.docAspectRatio = baseViewport.width / baseViewport.height;
            // Keep the card's own box exactly the right shape for its content, width-anchored —
            // recomputed every render (a no-op once it already matches) rather than only once, so
            // this both corrects an upload's still-default, not-yet-page-shaped box on first load
            // AND self-heals any minor grid-snap rounding drift from a resize drag. Without this,
            // the box and the actual page could end up a slightly different shape, which is what
            // made resizing look like it was cropping the page instead of scaling it uniformly —
            // the page was always rendered at ITS OWN correct ratio, but the surrounding box
            // (with overflow:auto) wasn't guaranteed to match it.
            const cardEl = wrap.closest('.item');
            if (cardEl) {
                const wantedH = Math.max(112, Math.round((it.w / it.docAspectRatio) / 28) * 28);
                if (wantedH !== it.h) { it.h = wantedH; cardEl.style.height = it.h + 'px'; }
            }
            // Fit the page's own natural width to whatever the card currently measures — read
            // fresh on every call rather than assumed, so a resized card (or one reopened at a
            // different width) always renders sharp instead of stretched.
            const targetWidth = wrap.clientWidth || 320;
            const scale = targetWidth / baseViewport.width;
            const viewport = pdfPage.getViewport({ scale });
            page.style.width = viewport.width + 'px'; page.style.height = viewport.height + 'px';
            page.style.transform = ''; // clear the ResizeObserver's live-preview scale — this real render replaces it
            lastRenderedWidth = viewport.width;
            // Canvas *display* size (CSS px, logical) stays at the viewport's own size — only the
            // backing pixel buffer is rendered larger, by devicePixelRatio, and the render call
            // scales its drawing into that larger buffer via `transform`. Without this, a Retina/
            // HiDPI screen (dpr 2-3x) stretches a 1x-resolution buffer to fill the same CSS box,
            // which is exactly what "pixelated" looks like — same standard fix pdf.js's own
            // reference viewer/examples use.
            const outputScale = window.devicePixelRatio || 1;
            canvas.style.width = viewport.width + 'px'; canvas.style.height = viewport.height + 'px';
            canvas.width = Math.floor(viewport.width * outputScale);
            canvas.height = Math.floor(viewport.height * outputScale);
            const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;
            // Feeds pdf.js's own --total-scale-factor:calc(var(--scale-factor) * var(--user-unit))
            // chain (see .pdf-text-layer's CSS) — the same mechanism pdf.js's reference viewer uses
            // to size each text span correctly at the current zoom. Deliberately the LOGICAL scale,
            // not multiplied by outputScale — text-layer spans position themselves in the same CSS
            // coordinate space the canvas is DISPLAYED at, not its backing buffer's pixel count.
            textLayer.style.setProperty('--scale-factor', scale);
            if (renderTask) renderTask.cancel();
            renderTask = pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport, transform });
            try { await renderTask.promise; } catch (e) { return; } // canceled by a newer renderPage() call — the newer one owns the canvas now
            textLayer.innerHTML = '';
            const lib = await loadPdfjs();
            const layer = new lib.TextLayer({ textContentSource: pdfPage.streamTextContent(), container: textLayer, viewport });
            await layer.render();
        }
        function goToPage(n) {
            if (!pdfDoc || n < 1 || n > pdfDoc.numPages) return;
            pageNum = n;
            it.docPage = pageNum;
            scheduleWorkspaceSave();
            renderPage();
        }
        prevBtn.onclick = (e) => { e.stopPropagation(); goToPage(pageNum - 1); };
        nextBtn.onclick = (e) => { e.stopPropagation(); goToPage(pageNum + 1); };

        // Dragging the card's own resize handle (see setupResizing) changes wrap's real measured
        // size on every frame, but a REAL re-render (page fetch + canvas paint + text-layer
        // rebuild) is too slow to run that often — waiting for it made the whole drag feel
        // jumpy, frozen at the old size until a render finally landed. So this does two things on
        // every resize tick: an instant, free CSS transform:scale of the already-rendered page up
        // to the new size (smooth, in sync with the box every frame, since transform affects the
        // text layer along with the canvas as one unit — they stay aligned with each other even
        // mid-scale, just not perfectly crisp), and a debounced REAL renderPage() that only fires
        // once the size actually settles, which is what makes it crisp again and clears the
        // transform (see renderPage's own `page.style.transform = ''`).
        let resizeSettleTimer = null;
        const resizeObserver = new ResizeObserver(() => {
            if (lastRenderedWidth) {
                page.style.transformOrigin = '0 0';
                page.style.transform = `scale(${wrap.clientWidth / lastRenderedWidth})`;
            }
            if (resizeSettleTimer) clearTimeout(resizeSettleTimer);
            resizeSettleTimer = setTimeout(renderPage, 150);
        });
        resizeObserver.observe(wrap);

        getCachedPdfDoc(it.mediaSrc).then(doc => { pdfDoc = doc; renderPage(); }).catch(err => {
            console.error('[media] pdf load failed:', err);
            wrap.innerHTML = '<div style="padding:12px;color:var(--ink-soft);font-size:13px;">Couldn\'t load this PDF.</div>';
        });

        return wrap;
    }

    // ---------- EPUB viewer (media card, mediaType:'epub') ----------
    // epubjs ships classic UMD builds (see public/vendor/epub), not a real ES module, so this
    // loads them as plain <script> tags instead of import() — jszip first (epub.js expects
    // window.JSZip to already exist), then epub.js itself, which then exposes window.ePub. A
    // singleton promise so multiple EPUB cards only pay the script-load cost once per session.
    function loadEpubjs() {
        if (!appState.epubjsLibPromise) {
            appState.epubjsLibPromise = new Promise((resolve, reject) => {
                const jszip = document.createElement('script');
                jszip.src = '/vendor/epub/jszip.min.js';
                jszip.onload = () => {
                    const epub = document.createElement('script');
                    epub.src = '/vendor/epub/epub.min.js';
                    epub.onload = () => resolve(window.ePub);
                    epub.onerror = reject;
                    document.head.appendChild(epub);
                };
                jszip.onerror = reject;
                document.head.appendChild(jszip);
            });
        }
        return appState.epubjsLibPromise;
    }
    // Parsed Book objects (the expensive fetch+unzip+parse step) persist across render()'s
    // frequent full DOM rebuilds, same reasoning as pdfDocCache above. The Rendition itself can't
    // be cached the same way — it's attached to a specific container element that genuinely gets
    // destroyed on every rebuild — so it's always recreated fresh against the cached Book instead.
 // mediaSrc -> Promise<Book>
    function getCachedEpubBook(src) {
        if (!appState.epubBookCache.has(src)) {
            appState.epubBookCache.set(src, loadEpubjs().then(ePub => ePub(src)));
        }
        return appState.epubBookCache.get(src);
    }
    function buildEpubViewer(it) {
        const wrap = document.createElement('div');
        wrap.className = 'epub-viewer';
        wrap.onclick = (e) => e.stopPropagation();
        const container = document.createElement('div');
        container.className = 'epub-viewer-container';
        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'resize';
        resizeHandle.innerHTML = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M10 2L2 10M10 6L6 10M10 10L10 10"/></svg>';
        wrap.append(container, resizeHandle);

        getCachedEpubBook(it.mediaSrc).then(book => {
            // scrolled-doc: one continuous scroll, not paginated — sidesteps needing our own
            // page-turn UI (see buildPdfViewer's nav) inside an already-small canvas card.
            // overflow:'auto' is NOT implied by flow:'scrolled-doc' alone — epub.js's own internal
            // ContentManager only honors an explicitly-passed `overflow` setting; without one it
            // falls back to a value that reads as effectively non-scrollable for this flow (per
            // explicit bug report that EPUB cards weren't scrolling at all). epub.js applies this as
            // a real inline overflow-y/overflow-x style directly on the internal `.epub-container`
            // div IT creates inside our own #container — a plain CSS rule targeting that class
            // couldn't have overridden it either way, since inline styles always win regardless of
            // stylesheet specificity, which is exactly why this needs to be set through the API
            // options here rather than in globals.css.
            const rendition = book.renderTo(container, { width: '100%', height: '100%', flow: 'scrolled-doc', overflow: 'auto' });
            rendition.display(it.epubLocation || undefined);
            rendition.on('relocated', (location) => {
                it.epubLocation = location.start.cfi;
                scheduleWorkspaceSave();
            });
            // Feeds the SAME selection-toolbar "Add to source"/"Look up" flow used everywhere else
            // in the app (see showSelectionToolbarFor). epub.js renders each chapter inside its
            // own same-origin iframe (needed for per-book CSS isolation), so the main document's
            // own selectionchange listener never sees these selections at all — a selectionchange
            // firing on an iframe's own Document doesn't bubble to the parent document even when
            // same-origin — this is the equivalent hook on epub.js's own side, which already emits
            // a real DOM Range via its own in-iframe selectionchange listener.
            rendition.on('selectedRange', (range) => {
                const iframeEl = container.querySelector('iframe');
                if (!iframeEl) return;
                const iframeRect = iframeEl.getBoundingClientRect();
                const rangeRect = range.getBoundingClientRect();
                showSelectionToolbarFor(range, container, {
                    left: iframeRect.left + rangeRect.left, top: iframeRect.top + rangeRect.top,
                    width: rangeRect.width, height: rangeRect.height,
                });
            });
        }).catch(err => {
            console.error('[media] epub load failed:', err);
            wrap.innerHTML = '<div style="padding:12px;color:var(--ink-soft);font-size:13px;">Couldn\'t load this EPUB.</div>';
        });

        return wrap;
    }

export { buildEpubViewer, buildPdfViewer, clearMedia, processMediaFile, renderMediaHTML, setMediaFromLink, triggerMediaUpload };

// React → vanilla bridge (see MediaCard.jsx, app/dotto/CanvasItemsLayer.jsx's CARD_KIND_COMPONENTS)
// — buildPdfViewer/buildEpubViewer build a whole live DOM subtree (pdf.js/epub.js need real
// canvas/iframe elements, not an HTML string), same "vanilla function builds live DOM, React just
// mounts it" pattern as buildFolderInlineCanvas.
window.__renderMediaHTML = renderMediaHTML;
window.__buildPdfViewer = buildPdfViewer;
window.__buildEpubViewer = buildEpubViewer;
