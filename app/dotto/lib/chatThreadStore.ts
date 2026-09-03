import { create } from "zustand";

// #search-chat-thread (app/dotto/lib/searchOrchestrationSelection.ts's renderOrchestrateResult,
// app/dotto/lib/hamburgerCollab.ts's openSavedChat/deleteSelectedChats, app/dotto/lib/
// aiAssistantSuggestions.ts's showAiListView/closeRailView) — a persisted, multi-turn Dotbot
// conversation shown ABOVE the search input (chat-app style), entirely separate from the six
// single-owner panel stores (translationPanelStore and siblings), which stay exactly as they are
// for canvas matches/commands/suggestions below the input. `panels` is the same raw panel array
// the orchestrate route returns (and supabase/migrations/20260819_add_dotbot_conversations.sql
// persists verbatim as dotbot_messages.content) rather than pre-split per panel type, so
// ChatThread.jsx can dispatch on it exactly like renderOrchestrateResult already does for the
// single-turn panels above. `fresh` is true only for a turn just appended from a LIVE response
// (drives ChatTurn's one-time typewriter reveal + drag-to-canvas wiring on mount); turns restored
// from history render with `fresh` false/omitted so they show fully settled immediately, never
// re-typewriter. Migrated from bridges.js's hand-rolled createStore to real Zustand (see
// PHASE4_ROADMAP.md's Zustand migration plan, batch 3) — see app/dotto/ChatThread.jsx for the
// consumer. Every producer still wraps its setState call in flushSync — the chat-thread
// height-transition function (app/dotto/lib/aiAssistantSuggestions.ts) reads #search-chat-thread's
// real scrollHeight synchronously right after a turn is appended/restored.
export interface ChatTurn {
  id: string;
  query: string;
  panels: unknown;
  fresh?: boolean;
}

export const useChatThreadStore = create<ChatTurn[]>(() => []);
