"use client";

// PR1 stub for single-canvas Schedule Mode's simplified card body (icon + user-given name +
// block-type text + scheduled time, replacing the real per-kind Component while this mode is
// active — see CanvasItemsLayer.jsx's CanvasItem and scheduleModeStore's own comment in
// bridges.js). Unreachable in practice until a later PR starts populating scheduleModeStore's
// itemsById with real entries — CanvasItem only renders this when an item's id is a key in it.
export default function ScheduleModeCardBody() {
  return null;
}
