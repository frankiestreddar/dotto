import { create } from "zustand";
import type { Item } from "./messagingCanvasPreview";

// Open conversation thread (app/dotto/lib/messagingCanvasPreview.ts's openConvo/renderConvoBody)
// — { friendId, displayName, avatarId, avatarUrl, messages } | null. Genuine JSX for the header
// (Avatar.jsx) and each plain-text message bubble; each canvas-snapshot message's own card
// content is ref-mounted vanilla DOM (renderInlineCanvas/renderMsgSnapshotCard) — see
// MsgConvo.jsx. Migrated from bridges.js's hand-rolled createStore to real Zustand (see
// PHASE4_ROADMAP.md's Zustand migration plan, batch 6) — not flushSync'd, no caller reads the DOM
// synchronously right after; the scroll-to-bottom reset lives in a useLayoutEffect inside
// MsgConvo.jsx itself, so it's correctly synchronous with that component's own commit regardless.
export interface ConvoMessage {
  id: string;
  senderId: string;
  text: string;
  canvasSnapshot?: Item[];
  createdAt: string;
}

export interface MsgConvoState {
  friendId: string;
  displayName: string;
  avatarId: number;
  avatarUrl: string | null;
  messages: ConvoMessage[];
}

export const useMsgConvoStore = create<MsgConvoState | null>(() => null);
