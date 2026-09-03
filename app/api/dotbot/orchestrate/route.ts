import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getGroqClient, GROQ_TEXT_MODEL, GROQ_REASONING_EFFORT } from "@/lib/groq";
import {
  DOTBOT_ORCHESTRATE_SYSTEM_PROMPT,
  DOTBOT_CONVERSATION_SUMMARY_INSTRUCTIONS,
  DOTBOT_USER_MEMORY_INSTRUCTIONS,
  getDotbotProfile,
  peekSearchCredits,
  spendSearchCredits,
} from "@/lib/dotbot";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
// DOTBOT_ORCHESTRATE_SCHEMA (still defined in lib/dotbot.ts, deliberately left untouched) isn't
// imported here anymore — Groq's chat completion API has no equivalent of Gemini's structured
// responseSchema parameter. The desired shape is instead conveyed entirely through
// DOTBOT_ORCHESTRATE_SYSTEM_PROMPT's own prose description (already comprehensive) plus
// response_format:"json_object" below, same as it always effectively was for the model itself —
// the schema was already just a secondary technical constraint on top of that prose, never the
// only source of truth (see buildPanels(), which never trusted it blindly either).

const MAX_LIST_LEN = 5; // sentences / dictionary entries — defensive cap, schema alone isn't trusted (see lib/dotbot.ts)
const MAX_WORD_LEN = 60; // headword/transliteration/grammarTags/language — defensive cap regardless of prompt behavior
const MAX_IPA_LEN = 80;
const MAX_DEF_LEN = 220; // a single definition, one sense only — should always be well under 15 words in practice
const MAX_RECOMMENDED = 3;
const MAX_RECOMMENDED_INTRO_LEN = 220; // "recommendedIntro" — one short trailing-off sentence, same order of magnitude as MAX_DEF_LEN
const MAX_CARD_CONTEXT = 10; // cards dragged into the search box — defensive cap on an already-client-capped set
const MAX_CARD_TEXT_LEN = 300; // one card's describeCardForAI() text — a note or a few flashcard rows, not a whole table dump
const MAX_SOURCE_COLS = 10; // sourceAction.columns / an attached source's headers — a source is never just 2 columns, but still bounded
const MAX_SOURCE_ROWS = 150; // sourceAction.rows — matches the cap stated in the prompt, enforced here regardless of prompt compliance
const MAX_SOURCE_CELL_LEN = 200; // one generated cell's text
const MAX_ALIGNMENT_PAIRS = 24; // per sentence — full word-for-word coverage now (see lib/dotbot.ts), not just a pedagogically useful subset, so longer sentences need real headroom here
const MAX_ALIGNMENT_PHRASE_LEN = 80;
const MAX_GRAMMAR_TAGS = 4; // per dictionary entry — part of speech plus a few notable properties, each renders as its own pill
const MAX_ANSWER_BLOCKS = 12;
const MAX_BLOCK_TEXT_LEN = 600; // one prose paragraph in an in-depth grammar/explanation answer
const MAX_HISTORY_MESSAGES = 20; // most-recent N prior turns (user+assistant combined) sent as context
const MAX_HISTORY_TEXT_LEN = 500; // one flattened assistant turn's summary, in the history sent back to the model
const MAX_INLINE_MARKERS = 20; // {{dictionary:N}}/{{example:N}}/{{translation}} refs per text field — defensive cap, see sanitizeInlineMarkers
const MAX_CONVERSATION_SUMMARY_LEN = 700; // chars — defensive cap regardless of the prompt's own "under 100 words" instruction
const MAX_USER_MEMORY_LEN = 600; // chars — same defensive-cap convention, for "userMemoryUpdate"

type Supabase = SupabaseClient<Database>;

interface AlignmentPair {
  sourcePhrase: string;
  targetPhrase: string;
}

interface SanitizedSentence {
  text: string;
  translation: string;
  romanization: string;
  alignment: AlignmentPair[];
}

interface MarkerContext {
  dictEntryCount: number;
  exampleCount: number;
  hasTranslation: boolean;
}

