import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getHfApiKey,
  HF_IMAGE_ENDPOINT,
  PIXEL_ART_LORA,
  buildPixelArtPrompt,
  pixelateToSprite,
} from "@/lib/huggingface";
import { peekGenerationCredits, spendGenerationCredits } from "@/lib/dotbot";

export async function POST(request: NextRequest) {
  const { image_scene } = await request.json();
  if (!image_scene || !image_scene.trim()) {
    return NextResponse.json({ error: "empty_text" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const hfApiKey = getHfApiKey();
  if (!hfApiKey) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  if (!(await peekGenerationCredits(supabase, user.id, 10))) {
    return NextResponse.json({ error: "no_credits" }, { status: 402 });
  }

  // image_scene is the mnemonic route's short literal action description (see
  // DOTBOT_MNEMONIC_SYSTEM_PROMPT in lib/dotbot.ts) — the pixel-art style wrapper is applied in
  // buildPixelArtPrompt, not here, so every caller of this route gets the same consistent look.
  const styledPrompt = buildPixelArtPrompt(image_scene);

  let b64: string | undefined, mimeType: string | undefined;
  try {
    // fal-ai's own request shape ({"prompt": ...}), not the generic HF "inputs" field — see
    // lib/huggingface.ts for why this specific provider/endpoint/LoRA. Response is JSON with a
    // hosted image URL (fal.media), not raw image bytes.
    const response = await fetch(HF_IMAGE_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${hfApiKey}`,
        "Content-Type": "application/json",
      },
      // 16:9 horizontal — matches the search-image-result panel, which displays the image at full
      // panel width with height following automatically (see .search-image-result-card img in
      // app/globals.css), rather than a square crop. loras is fast-sdxl's own field for merging a
      // LoRA onto the base SDXL checkpoint before generation — see PIXEL_ART_LORA in
      // lib/huggingface.ts for which one and why.
      body: JSON.stringify({
        prompt: styledPrompt,
        image_size: { width: 1024, height: 576 },
        loras: [PIXEL_ART_LORA],
      }),
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.error(
        "[dotbot/image] Hugging Face request failed:",
        response.status,
        errText.slice(0, 500),
      );
      return NextResponse.json({ error: "generation_failed" }, { status: 502 });
    }
    const data = await response.json();
    const image = data?.images?.[0];
    if (!image?.url) return NextResponse.json({ error: "empty_response" }, { status: 502 });

    // fal.media URLs aren't guaranteed to stay valid indefinitely, and this app's canvas cards
    // persist their content directly (autosaved to Supabase) rather than re-fetching a remote
    // URL each time they're viewed — so the actual bytes are fetched once here and embedded as a
    // permanent data: URL, matching what every caller of this route already expects.
    const imgResponse = await fetch(image.url);
    if (!imgResponse.ok) return NextResponse.json({ error: "generation_failed" }, { status: 502 });
    const arrayBuffer = await imgResponse.arrayBuffer();

    // Even with the pixel-art LoRA and prompt wording doing a lot of the work already (see
    // lib/huggingface.ts), pixelateToSprite forces the actual chunky sprite look as a
    // deterministic post-process: downscale to a small pixel grid, then back up with
    // nearest-neighbor, baked into real PNG bytes rather than relying on prompt wording or
    // display-time CSS.
    const pixelated = await pixelateToSprite(Buffer.from(arrayBuffer), {
      width: 1024,
      height: 576,
      pixelGridWidth: 256,
      pixelGridHeight: 144,
    });
    mimeType = "image/png";
    b64 = pixelated.toString("base64");
  } catch (err) {
    console.error("[dotbot/image] Hugging Face request failed:", err);
    return NextResponse.json({ error: "generation_failed" }, { status: 502 });
  }
  if (!b64) return NextResponse.json({ error: "empty_response" }, { status: 502 });

  await spendGenerationCredits(supabase, 10);
  return NextResponse.json({ imageDataUrl: `data:${mimeType};base64,${b64}` });
}
