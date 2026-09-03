import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { synthesizeSpeech } from "@/lib/edgeTts";

const MAX_TEXT_LEN = 300; // a dictionary headword or a single example sentence — never longer prose

// Not credit-gated — unlike the Groq/Gemini-backed routes, Edge TTS (Microsoft Edge's Read Aloud
// service, used unofficially without an API key) costs nothing per request, same reasoning as
// why /api/dotbot/suggest is free.
export async function POST(request: NextRequest) {
  const { text, language } = await request.json();
  if (!text || !text.trim()) {
    return Response.json({ error: "empty_text" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthenticated" }, { status: 401 });

  try {
    const audioBuffer = await synthesizeSpeech(text.trim().slice(0, MAX_TEXT_LEN), language);
    return new Response(new Uint8Array(audioBuffer), {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=3600" },
    });
  } catch (err) {
    console.error("[dotbot/tts] Edge TTS request failed:", err);
    return Response.json({ error: "generation_failed" }, { status: 502 });
  }
}