// {sourcePhrase, targetPhrase} pairs for word-for-word highlighting between a sentence's "text"
// and "translation" — see lib/dotbot.ts's ALIGNMENT_SCHEMA. Only shape/length is validated here;
// whether each phrase actually appears verbatim in its sentence is checked client-side (which
// needs to search for it anyway to know where to highlight), and silently skipped if not found.
function sanitizeAlignment(a: unknown): AlignmentPair[] {
  if (!Array.isArray(a)) return [];
  return a
    .map((p): AlignmentPair | null => {
      if (!p || typeof p !== "object") return null;
      const sourcePhrase = String((p as Record<string, unknown>).sourcePhrase || "")
        .trim()
        .slice(0, MAX_ALIGNMENT_PHRASE_LEN);
      const targetPhrase = String((p as Record<string, unknown>).targetPhrase || "")
        .trim()
        .slice(0, MAX_ALIGNMENT_PHRASE_LEN);
      if (!sourcePhrase || !targetPhrase) return null;
      return { sourcePhrase, targetPhrase };
    })
    .filter((p): p is AlignmentPair => p !== null)
    .slice(0, MAX_ALIGNMENT_PAIRS);
}

// A {text, translation, romanization, alignment} example sentence, or null — shared by
// standalone "examples.sentences" and "answerBlocks[].type==='example'" (dictionary entries no
// longer carry their own sentences — see lib/dotbot.ts). "romanization" is a Latin-script
// transliteration of "text", present only when the model decided "text" isn't already Latin
// script (same convention as the dictionary headword's "transliteration" field) — its mere
// presence/absence is what the client uses to decide whether to show a transliteration line, so
// no separate script-detection is needed there.
function sanitizeSentence(s: unknown): SanitizedSentence | null {
  if (!s || typeof s !== "object") return null;
  const obj = s as Record<string, unknown>;
  const text = String(obj.text || "")
    .trim()
    .slice(0, MAX_DEF_LEN);
  if (!text) return null;
  return {
    text,
    translation: obj.translation ? String(obj.translation).trim().slice(0, MAX_DEF_LEN) : text,
    romanization: obj.romanization ? String(obj.romanization).trim().slice(0, MAX_DEF_LEN) : "",
    alignment: sanitizeAlignment(obj.alignment),
  };
}

// Strips any {{dictionary:N}}/{{example:N}}/{{translation}} inline marker (see lib/dotbot.ts's
// "Inline references" guidance) whose reference doesn't actually exist among THIS response's own
// already-sanitized dictionary/examples/translation panels — same "never trust the model's indices
// blindly" convention as sanitizeAlignment above. An invalid marker is replaced with '' (a minor
// grammatical artifact is an acceptable outcome for the rare case, rather than dropping the whole
// sentence); valid markers pass through completely untouched as literal text, since dotbotText/
// answerBlocks[].content stay plain strings all the way to the client (see parseInlineMarkers,
// app/dotto/lib/mnemonicSearchMatching.ts).
function sanitizeInlineMarkers(
  text: string,
  { dictEntryCount, exampleCount, hasTranslation }: MarkerContext,
): string {
  if (!text) return text;
  let count = 0;
  return text.replace(
    /\{\{(dictionary|example):(\d+)\}\}|\{\{translation\}\}/g,
    (match, kind, idxStr) => {
      if (++count > MAX_INLINE_MARKERS) return "";
      if (match === "{{translation}}") return hasTranslation ? match : "";
      const idx = parseInt(idxStr, 10);
      if (kind === "dictionary") return idx < dictEntryCount ? match : "";
      if (kind === "example") return idx < exampleCount ? match : "";
      return "";
    },
  );
}

