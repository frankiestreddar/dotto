import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getGroqClient, GROQ_TEXT_MODEL, GROQ_REASONING_EFFORT } from "@/lib/groq";
import {
  DOTBOT_ORCHESTRATE_SYSTEM_PROMPT,
  peekSearchCredits,
  spendSearchCredits,
} from "@/lib/dotbot";
// DOTBOT_ORCHESTRATE_SCHEMA (still defined in lib/dotbot.js, deliberately left untouched) isn't
// imported here anymore — Groq's chat completion API has no equivalent of Gemini's structured
// responseSchema parameter. The desired shape is instead conveyed entirely through
// DOTBOT_ORCHESTRATE_SYSTEM_PROMPT's own prose description (already comprehensive) plus
// response_format:"json_object" below, same as it always effectively was for the model itself —
// the schema was already just a secondary technical constraint on top of that prose, never the
// only source of truth (see buildPanels(), which never trusted it blindly either).

const MAX_LIST_LEN = 5; // sentences / dictionary entries — defensive cap, schema alone isn't trusted (see lib/dotbot.js)
const MAX_WORD_LEN = 60; // headword/transliteration/grammarTags/language — defensive cap regardless of prompt behavior
const MAX_IPA_LEN = 80;
const MAX_DEF_LEN = 220; // a single definition, one sense only — should always be well under 15 words in practice
const MAX_RECOMMENDED = 3;
const MAX_CARD_CONTEXT = 10; // cards dragged into the search box — defensive cap on an already-client-capped set
const MAX_CARD_TEXT_LEN = 300; // one card's describeCardForAI() text — a note or a few flashcard rows, not a whole table dump
const MAX_SOURCE_COLS = 10; // sourceAction.columns / an attached source's headers — a source is never just 2 columns, but still bounded
const MAX_SOURCE_ROWS = 150; // sourceAction.rows — matches the cap stated in the prompt, enforced here regardless of prompt compliance
const MAX_SOURCE_CELL_LEN = 200; // one generated cell's text
const MAX_ALIGNMENT_PAIRS = 24; // per sentence — full word-for-word coverage now (see lib/dotbot.js), not just a pedagogically useful subset, so longer sentences need real headroom here
const MAX_ALIGNMENT_PHRASE_LEN = 80;
const MAX_GRAMMAR_TAGS = 4; // per dictionary entry — part of speech plus a few notable properties, each renders as its own pill
const MAX_ANSWER_BLOCKS = 12;
const MAX_BLOCK_TEXT_LEN = 600; // one prose paragraph in an in-depth grammar/explanation answer
const MAX_HISTORY_MESSAGES = 20; // most-recent N prior turns (user+assistant combined) sent as context
const MAX_HISTORY_TEXT_LEN = 500; // one flattened assistant turn's summary, in the history sent back to the model

// {sourcePhrase, targetPhrase} pairs for word-for-word highlighting between a sentence's "text"
// and "translation" — see lib/dotbot.js's ALIGNMENT_SCHEMA. Only shape/length is validated here;
// whether each phrase actually appears verbatim in its sentence is checked client-side (which
// needs to search for it anyway to know where to highlight), and silently skipped if not found.
function sanitizeAlignment(a) {
  if (!Array.isArray(a)) return [];
  return a
    .map((p) => {
      if (!p || typeof p !== "object") return null;
      const sourcePhrase = String(p.sourcePhrase || "").trim().slice(0, MAX_ALIGNMENT_PHRASE_LEN);
      const targetPhrase = String(p.targetPhrase || "").trim().slice(0, MAX_ALIGNMENT_PHRASE_LEN);
      if (!sourcePhrase || !targetPhrase) return null;
      return { sourcePhrase, targetPhrase };
    })
    .filter(Boolean)
    .slice(0, MAX_ALIGNMENT_PAIRS);
}

