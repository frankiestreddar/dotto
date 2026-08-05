import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getGroqClient, GROQ_TEXT_MODEL, GROQ_REASONING_EFFORT } from "@/lib/groq";
import { DOTBOT_SUGGEST_SYSTEM_PROMPT } from "@/lib/dotbot";
// DOTBOT_SUGGEST_SCHEMA (still defined in lib/dotbot.js, deliberately left untouched) isn't
// imported here anymore — see the equivalent note in orchestrate/route.js: Groq has no
// structured-schema parameter equivalent to Gemini's responseSchema, so the desired
// {suggestions: [...]} shape is conveyed via DOTBOT_SUGGEST_SYSTEM_PROMPT's own prose plus
// response_format:"json_object" below, with the parsed result still defensively re-validated.

const MAX_SUGGESTIONS = 4;

// Deliberately NOT credit-gated (no peekSearchCredits/spendSearchCredits calls) — this fires on
// every debounced keystroke as live typeahead, not a generation the user explicitly asked for.
// Don't "fix" this into a credit-gated route; that was a resolved design decision, not an
// oversight (see the search/Dotbot overhaul plan).
export async function POST(request) {
  const { query, isSourceFolder } = await request.json();
  if (!query || !query.trim()) {
    return NextResponse.json({ suggestions: [] });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const groq = getGroqClient();
  if (!groq) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  let suggestions = [];
  try {
    const completion = await groq.chat.completions.create({
      model: GROQ_TEXT_MODEL,
      messages: [
        { role: "system", content: DOTBOT_SUGGEST_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Partial input so far: "${query}"${isSourceFolder ? " (user is currently inside a source/flashcard table)" : ""}`,
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 250,
      temperature: 0.2, // deterministic linguistic suggestions, not creative writing
      // "none" — see lib/groq.js. Doubly important here: this fires on nearly every keystroke,
      // so an invisible reasoning pass would add latency/cost to something meant to feel instant.
      reasoning_effort: GROQ_REASONING_EFFORT,
    });
    const parsed = JSON.parse(completion.choices[0].message.content);
    suggestions = Array.isArray(parsed.suggestions)
      ? parsed.suggestions.filter((s) => typeof s === "string" && s.trim()).slice(0, MAX_SUGGESTIONS)
      : [];
  } catch (err) {
    console.error("[dotbot/suggest] Groq request failed:", err);
    return NextResponse.json({ suggestions: [] });
  }

  return NextResponse.json({ suggestions });
}