// One query's contents, appended as the final user turn after any prior conversation history
// (see loadConversationHistory/generateOnce below — a query can now be a follow-up continuing an
// earlier exchange, not always a fresh independent one). cardContext/cardConnections are the
// cards the user dragged into the search box (see addCardsToSearchContext in
// app/dotto/lib/shelfSearch.ts) —
// already reduced to short plain-text descriptions client-side, so this just re-caps defensively
// and appends them as a labeled block the prompt tells the model how to use. Returns a plain
// string (the user message's content) rather than Gemini's {role,parts} contents array, since
// Groq's chat completion API takes a flat OpenAI-style messages array instead.
function buildContents(
  query: string,
  canvasMatches: unknown[] | undefined,
  cardContext: unknown,
  cardConnections: unknown,
  sourceContext: unknown,
  existingSummary: string | null,
  existingMemory: string | null,
): string {
  const contextLine =
    canvasMatches && canvasMatches.length
      ? `Canvas matches found: ${JSON.stringify(canvasMatches)}`
      : "No canvas matches found for this query.";
  let cardBlock = "";
  // Only present when loadConversationHistory reports this conversation's history has actually
  // been truncated (see the "truncated" flag) — matches DOTBOT_CONVERSATION_SUMMARY_INSTRUCTIONS
  // only being appended to the system prompt under that same condition, so the model is never
  // asked to produce a field it wasn't given anything to base it on.
  if (existingSummary) {
    cardBlock += `\n\nSummary of earlier parts of this conversation (not shown verbatim above):\n${existingSummary}`;
  }
  // Only present for a pro/polyglot-plan user (see DOTBOT_USER_MEMORY_INSTRUCTIONS) — omitted
  // entirely for a free-plan user or a user with no memory recorded yet.
  if (existingMemory) {
    cardBlock += `\n\nWhat you already remember about this user, from past conversations:\n${existingMemory}`;
  }
  if (Array.isArray(cardContext) && cardContext.length) {
    const cards = cardContext
      .filter((c) => typeof c === "string" && c.trim())
      .slice(0, MAX_CARD_CONTEXT)
      .map((c) => c.trim().slice(0, MAX_CARD_TEXT_LEN));
    if (cards.length) {
      cardBlock += `\n\nCards attached to this query:\n${cards.map((c, i) => `${i + 1}. ${c}`).join("\n")}`;
      if (Array.isArray(cardConnections) && cardConnections.length) {
        const conns = cardConnections
          .filter((c) => typeof c === "string" && c.trim())
          .slice(0, MAX_CARD_CONTEXT);
        if (conns.length)
          cardBlock += `\n\nData links between attached cards:\n${conns.join("\n")}`;
      }
      // Numbered to match the card list just above (both built client-side from the same
      // searchCardContext array, in the same order — see describeCardForAI's caller in
      // app/dotto/lib/searchOrchestrationSelection.ts) so the model can point
      // "sourceAction.targetIndex" straight back at one.
      if (Array.isArray(sourceContext) && sourceContext.length) {
        const sources = sourceContext
          .filter(
            (s) =>
              s && typeof s === "object" && Number.isFinite((s as Record<string, unknown>).index),
          )
          .slice(0, MAX_CARD_CONTEXT);
        if (sources.length) {
          cardBlock += `\n\nSources attached to this query (numbered to match the cards above):\n${sources
            .map((s) => {
              const src = s as Record<string, unknown>;
              const headers = Array.isArray(src.headers)
                ? src.headers.slice(0, MAX_SOURCE_COLS)
                : [];
              return `${src.index}. Columns: ${JSON.stringify(headers)}; ${Number(src.rowCount) || 0} data rows.`;
            })
            .join("\n")}`;
        }
      }
    }
  }
  return `${contextLine}${cardBlock}\n\nUser query: "${query}"`;
}

// Flattens one stored assistant turn's `panels` array (the exact shape buildPanels returns, and
// the exact shape persisted verbatim in dotbot_messages.content — see append_dotbot_turn) into a
// short plain-text summary for the MODEL's own memory of what it previously told the user. The
// model doesn't need its own past structured JSON back, just a reasonable recollection of what it
// said, the same way a human wouldn't recite their own prior answer verbatim before continuing —
// dictionary/translation entries collapse to compact "word: definition" lines, dotbot_text and
// answer_blocks' prose paragraphs are taken close to verbatim (they're already the closest thing
// to "what Dotbot said"), and canvas_results/source_action (not prose, nothing to summarize into
// conversation memory) are skipped entirely.
function summarizeAssistantContent(panels: unknown): string {
  if (!Array.isArray(panels)) return "";
  const parts: string[] = [];
  for (const p of panels) {
    if (!p || typeof p !== "object") continue;
    const panel = p as Record<string, unknown>;
    if (panel.type === "dotbot_text" && panel.text) {
      parts.push(String(panel.text));
    } else if (panel.type === "answer_blocks" && Array.isArray(panel.blocks)) {
      for (const b of panel.blocks) {
        if (b && b.type === "text" && b.content) parts.push(String(b.content));
      }
    } else if (panel.type === "dictionary" && Array.isArray(panel.entries)) {
      for (const e of panel.entries) {
        if (e && e.word && e.definition) parts.push(`${e.word}: ${e.definition}`);
      }
    } else if (panel.type === "translation" && panel.sourceWord && panel.targetWord) {
      parts.push(
        `${panel.sourceWord} (${panel.sourceLanguage}) = ${panel.targetWord} (${panel.targetLanguage})`,
      );
    }
  }
  return parts.join(" ").trim().slice(0, MAX_HISTORY_TEXT_LEN);
}

