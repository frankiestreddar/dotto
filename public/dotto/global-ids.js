// ---------- Global canvas/source IDs ----------
// A folder-id string (e.g. 'folder-5') is only unique WITHIN one user's own idCounter sequence —
// see the collision note in app/dotto/lib/canvasPresence.ts's queueSyncDiff comment. Global ids are a separate,
// deliberately short/human-typeable identifier layered on top, unique across every user, used for
// the new slash-command system (look up/share a canvas or source by id) and faintly displayed on
// its card. Client-generated (no server round trip needed at creation time, matching every other
// id in this app), registered into the new global_items table lazily via the normal autosave path
// (see saveWorkspaceNow, history-autosave.js) — the DB's own unique constraint on global_id is the
// actual collision guarantee; this alphabet/length just needs collisions to be rare, not
// impossible, so a client-only id is never trusted as authoritative until it round-trips.
const GLOBAL_ID_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ'; // no 0/O/1/I/L — unambiguous typed by hand
const GLOBAL_ID_LENGTH = 8;

function generateGlobalId() {
    const bytes = new Uint8Array(GLOBAL_ID_LENGTH);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => GLOBAL_ID_ALPHABET[b % GLOBAL_ID_ALPHABET.length]).join('');
}

export { generateGlobalId, GLOBAL_ID_ALPHABET, GLOBAL_ID_LENGTH };
