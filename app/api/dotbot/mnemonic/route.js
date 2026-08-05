import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getGroqClient, GROQ_TEXT_MODEL, GROQ_REASONING_EFFORT } from "@/lib/groq";
import { DOTBOT_MNEMONIC_SYSTEM_PROMPT, peekGenerationCredits, spendGenerationCredits } from "@/lib/dotbot";

export async function POST(request) {
  const { word } = await request.json();
  if (!word || !word.trim()) {
    return NextResponse.json({ error: "empty_word" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const groq = getGroqClient();
  if (!groq) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  if (!(await peekGenerationCredits(supabase, user.id, 3))) {
    return NextResponse.json({ error: "no_credits" }, { status: 402 });
  }

  let target_word, translation, keyword, sentence, image_scene;
  try {
    // No temperature override here (unlike the other routes' deliberate 0.2) — a mnemonic story
    // is meant to be vivid and creative, not deterministic linguistic output, so it's left at
    // Groq's own default rather than flattening it.
    const completion = await groq.chat.completions.create({
      model: GROQ_TEXT_MODEL,
      messages: [
        { role: "system", content: DOTBOT_MNEMONIC_SYSTEM_PROMPT },
        { role: "user", content: `Target word: "${word}"` },
      ],
      // Groq has no structured-schema parameter equivalent to Gemini's responseSchema — the
      // 5-field shape is conveyed via the prompt's own prose plus response_format:"json_object"
      // here, same convention as suggest/orchestrate routes, with the parsed result still
      // defensively re-validated below.
      response_format: { type: "json_object" },
      // image_scene has no fixed word-count target (quality over length — see the prompt), so
      // this leaves generous headroom rather than the tighter budget a capped-length field would
      // need, to avoid truncating mid-JSON and breaking the parse below.
      max_tokens: 300,
      // "none" — see lib/groq.js. A short mnemonic needs no multi-step reasoning, and with a
      // tight token budget an invisible thinking pass could easily crowd out the mnemonic itself
      // (the same failure mode this app hit when its text routes ran on Gemini, before migrating
      // to Groq).
      reasoning_effort: GROQ_REASONING_EFFORT,
    });
    const parsed = JSON.parse(completion.choices[0].message.content);
    target_word = typeof parsed.target_word === "string" ? parsed.target_word.trim() : "";
    translation = typeof parsed.translation === "string" ? parsed.translation.trim() : "";
    keyword = typeof parsed.keyword === "string" ? parsed.keyword.trim() : "";
    sentence = typeof parsed.sentence === "string" ? parsed.sentence.trim() : "";
    image_scene = typeof parsed.image_scene === "string" ? parsed.image_scene.trim() : "";
  } catch (err) {
    console.error("[dotbot/mnemonic] Groq request failed:", err);
    return NextResponse.json({ error: "generation_failed" }, { status: 502 });
  }
  if (!target_word || !translation || !keyword || !sentence || !image_scene) {
    return NextResponse.json({ error: "empty_response" }, { status: 502 });
  }

  await spendGenerationCredits(supabase, 3);
  return NextResponse.json({ target_word, translation, keyword, sentence, image_scene });
}
