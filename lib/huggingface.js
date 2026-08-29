import sharp from "sharp";

// Server-only — used exclusively by app/api/dotbot/image/route.js for mnemonic image generation
// (every other Dotbot route runs on Groq text models — see lib/groq.js). Hugging Face's
// Inference API needs no client library — a plain authenticated fetch to its router (see the
// route) — so this module just centralizes the key/endpoint/prompt-building the same way
// lib/groq.js does for its own provider.
export function getHfApiKey() {
  return process.env.HUGGINGFACE_API_KEY || null;
}

// The literal https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell
// endpoint doesn't work: confirmed live that host no longer resolves at all (DNS failure — HF
// retired it in favor of "Inference Providers", where router.huggingface.co proxies each model
// to whichever third-party GPU host actually serves it). Also confirmed live that
// black-forest-labs/FLUX.1-schnell itself now returns 410 Gone ("deprecated and no longer
// supported") on HF's own hf-inference provider specifically.
//
// This app ran on fal-ai's FLUX.1-schnell for a while after that, but FLUX is a high-fidelity
// general model — even with strong pixel-art prompt wording (see STYLE_PREFIX below) and the
// deterministic pixelateToSprite post-process, its own output kept reading as a smooth painterly/
// vector-hybrid image with a pseudo-pixel filter over it, never genuine crisp pixel-sprite
// rendering (confirmed via live side-by-side comparison against target SNES/GBA-era references).
// This app ran on nerijs/pixel-art-xl (another SDXL pixel-art LoRA) before this, which produced
// crisp style but had weak prompt-following on anything more than a single-subject portrait (see
// STORYTELLING & IMAGE RULES in lib/dotbot.js for that whole saga — that constraint is about the
// model's composition ability generally and is independent of which specific pixel-art LoRA is
// loaded here, so it still applies). Switched to artificialguybr/PixelArtRedmond on request —
// confirmed live on HF's Inference Providers router via fal-ai/fast-sdxl (same provider/pipeline
// as before, see PIXEL_ART_LORA below), 82 likes, instance prompt "Pixel Art, PixArFK". Note: the
// exact id requested, "artificialguybr/PixelArtRedmond-SDXL", doesn't exist (401, same as any
// made-up repo) — the real id has no "-SDXL" suffix. The offered SD1.5 fallback,
// "artificialguybr/pixelartredmond-1-5v-pixel-art-loras-for-sd-1-5", does exist but has an empty
// inferenceProviderMapping (confirmed live) — i.e. it's not servable through any provider on HF's
// router at all, so the SDXL id is the only one of the two that actually works here.
export const HF_IMAGE_ENDPOINT = "https://router.huggingface.co/fal-ai/fal-ai/fast-sdxl";

// fal-ai/fast-sdxl's own loras input: an array of {path, scale}, merged onto the base SDXL
// checkpoint before generation. `path` must be a directly-resolvable URL to the weights file — a
// bare "owner/repo" HF model id (confirmed live) fails with 422 "Failed to download LoRA weight:
// URL has no scheme", so this points straight at the .safetensors file's own resolve URL instead
// (its real filename per the model repo's file listing is "PixelArtRedmond-Lite64.safetensors" —
// the "Lite64" build, not a plain "PixelArtRedmond.safetensors"). scale 1.0 matches the requested
// trigger weight.
export const PIXEL_ART_LORA = {
  path: "https://huggingface.co/artificialguybr/PixelArtRedmond/resolve/main/PixelArtRedmond-Lite64.safetensors",
  scale: 1.0,
};

// image_scene is the short literal action description from the mnemonic route's "image_scene"
// field (see DOTBOT_MNEMONIC_SYSTEM_PROMPT in lib/dotbot.js) — deliberately free of style words,
// since the strict pixel-art styling is applied here, once, so every image this app generates
// gets the same look regardless of call site. STYLE_PREFIX goes at the VERY FRONT of the string,
// before image_scene — earlier tokens get weighted more heavily, and appending style AFTER the
// scene (an earlier version of this prompt) let the scene's own wording dominate, which produced
// smooth painterly/3D-looking output instead of pixel art. Leads with "Pixel Art" — the current
// LoRA's (artificialguybr/PixelArtRedmond, see above) own documented instance_prompt is "Pixel
// Art, PixArFK"; PixArFK is a secondary/optional trigger word this intentionally omits (it's the
// LoRA author's own shorthand tag, not a real word — including it wouldn't be a "real word" per
// the mnemonic side of this pipeline's own rules, and "Pixel Art" alone is documented as
// sufficient to trigger the style). This is the STYLE axis only (crispness/outlines/shading/
// lighting) — it has no way to fix a scene that's the wrong CONTENT (e.g. ignoring what the
// mnemonic sentence actually describes happening), which is a separate, real failure mode handled
// entirely in image_scene itself via the LLM's own instructions (see STORYTELLING & IMAGE RULES in
// lib/dotbot.js, in particular the single-subject-portrait constraint) — no amount of style
// wording here can compensate for that. Explicit "NO vector art, NO anti-aliasing, NO smooth
// gradients" pushes back specifically against the smooth/blurry vector-art look pixel-art LoRAs can
// still drift toward without it. NEVER add words like "realistic", "detailed lighting",
// "cinematic", "shadows", or "photorealistic" to this string, or to anything concatenated onto it
// below — every one of those pulls the model back toward smooth painterly rendering, which is the
// exact failure mode this prompt exists to avoid.
const STYLE_PREFIX =
  "Pixel Art, 16-bit visual novel character sprite, sharp low-res pixel grid, bold black outlines, flat coloring, bright saturated colors, high contrast retro game art, NO vector art, NO anti-aliasing, NO smooth gradients";

// Even with strong wording and the pixel-art LoRA applied, SDXL doesn't reliably produce a
// genuine low-res pixel mosaic entirely on its own — pixelateToSprite below does the actual
// pixelation as a deterministic post-process rather than leaving it entirely up to the model.
export function buildPixelArtPrompt(imageScene) {
  return `${STYLE_PREFIX}, ${imageScene}`;
}

// Turns whatever the model actually generated into genuine pixel art: downscale to a small pixel
// grid (a quality filter here, so the "pixels" the mosaic ends up with are a sensible blend of the
// source detail, not a single sampled dot) then scale back up with nearest-neighbor — the same
// technique image-rendering:pixelated relies on in CSS, except baked into the actual bytes here
// so the chunky look survives being dragged into a table cell or downloaded, not just how it
// happens to render inline. This is what actually guarantees a convincing 16-bit sprite look
// regardless of how close the model's own raw output gets on its own.
// PNG, not JPEG — JPEG's compression softens the hard block edges a pixel-art mosaic depends on.
export async function pixelateToSprite(
  imageBuffer,
  { width, height, pixelGridWidth, pixelGridHeight },
) {
  const small = await sharp(imageBuffer)
    .resize(pixelGridWidth, pixelGridHeight, { kernel: "lanczos3" })
    .toBuffer();
  return sharp(small).resize(width, height, { kernel: "nearest" }).png().toBuffer();
}
