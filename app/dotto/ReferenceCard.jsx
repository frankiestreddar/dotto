"use client";

import { useLayoutEffect, useRef, useState } from "react";

// Read-only live reference to another canvas/source (see the "/source|canvas ... place" command,
// command-verbs.js) — reuses the exact same inline-preview rendering CanvasCard.jsx uses for its
// own nested-folder preview (window.__buildFolderInlineCanvas), just pointed at whichever local
// key currently represents the referenced item (own/shared:/public:) instead of a plain local
// folderId. That key is re-resolved fresh every time this component (re)mounts — see
// resolveReferenceFolderKey's own comment in app/dotto/lib/sharedAndPublicCanvasLoading.ts for why it's never
// trusted stale — which doubles as "refetch on canvas open" for free: navigating away and back
// unmounts/remounts this card along with the rest of that canvas's items (see CanvasItemsLayer.jsx).
// No click-to-open-and-edit of its own (attachFolderCardClick isn't wired here) — genuinely
// read-only, matching the command's own spec.
export default function ReferenceCard({ it }) {
  const previewWrapRef = useRef(null);
  // Starts "loading" and only ever moves forward to 'unavailable'/'loaded' below — refOwnerId/
  // refFolderId are fixed at creation time for a given card (see placeTarget, command-verbs.js),
  // so this effect's dependency array never actually changes for an existing card in practice;
  // there's no real "go back to loading" transition to handle, just the one resolution per mount.
  const [status, setStatus] = useState("loading"); // 'loading' | 'unavailable' | 'loaded'

  useLayoutEffect(() => {
    let cancelled = false;
    window.__resolveReferenceFolderKey(it.refOwnerId, it.refFolderId).then((localKey) => {
      if (cancelled) return;
      if (!localKey) {
        setStatus("unavailable");
        return;
      }
      if (previewWrapRef.current) {
        previewWrapRef.current.innerHTML = "";
        previewWrapRef.current.appendChild(window.__buildFolderInlineCanvas(localKey));
      }
      setStatus("loaded");
    });
    return () => {
      cancelled = true;
    };
  }, [it.refOwnerId, it.refFolderId]);

  return (
    <>
      <div className="folder-card-title-row">
        <div className="folder-card-title reference-card-title" title={it.refTitle}>
          {it.refTitle || "(untitled)"}
        </div>
        {it.refGlobalId && <span className="global-id-pill">{it.refGlobalId}</span>}
      </div>
      {status === "unavailable" ? (
        <div className="reference-card-unavailable">
          This {it.refKind === "source" ? "source" : "canvas"} is no longer available.
        </div>
      ) : (
        <div ref={previewWrapRef} className="folder-card-preview" />
      )}
    </>
  );
}
