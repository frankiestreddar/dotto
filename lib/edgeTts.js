import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

const DEFAULT_VOICE = "en-US-AriaNeural";

// The full voice list rarely changes and fetching it is a real network round-trip (a GET against
// Microsoft's public voices endpoint), so it's fetched once per server process and reused —
// concurrent callers before the first fetch resolves all await the same in-flight promise rather
// than each firing their own request.
let voicesPromise = null;
function getVoicesCached() {
  if (!voicesPromise) {
    const tts = new MsEdgeTTS();
    voicesPromise = tts.getVoices().catch((err) => {
      voicesPromise = null; // let the next call retry instead of caching a permanent failure
      throw err;
    });
  }
  return voicesPromise;
}

// `locale` is whatever BCP-47 code the AI put on the dictionary entry (e.g. "es-ES", "ja-JP").
// Edge TTS needs an exact voice ShortName, not a bare locale, so this resolves one: an exact
// locale match first, then just the language prefix (e.g. "es" matching "es-MX" if "es-ES" isn't
// available), then a hardcoded default so playback never hard-fails over a voice lookup miss.
async function pickVoiceForLocale(locale) {
  const voices = await getVoicesCached();
  if (!locale) return DEFAULT_VOICE;
  const exact = voices.find((v) => v.Locale.toLowerCase() === locale.toLowerCase());
  if (exact) return exact.ShortName;
  const lang = locale.split("-")[0].toLowerCase();
  const sameLanguage = voices.find((v) => v.Locale.toLowerCase().startsWith(lang + "-"));
  if (sameLanguage) return sameLanguage.ShortName;
  return DEFAULT_VOICE;
}

// Returns a Buffer of MP3 audio for `text`, spoken in a voice matching `locale`.
export async function synthesizeSpeech(text, locale) {
  const voiceName = await pickVoiceForLocale(locale);
  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(text);
    const chunks = [];
    for await (const chunk of audioStream) chunks.push(chunk);
    return Buffer.concat(chunks);
  } finally {
    tts.close();
  }
}