interface ConversationHistory {
  messages: { role: "user" | "assistant"; content: string }[];
  summary: string | null;
  truncated: boolean;
}

// Loads the most recent prior turns of an existing conversation (RLS already scopes this to the
// caller's own rows regardless of what conversationId was supplied — an id belonging to someone
// else, or a stale/deleted one, just resolves to zero rows here rather than leaking anything) and
// reshapes them into Groq's flat {role, content} message shape, plus the conversation's own
// running summary (if any — see the two-tier memory feature) and whether this conversation's
// history has actually been truncated to the recent window (i.e. there's more before it than what
// "messages" contains) — the signal that gates whether DOTBOT_CONVERSATION_SUMMARY_INSTRUCTIONS
// gets appended to the prompt at all. User turns' stored content is {query} (see
// append_dotbot_turn); assistant turns' content is a raw panels array, flattened via
// summarizeAssistantContent above. Empty/unsummarizable turns are dropped rather than sent as
// blank messages. A null/undefined conversationId (brand-new conversation) and a just-reopened
// saved chat (see openSavedChat, app/dotto/lib/hamburgerCollab.ts) both flow through this exact
// same path — the summary is always read fresh from the DB per-request, never client-cached, so
// reopening needs no special-casing at all.
async function loadConversationHistory(
  supabase: Supabase,
  conversationId: string | null | undefined,
): Promise<ConversationHistory> {
  if (!conversationId) return { messages: [], summary: null, truncated: false };
  // Secondary sort on "role" descending is a tiebreaker for rows with an identical created_at
  // ("user" > "assistant" alphabetically, so descending puts user first) — append_dotbot_turn now
  // sets created_at via clock_timestamp() so new rows never actually tie (see the
  // 20260819_fix_dotbot_turn_ordering.sql migration), but this also protects any older rows
  // already in the database from before that fix, where both inserts shared one now()-frozen
  // timestamp and could otherwise come back as [assistant, user] instead of [user, assistant].
  // count:"exact" piggybacks the total-row count onto this same query (no extra round trip) —
  // that's what "truncated" below is computed from, run in parallel with the conversation's own
  // summary lookup.
  const [messagesRes, conversationRes] = await Promise.all([
    supabase
      .from("dotbot_messages")
      .select("role, content", { count: "exact" })
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .order("role", { ascending: false }),
    supabase
      .from("dotbot_conversations")
      .select("conversation_summary")
      .eq("id", conversationId)
      .single(),
  ]);
  const { data, error, count } = messagesRes;
  if (error) {
    console.error("[dotbot/orchestrate] failed to load conversation history:", error);
    return { messages: [], summary: null, truncated: false };
  }
  const messages = (data || [])
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => {
      const content =
        m.role === "user"
          ? String((m.content && (m.content as Record<string, unknown>).query) || "").trim()
          : summarizeAssistantContent(m.content);
      return content ? { role: m.role as "user" | "assistant", content } : null;
    })
    .filter((m): m is { role: "user" | "assistant"; content: string } => m !== null);
  const summary = conversationRes.error ? null : conversationRes.data?.conversation_summary || null;
  return { messages, summary, truncated: (count || 0) > MAX_HISTORY_MESSAGES };
}

