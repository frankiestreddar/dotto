import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getGroqClient, GROQ_TEXT_MODEL, GROQ_REASONING_EFFORT } from "@/lib/groq";
import { DOTBOT_SYSTEM_PROMPT, peekSearchCredits, spendSearchCredits } from "@/lib/dotbot";

export async function POST(request: NextRequest) {
  const { question } = await request.json();
  if (!question || !question.trim()) {
    return NextResponse.json({ error: "empty_question" }, { status: 400 });
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

  let answer: string | undefined;
  try {
    const completion = await groq.chat.completions.create({
      model: GROQ_TEXT_MODEL,
      messages: [
        { role: "system", content: DOTBOT_SYSTEM_PROMPT },
        { role: "user", content: question },
      ],
      max_tokens: 500,
      temperature: 0.2, // deterministic linguistic Q&A, not creative writing
      reasoning_effort: GROQ_REASONING_EFFORT, // "none" — see lib/groq.ts
    });
    answer = completion.choices[0].message.content?.trim();
  } catch (err) {
    console.error("[dotbot/ask] Groq request failed:", err);
    return NextResponse.json({ error: "generation_failed" }, { status: 502 });
  }
  if (!answer) return NextResponse.json({ error: "empty_response" }, { status: 502 });

  // Only charged now that generation actually succeeded.
  await spendSearchCredits(supabase, 3);
  return NextResponse.json({ answer });
}