// A {text, translation, romanization, alignment} example sentence, or null — shared by
// standalone "examples.sentences" and "answerBlocks[].type==='example'" (dictionary entries no
// longer carry their own sentences — see lib/dotbot.js). "romanization" is a Latin-script
// transliteration of "text", present only when the model decided "text" isn't already Latin
// script (same convention as the dictionary headword's "transliteration" field) — its mere
// presence/absence is what the client uses to decide whether to show a transliteration line, so
// no separate script-detection is needed there.
function sanitizeSentence(s) {
  if (!s || typeof s !== "object") return null;
  const text = String(s.text || "").trim().slice(0, MAX_DEF_LEN);
  if (!text) return null;
  return {
    text,
    translation: s.translation ? String(s.translation).trim().slice(0, MAX_DEF_LEN) : text,
    romanization: s.romanization ? String(s.romanization).trim().slice(0, MAX_DEF_LEN) : "",
    alignment: sanitizeAlignment(s.alignment),
  };
}

// One query's contents, appended as the final user turn after any prior conversation history
// (see loadConversationHistory/generateOnce below — a query can now be a follow-up continuing an
// earlier exchange, not always a fresh independent one). cardContext/cardConnections are the
// cards the user dragged into the search box (see addCardsToSearchContext in dotto-script.js) —
// already reduced to short plain-text descriptions client-side, so this just re-caps defensively
// and appends them as a labeled block the prompt tells the model how to use. Returns a plain
// string (the user message's content) rather than Gemini's {role,parts} contents array, since
// Groq's chat completion API takes a flat OpenAI-style messages array instead.
function buildContents(query, canvasMatches, cardContext, cardConnections, sourceContext) {
  const contextLine =
    canvasMatches && canvasMatches.length
      ? `Canvas matches found: ${JSON.stringify(canvasMatches)}`
      : "No canvas matches found for this query.";
  let cardBlock = "";
  if (Array.isArray(cardContext) && cardContext.length) {
    const cards = cardContext
      .filter((c) => typeof c === "string" && c.trim())
      .slice(0, MAX_CARD_CONTEXT)
      .map((c) => c.trim().slice(0, MAX_CARD_TEXT_LEN));
    if (cards.length) {
      cardBlock += `\n\nCards attached to this query:\n${cards.map((c, i) => `${i + 1}. ${c}`).join("\n")}`;
      if (Array.isArray(cardConnections) && cardConnections.length) {
        const conns = cardConnections.filter((c) => typeof c === "string" && c.trim()).slice(0, MAX_CARD_CONTEXT);
        if (conns.length) cardBlock += `\n\nData links between attached cards:\n${conns.join("\n")}`;
      }
      // Numbered to match the card list just above (both built client-side from the same
      // searchCardContext array, in the same order — see describeCardForAI's caller in
      // dotto-script.js) so the model can point "sourceAction.targetIndex" straight back at one.
      if (Array.isArray(sourceContext) && sourceContext.length) {
        const sources = sourceContext
          .filter((s) => s && typeof s === "object" && Number.isFinite(s.index))
          .slice(0, MAX_CARD_CONTEXT);
        if (sources.length) {
          cardBlock += `\n\nSources attached to this query (numbered to match the cards above):\n${sources
            .map((s) => {
              const headers = Array.isArray(s.headers) ? s.headers.slice(0, MAX_SOURCE_COLS) : [];
              return `${s.index}. Columns: ${JSON.stringify(headers)}; ${Number(s.rowCount) || 0} data rows.`;
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
function summarizeAssistantContent(panels) {
  if (!Array.isArray(panels)) return "";
  const parts = [];
  for (const p of panels) {
    if (!p || typeof p !== "object") continue;
    if (p.type === "dotbot_text" && p.text) {
      parts.push(p.text);
    } else if (p.type === "answer_blocks" && Array.isArray(p.blocks)) {
      for (const b of p.blocks) {
        if (b && b.type === "text" && b.content) parts.push(b.content);
      }
    } else if (p.type === "dictionary" && Array.isArray(p.entries)) {
      for (const e of p.entries) {
        if (e && e.word && e.definition) parts.push(`${e.word}: ${e.definition}`);
      }
    } else if (p.type === "translation" && p.sourceWord && p.targetWord) {
      parts.push(`${p.sourceWord} (${p.sourceLanguage}) = ${p.targetWord} (${p.targetLanguage})`);
    }
  }
  return parts.join(" ").trim().slice(0, MAX_HISTORY_TEXT_LEN);
}

// Loads the most recent prior turns of an existing conversation (RLS already scopes this to the
// caller's own rows regardless of what conversationId was supplied — an id belonging to someone
// else, or a stale/deleted one, just resolves to zero rows here rather than leaking anything) and
// reshapes them into Groq's flat {role, content} message shape. User turns' stored content is
// {query} (see append_dotbot_turn); assistant turns' content is a raw panels array, flattened via
// summarizeAssistantContent above. Empty/unsummarizable turns are dropped rather than sent as
// blank messages.
async function loadConversationHistory(supabase, conversationId) {
  if (!conversationId) return [];
  const { data, error } = await supabase
    .from("dotbot_messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("[dotbot/orchestrate] failed to load conversation history:", error);
    return [];
  }
  return (data || [])
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => {
      const content = m.role === "user" ? String((m.content && m.content.query) || "").trim() : summarizeAssistantContent(m.content);
      return content ? { role: m.role, content } : null;
    })
    .filter(Boolean);
}

// Turns the model's { dictionary, examples, dotbotText, showCanvasResults } response into the
// flat, ordered `panels` array the client already renders (see dotto-script.js). dotbot_text is
// listed last here — the client renders it as the top/first panel regardless of array order
// (see renderOrchestrateResult) since a written answer takes priority when present, but the
// prompt has it reference the dictionary card ("as shown above") rather than repeat it, so this
// order is mostly informational.
function buildPanels(parsed, hasCanvasMatches) {
  const panels = [];

  // One entry per distinct sense (e.g. "tear" verb vs. noun) — not one entry with multiple
  // definitions, see the prompt/schema comments in lib/dotbot.js. Entries no longer carry their
  // own example sentences — "examples" below always covers that instead, shown alongside
  // whichever entry is current, so there's only ever one set of sentences to keep in sync.
  const dictArr = Array.isArray(parsed.dictionary) ? parsed.dictionary : [];
  const entries = dictArr
    .map((d) => {
      if (!d || typeof d !== "object") return null;
      const word = String(d.word || "").trim().slice(0, MAX_WORD_LEN);
      const definition = String(d.definition || "").trim().slice(0, MAX_DEF_LEN);
      if (!word || !definition) return null;
      const grammarTags = Array.isArray(d.grammarTags)
        ? d.grammarTags
            .filter((t) => typeof t === "string" && t.trim())
            .map((t) => t.trim().slice(0, MAX_WORD_LEN))
            .slice(0, MAX_GRAMMAR_TAGS)
        : [];
      return {
        word,
        transliteration: d.transliteration ? String(d.transliteration).trim().slice(0, MAX_WORD_LEN) : "",
        ipa: d.ipa ? String(d.ipa).trim().replace(/^\/+|\/+$/g, "").slice(0, MAX_IPA_LEN) : "",
        language: d.language ? String(d.language).trim().slice(0, MAX_WORD_LEN) : "",
        grammarTags,
        definition,
      };
    })
    .filter(Boolean)
    .slice(0, MAX_LIST_LEN);
  if (entries.length) panels.push({ type: "dictionary", entries });

  // Its own small panel, rendered above "dictionary" client-side (see renderOrchestrateResult) —
  // only for direct translation-style queries, see lib/dotbot.js.
  const tr = parsed.translation;
  if (tr && typeof tr === "object") {
    const sourceWord = String(tr.sourceWord || "").trim().slice(0, MAX_WORD_LEN);
    const targetWord = String(tr.targetWord || "").trim().slice(0, MAX_WORD_LEN);
    const sourceLanguage = String(tr.sourceLanguage || "").trim().slice(0, MAX_WORD_LEN);
    const targetLanguage = String(tr.targetLanguage || "").trim().slice(0, MAX_WORD_LEN);
    if (sourceWord && targetWord && sourceLanguage && targetLanguage) {
      panels.push({ type: "translation", sourceWord, sourceLanguage, targetWord, targetLanguage });
    }
  }

  // Always attached alongside "dictionary" (for its primary sense) as well as standalone for
  // other queries — no longer gated on "no dictionary present" now that entries don't carry
  // their own sentences (see above).
  const ex = parsed.examples;
  if (ex && typeof ex === "object") {
    const sentences = Array.isArray(ex.sentences) ? ex.sentences.map(sanitizeSentence).filter(Boolean).slice(0, MAX_LIST_LEN) : [];
    if (sentences.length) {
      const panel = { type: "examples", sentences };
      // Powers each sentence's own TTS button client-side (see buildExamplesCard) — falls back
      // to the default English voice if omitted, same as it always did before TTS existed here.
      if (ex.language) panel.language = String(ex.language).trim().slice(0, MAX_WORD_LEN);
      panels.push(panel);
    }
  }

  if (hasCanvasMatches && parsed.showCanvasResults) panels.push({ type: "canvas_results" });

  const text = String(parsed.dotbotText || "").trim();
  if (text) panels.push({ type: "dotbot_text", text });

  // An in-depth grammar/explanation answer, ordered blocks of prose + highlighted example
  // sentences — see lib/dotbot.js. Omitted entirely for a simple lookup, where dotbotText above
  // is the whole answer.
  const ab = parsed.answerBlocks;
  if (Array.isArray(ab) && ab.length) {
    const blocks = ab
      .map((b) => {
        if (!b || typeof b !== "object") return null;
        if (b.type === "text") {
          const content = String(b.content || "").trim().slice(0, MAX_BLOCK_TEXT_LEN);
          return content ? { type: "text", content } : null;
        }
        if (b.type === "example") {
          const bText = String(b.text || "").trim().slice(0, MAX_DEF_LEN);
          if (!bText) return null;
          return {
            type: "example",
            text: bText,
            translation: b.translation ? String(b.translation).trim().slice(0, MAX_DEF_LEN) : bText,
            romanization: b.romanization ? String(b.romanization).trim().slice(0, MAX_DEF_LEN) : "",
            alignment: sanitizeAlignment(b.alignment),
          };
        }
        return null;
      })
      .filter(Boolean)
      .slice(0, MAX_ANSWER_BLOCKS);
    if (blocks.length) panels.push({ type: "answer_blocks", blocks });
  }

  // Only shown when Dotbot couldn't actually help (the off-topic/casual-chat redirect
  // branches in the prompt) — gives the user somewhere to go next instead of a dead end.
  if (parsed.canHelp === false && Array.isArray(parsed.recommendedSearches)) {
    const queries = parsed.recommendedSearches
      .filter((q) => typeof q === "string" && q.trim())
      .map((q) => q.trim().slice(0, MAX_WORD_LEN * 3))
      .slice(0, MAX_RECOMMENDED);
    if (queries.length) panels.push({ type: "recommended_searches", queries });
  }

  // Generated source content — either new rows for an attached source or a whole new source
  // card. Not trusted just because the schema shape matched: still re-capped here the same way
  // every other panel is, since the client writes these cells straight into tableData.
  const sa = parsed.sourceAction;
  if (sa && typeof sa === "object" && (sa.type === "add_rows" || sa.type === "create_source")) {
    const columns = Array.isArray(sa.columns)
      ? sa.columns
          .filter((c) => typeof c === "string" && c.trim())
          .map((c) => c.trim().slice(0, MAX_WORD_LEN))
          .slice(0, MAX_SOURCE_COLS)
      : [];
    const rows = Array.isArray(sa.rows)
      ? sa.rows
          .slice(0, MAX_SOURCE_ROWS)
          .map((r) => {
            const cells = Array.isArray(r && r.cells) ? r.cells : Array.isArray(r) ? r : [];
            return cells
              .filter((c) => typeof c === "string" || typeof c === "number")
              .map((c) => String(c).trim().slice(0, MAX_SOURCE_CELL_LEN))
              .slice(0, MAX_SOURCE_COLS);
          })
          .filter((r) => r.length && r.some((c) => c))
      : [];
    if (rows.length) {
      const panel = { type: "source_action", action: sa.type, columns, rows };
      if (sa.type === "add_rows") panel.targetIndex = Number.isFinite(sa.targetIndex) ? sa.targetIndex : 1;
      if (sa.type === "create_source") panel.title = sa.title ? String(sa.title).trim().slice(0, 80) : "New Source";
      panels.push(panel);
    }
  }

  return panels;
}

export async function POST(request) {
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
  // appState.currentConversationId, public/dotto/search-orchestration-selection.js) vs. a fresh
  // one. RLS-scoped read, so a stale/foreign id just resolves to no history rather than a leak —
  // treated the same as starting fresh in that case.
  const history = await loadConversationHistory(supabase, requestedConversationId);

  const hasCanvasMatches = !!(canvasMatches && canvasMatches.length);
  const generateOnce = async () => {
    const completion = await groq.chat.completions.create({
      model: GROQ_TEXT_MODEL,
      messages: [
        { role: "system", content: DOTBOT_ORCHESTRATE_SYSTEM_PROMPT },
        ...history,
        { role: "user", content: buildContents(query, canvasMatches, cardContext, cardConnections, sourceContext) },
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
      // constraint, not something client-side tuning alone can fully route around.
      max_tokens: 4000,
      // Low and deterministic — this is structured panel selection / linguistic lookup, not
      // creative writing, and low temperature also reduces the odds of the model drifting into
      // the free-form-text failure mode json_object mode doesn't fully guard against on its own.
      temperature: 0.2,
      // "none" — see lib/groq.js. This is single-turn panel selection, not multi-step reasoning,
      // and thinking mode would otherwise spend part of max_tokens on an invisible reasoning pass
      // before ever writing the actual JSON (the same failure class this app hit when its text
      // routes ran on Gemini, before migrating to Groq).
      reasoning_effort: GROQ_REASONING_EFFORT,
    });
    const parsed = JSON.parse(completion.choices[0].message.content);
    return buildPanels(parsed, hasCanvasMatches);
  };

  let panels;
  try {
    panels = await generateOnce();
  } catch (err) {
    // A rare but real failure mode (carried over from the Gemini implementation, and just as
    // possible here): the model occasionally rambles well past a normal response length, running
    // out of max_tokens mid-string and leaving unparseable truncated JSON. One retry clears it
    // almost always, since it's a per-request quirk, not a deterministic response to the query.
    console.error("[dotbot/orchestrate] Groq request failed, retrying once:", err);
    try {
      panels = await generateOnce();
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
  // (supabase/migrations/20260819_add_dotbot_conversations.sql). Deliberately fails soft: a
  // persistence error shouldn't hide an AI answer the user already paid credits for and is about
  // to see: catches — falls back to requestedConversationId (possibly still null) so the client
  // simply won't have a saved thread to continue for this exchange, resuming as a fresh
  // conversation on the next message rather than erroring out here.
  let conversationId = requestedConversationId || null;
  const { data: persistedConversationId, error: persistError } = await supabase.rpc("append_dotbot_turn", {
    p_conversation_id: requestedConversationId || null,
    p_title: query.trim().slice(0, 80),
    p_user_content: { query: query.trim() },
    p_assistant_content: panels,
  });
  if (persistError) {
    console.error("[dotbot/orchestrate] failed to persist chat turn:", persistError);
  } else {
    conversationId = persistedConversationId;
  }

  return NextResponse.json({ panels, conversationId });
}