// Turns the model's { dictionary, examples, dotbotText, showCanvasResults } response into the
// flat, ordered `panels` array the client already renders (see renderOrchestrateResult,
// app/dotto/lib/searchOrchestrationSelection.ts). dotbot_text is
// listed last here — the client renders it as the top/first panel regardless of array order
// (see renderOrchestrateResult) since a written answer takes priority when present, but the
// prompt has it reference the dictionary card ("as shown above") rather than repeat it, so this
// order is mostly informational.
//
// `parsed` is the model's raw JSON response — deliberately left untyped (the whole point of every
// field access below is defensively re-validating it field-by-field rather than trusting its
// shape, per this route's own "never trust structured output blindly" convention), and the
// returned panels array is similarly heterogeneous by design (a real discriminated union of ~8
// panel shapes) — narrowly typing either would just recreate this function's own body as a type.
function buildPanels(
  parsed: Record<string, any>,
  hasCanvasMatches: boolean,
): Record<string, any>[] {
  const panels: Record<string, any>[] = [];

  // One entry per distinct sense (e.g. "tear" verb vs. noun) — not one entry with multiple
  // definitions, see the prompt/schema comments in lib/dotbot.ts. Entries no longer carry their
  // own example sentences — "examples" below always covers that instead, shown alongside
  // whichever entry is current, so there's only ever one set of sentences to keep in sync.
  const dictArr = Array.isArray(parsed.dictionary) ? parsed.dictionary : [];
  const entries = dictArr
    .map((d: unknown) => {
      if (!d || typeof d !== "object") return null;
      const obj = d as Record<string, unknown>;
      const word = String(obj.word || "")
        .trim()
        .slice(0, MAX_WORD_LEN);
      const definition = String(obj.definition || "")
        .trim()
        .slice(0, MAX_DEF_LEN);
      if (!word || !definition) return null;
      const grammarTags = Array.isArray(obj.grammarTags)
        ? obj.grammarTags
            .filter((t: unknown) => typeof t === "string" && t.trim())
            .map((t: string) => t.trim().slice(0, MAX_WORD_LEN))
            .slice(0, MAX_GRAMMAR_TAGS)
        : [];
      return {
        word,
        transliteration: obj.transliteration
          ? String(obj.transliteration).trim().slice(0, MAX_WORD_LEN)
          : "",
        ipa: obj.ipa
          ? String(obj.ipa)
              .trim()
              .replace(/^\/+|\/+$/g, "")
              .slice(0, MAX_IPA_LEN)
          : "",
        language: obj.language ? String(obj.language).trim().slice(0, MAX_WORD_LEN) : "",
        grammarTags,
        definition,
      };
    })
    .filter((e: unknown): e is Record<string, unknown> => e !== null)
    .slice(0, MAX_LIST_LEN);
  if (entries.length) panels.push({ type: "dictionary", entries });

  // Its own small panel, rendered above "dictionary" client-side (see renderOrchestrateResult) —
  // only for direct translation-style queries, see lib/dotbot.ts.
  const tr = parsed.translation;
  if (tr && typeof tr === "object") {
    const sourceWord = String(tr.sourceWord || "")
      .trim()
      .slice(0, MAX_WORD_LEN);
    const targetWord = String(tr.targetWord || "")
      .trim()
      .slice(0, MAX_WORD_LEN);
    const sourceLanguage = String(tr.sourceLanguage || "")
      .trim()
      .slice(0, MAX_WORD_LEN);
    const targetLanguage = String(tr.targetLanguage || "")
      .trim()
      .slice(0, MAX_WORD_LEN);
    if (sourceWord && targetWord && sourceLanguage && targetLanguage) {
      panels.push({ type: "translation", sourceWord, sourceLanguage, targetWord, targetLanguage });
    }
  }

  // Always attached alongside "dictionary" (for its primary sense) as well as standalone for
  // other queries — no longer gated on "no dictionary present" now that entries don't carry
  // their own sentences (see above).
  const ex = parsed.examples;
  if (ex && typeof ex === "object") {
    const sentences = Array.isArray(ex.sentences)
      ? ex.sentences
          .map(sanitizeSentence)
          .filter((s: SanitizedSentence | null): s is SanitizedSentence => s !== null)
          .slice(0, MAX_LIST_LEN)
      : [];
    if (sentences.length) {
      const panel: Record<string, any> = { type: "examples", sentences };
      // Powers each sentence's own TTS button client-side (see buildExamplesCard) — falls back
      // to the default English voice if omitted, same as it always did before TTS existed here.
      if (ex.language) panel.language = String(ex.language).trim().slice(0, MAX_WORD_LEN);
      panels.push(panel);
    }
  }

  if (hasCanvasMatches && parsed.showCanvasResults) panels.push({ type: "canvas_results" });

  // Validated against THIS response's own entries/sentences/tr (computed just above) — see
  // sanitizeInlineMarkers.
  const markerContext: MarkerContext = {
    dictEntryCount: entries.length,
    exampleCount: panels.some((p) => p.type === "examples")
      ? panels.find((p) => p.type === "examples").sentences.length
      : 0,
    hasTranslation: panels.some((p) => p.type === "translation"),
  };

  const text = sanitizeInlineMarkers(String(parsed.dotbotText || "").trim(), markerContext);
  if (text) panels.push({ type: "dotbot_text", text });

  // An in-depth grammar/explanation answer, ordered blocks of prose + highlighted example
  // sentences — see lib/dotbot.ts. Omitted entirely for a simple lookup, where dotbotText above
  // is the whole answer.
  const ab = parsed.answerBlocks;
  if (Array.isArray(ab) && ab.length) {
    const blocks = ab
      .map((b: unknown) => {
        if (!b || typeof b !== "object") return null;
        const obj = b as Record<string, unknown>;
        if (obj.type === "text") {
          const content = sanitizeInlineMarkers(
            String(obj.content || "")
              .trim()
              .slice(0, MAX_BLOCK_TEXT_LEN),
            markerContext,
          );
          return content ? { type: "text", content } : null;
        }
        if (obj.type === "example") {
          const bText = String(obj.text || "")
            .trim()
            .slice(0, MAX_DEF_LEN);
          if (!bText) return null;
          return {
            type: "example",
            text: bText,
            translation: obj.translation
              ? String(obj.translation).trim().slice(0, MAX_DEF_LEN)
              : bText,
            romanization: obj.romanization
              ? String(obj.romanization).trim().slice(0, MAX_DEF_LEN)
              : "",
            alignment: sanitizeAlignment(obj.alignment),
          };
        }
        return null;
      })
      .filter((b: unknown): b is Record<string, unknown> => b !== null)
      .slice(0, MAX_ANSWER_BLOCKS);
    if (blocks.length) panels.push({ type: "answer_blocks", blocks });
  }

  // Always shown now, not just when Dotbot couldn't help — the chat thread's "what could I ask
  // next" suggestions (see the prompt's own updated guidance on "recommendedSearches": contextual,
  // specific follow-ups building on THIS answer for a normal success, or the original unrelated-
  // topics redirect for the off-topic/casual-chat canHelp:false cases).
  if (Array.isArray(parsed.recommendedSearches)) {
    const queries = parsed.recommendedSearches
      .filter((q: unknown) => typeof q === "string" && q.trim())
      .map((q: string) => q.trim().slice(0, MAX_WORD_LEN * 3))
      .slice(0, MAX_RECOMMENDED);
    // "...continues" the trailing-off intro sentence as its own fragment for a successful answer
    // (or a plainer lead-in for the off-topic/casual-chat redirect cases) — see the prompt's own
    // guidance on "recommendedIntro". Falls back to a generic label if the model omits it (or for
    // panels persisted before this field existed — see ChatTurn, app/dotto/ChatThread.jsx) rather
    // than rendering with no lead-in text at all.
    const intro =
      typeof parsed.recommendedIntro === "string" && parsed.recommendedIntro.trim()
        ? parsed.recommendedIntro.trim().slice(0, MAX_RECOMMENDED_INTRO_LEN)
        : "Next, I could:";
    if (queries.length) panels.push({ type: "recommended_searches", intro, queries });
  }

  // Generated source content — either new rows for an attached source or a whole new source
  // card. Not trusted just because the schema shape matched: still re-capped here the same way
  // every other panel is, since the client writes these cells straight into tableData.
  const sa = parsed.sourceAction;
  if (sa && typeof sa === "object" && (sa.type === "add_rows" || sa.type === "create_source")) {
    const columns = Array.isArray(sa.columns)
      ? sa.columns
          .filter((c: unknown) => typeof c === "string" && c.trim())
          .map((c: string) => c.trim().slice(0, MAX_WORD_LEN))
          .slice(0, MAX_SOURCE_COLS)
      : [];
    const rows = Array.isArray(sa.rows)
      ? sa.rows
          .slice(0, MAX_SOURCE_ROWS)
          .map((r: unknown) => {
            const cells = Array.isArray((r as Record<string, unknown>)?.cells)
              ? (r as Record<string, unknown>).cells
              : Array.isArray(r)
                ? r
                : [];
            return (cells as unknown[])
              .filter((c) => typeof c === "string" || typeof c === "number")
              .map((c) => String(c).trim().slice(0, MAX_SOURCE_CELL_LEN))
              .slice(0, MAX_SOURCE_COLS);
          })
          .filter((r: string[]) => r.length && r.some((c) => c))
      : [];
    if (rows.length) {
      const panel: Record<string, any> = { type: "source_action", action: sa.type, columns, rows };
      if (sa.type === "add_rows")
        panel.targetIndex = Number.isFinite(sa.targetIndex) ? sa.targetIndex : 1;
      if (sa.type === "create_source")
        panel.title = sa.title ? String(sa.title).trim().slice(0, 80) : "New Source";
      panels.push(panel);
    }
  }

  return panels;
}

export async function POST(request: NextRequest) {
  const {
    query,
    canvasMatches,
    cardContext,
    cardConnections,
    sourceContext,
    conversationId: requestedConversationId,
  } = await request.json();
  if (!query || !query.trim()) {
    return NextResponse.json({ error: "empty_query" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const groq = getGroqClient();
  if (!groq) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  if (!(await peekSearchCredits(supabase, user.id, 3))) {
    return NextResponse.json({ error: "no_credits" }, { status: 402 });
  }

  // A follow-up continuing an existing thread (requestedConversationId set by the client — see
  // appState.currentConversationId, app/dotto/lib/searchOrchestrationSelection.ts) vs. a fresh
  // one. RLS-scoped read, so a stale/foreign id just resolves to no history rather than a leak —
  // treated the same as starting fresh in that case.
  const {
    messages: history,
    summary: existingSummary,
    truncated,
  } = await loadConversationHistory(supabase, requestedConversationId);

  // Gates the cross-conversation memory tier (see DOTBOT_USER_MEMORY_INSTRUCTIONS) — a single
  // cheap profiles lookup, fails closed to "free"/no memory rather than blocking the request.
  const { plan, dotbotMemory: existingMemory } = await getDotbotProfile(supabase, user.id);
  const isProOrPolyglot = plan === "pro" || plan === "polyglot";

  // Both instruction blocks are appended only when actually warranted, so a short conversation on
  // the free plan pays zero extra prompt tokens for either — see each constant's own comment
  // (lib/dotbot.ts) for why.
  const systemPrompt =
    DOTBOT_ORCHESTRATE_SYSTEM_PROMPT +
    (truncated ? DOTBOT_CONVERSATION_SUMMARY_INSTRUCTIONS : "") +
    (isProOrPolyglot ? DOTBOT_USER_MEMORY_INSTRUCTIONS : "");

  const hasCanvasMatches = !!(canvasMatches && canvasMatches.length);
  const generateOnce = async () => {
    const completion = await groq.chat.completions.create({
      model: GROQ_TEXT_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        ...history,
        {
          role: "user",
          content: buildContents(
            query,
            canvasMatches,
            cardContext,
            cardConnections,
            sourceContext,
            existingSummary,
            isProOrPolyglot ? existingMemory : null,
          ),
        },
      ],
      response_format: { type: "json_object" },
      // This org's Groq on_demand tier caps qwen/qwen3.6-27b at 8000 TPM (tokens per minute) —
      // and Groq counts the REQUESTED max_tokens against that budget up front, not actual usage,
      // regardless of how much the model really generates. The old value here (12000) alone
      // already exceeded the entire per-minute budget on top of this prompt's ~3300 tokens,
      // which is exactly what surfaced as "really really slow" in practice: most calls either
      // hit an outright 413 rate_limit_exceeded (see the retry logic below) or sat queued for
      // 10-30s while Groq throttled the org back under budget. Actual completion usage measured
      // directly against Groq for typical queries — including a full in-depth grammar
      // explanation with several answerBlocks — never exceeded ~1000 tokens, so 4000 leaves
      // generous headroom for the common cases (dictionary/examples/translation/answerBlocks)
      // while comfortably fitting under the 8000 TPM ceiling alongside the prompt. The one
      // exception is sourceAction generating close to its 150-row cap, which can genuinely need
      // more than this and may truncate/rate-limit on this tier — a real Groq billing-tier
      // constraint, not something client-side tuning alone can fully route around. Lowered from
      // 4000 to 3600 when the two-tier memory feature shipped: the conditional summary/memory
      // instructions plus their injected existing-value context add an estimated 450-530 tokens
      // in the worst case (truncated history + pro/polyglot plan with existing memory), which was
      // uncomfortably close to the ~700-token margin this file already documents against the
      // 8000 TPM cap. 3600 buys back headroom without meaningfully affecting the common cases,
      // which measured under 1000 tokens to begin with.
      max_tokens: 3600,
      // Low and deterministic — this is structured panel selection / linguistic lookup, not
      // creative writing, and low temperature also reduces the odds of the model drifting into
      // the free-form-text failure mode json_object mode doesn't fully guard against on its own.
      temperature: 0.2,
      // "none" — see lib/groq.ts. This is single-turn panel selection, not multi-step reasoning,
      // and thinking mode would otherwise spend part of max_tokens on an invisible reasoning pass
      // before ever writing the actual JSON (the same failure class this app hit when its text
      // routes ran on Gemini, before migrating to Groq).
      reasoning_effort: GROQ_REASONING_EFFORT,
    });
    const content = completion.choices[0].message.content ?? "{}";
    const parsed = JSON.parse(content);
    // Pure server-side metadata, never pushed into the client-visible panels array (unlike every
    // real panel type, these are invisible to the user) — extracted here, capped defensively the
    // same way every other field in buildPanels is, regardless of the prompt's own length
    // guidance. Empty after trim = "the model had nothing new to add," treated as absent.
    const conversationSummary = truncated
      ? String(parsed.conversationSummary || "")
          .trim()
          .slice(0, MAX_CONVERSATION_SUMMARY_LEN) || null
      : null;
    const userMemoryUpdate = isProOrPolyglot
      ? String(parsed.userMemoryUpdate || "")
          .trim()
          .slice(0, MAX_USER_MEMORY_LEN) || null
      : null;
    return { panels: buildPanels(parsed, hasCanvasMatches), conversationSummary, userMemoryUpdate };
  };

  let panels: Record<string, any>[],
    conversationSummary: string | null,
    userMemoryUpdate: string | null;
  try {
    ({ panels, conversationSummary, userMemoryUpdate } = await generateOnce());
  } catch (err) {
    // A rare but real failure mode (carried over from the Gemini implementation, and just as
    // possible here): the model occasionally rambles well past a normal response length, running
    // out of max_tokens mid-string and leaving unparseable truncated JSON. One retry clears it
    // almost always, since it's a per-request quirk, not a deterministic response to the query.
    console.error("[dotbot/orchestrate] Groq request failed, retrying once:", err);
    try {
      ({ panels, conversationSummary, userMemoryUpdate } = await generateOnce());
    } catch (err2) {
      console.error("[dotbot/orchestrate] Groq retry also failed:", err2);
      return NextResponse.json({ error: "generation_failed" }, { status: 502 });
    }
  }
  if (!panels.length) return NextResponse.json({ error: "empty_response" }, { status: 502 });

  // Only charged now that generation actually succeeded.
  await spendSearchCredits(supabase, 3);

  // Persists both this turn (user query + the fresh panels just generated) and, when
  // requestedConversationId was null, creates the conversation itself — see append_dotbot_turn
  // (supabase/migrations/20260820_add_dotbot_memory.sql, extending the original in
  // 20260819_add_dotbot_conversations.sql). Deliberately fails soft: a persistence error
  // shouldn't hide an AI answer the user already paid credits for and is about to see: catches —
  // falls back to requestedConversationId (possibly still null) so the client simply won't have a
  // saved thread to continue for this exchange, resuming as a fresh conversation on the next
  // message rather than erroring out here. The cross-conversation memory update runs alongside it
  // (Promise.all, not fire-and-forget — no verified background-job mechanism exists in this
  // codebase, and this is a single indexed UPDATE by primary key, negligible latency next to the
  // Groq call it's already stacked after), only when there's actually something new to write.
  let conversationId: string | null = requestedConversationId || null;
  const [{ data: persistedConversationId, error: persistError }, memoryResult] = await Promise.all([
    supabase.rpc("append_dotbot_turn", {
      p_conversation_id: requestedConversationId || null,
      p_title: query.trim().slice(0, 80),
      p_user_content: { query: query.trim() },
      p_assistant_content: panels,
      p_conversation_summary: conversationSummary,
    }),
    isProOrPolyglot && userMemoryUpdate && userMemoryUpdate !== existingMemory
      ? supabase.rpc("update_dotbot_memory", { p_memory: userMemoryUpdate })
      : Promise.resolve({ error: null }),
  ]);
  if (persistError) {
    console.error("[dotbot/orchestrate] failed to persist chat turn:", persistError);
  } else {
    conversationId = persistedConversationId;
  }
  if (memoryResult.error) {
    console.error("[dotbot/orchestrate] failed to persist user memory:", memoryResult.error);
  }

  return NextResponse.json({ panels, conversationId });
}
