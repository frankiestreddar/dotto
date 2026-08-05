import Groq from "groq-sdk";

let client = null;

// Lazy singleton — returns null rather than throwing when unconfigured, so importing this module
// is always safe even before GROQ_API_KEY is set.
//
// defaultHeaders sets an explicit browser-like User-Agent on every request — api.groq.com sits
// behind Cloudflare, and Cloudflare's bot-protection WAF has a long-running, actively-discussed
// issue (community.groq.com "IP Address (-Range) Blocked by Cloudflare"/"403 access denied") where
// requests from cloud/datacenter IPs (exactly what a serverless Next.js deployment sends from) get
// hard-blocked at the edge with "Access denied. Please check your network settings." — never even
// reaching Groq's actual API. groq-sdk's own default User-Agent apparently doesn't clear whatever
// heuristic triggers this; several reports in that thread confirm setting an explicit one does.
// Not guaranteed to fully resolve it alone — some reports describe IP-range blocks that needed
// Groq support to manually whitelist (via the response's cf-ray header) even after this — but it's
// a real, evidenced first thing to try, not a guess.
export function getGroqClient() {
  if (!process.env.GROQ_API_KEY) return null;
  if (!client) {
    client = new Groq({
      apiKey: process.env.GROQ_API_KEY,
      defaultHeaders: { "User-Agent": "Mozilla/5.0 (compatible; DottoApp/1.0; +https://dotto.app)" },
    });
  }
  return client;
}

// llama-3.3-70b-versatile (the model originally requested for this migration) was deprecated by
// Groq on 2026-06-17 (https://console.groq.com/docs/deprecations). Of Groq's two recommended
// replacements, this uses qwen/qwen3.6-27b rather than openai/gpt-oss-120b — Qwen's family has a
// strong multilingual track record, which matters a lot more here than for a typical chat app:
// Dotto's dictionary/IPA/translation panels routinely need to reason correctly in Chinese,
// Japanese, Arabic, etc., not just English. gpt-oss-120b was also ruled out because Structured
// Outputs (response_format: {type:"json_schema", strict:true}) is currently unreliable on it — a
// known, Groq-acknowledged regression where the schema constraint gets silently ignored (see
// community.groq.com's "Structured Outputs ignored by openai/gpt-oss-120b" thread) — no such
// reports surfaced for Qwen.
//
// Every route still uses the older response_format: {type:"json_object"} mode rather than
// json_schema, regardless — it only guarantees syntactically valid JSON, not schema conformance,
// so the desired shape is spelled out in prose in the system prompts (lib/dotbot.js) exactly as
// it already was for Gemini, and every route's own parsing (buildPanels in orchestrate/route.js,
// the suggestions array in suggest/route.js) continues to defensively re-validate every field
// rather than trusting the model's output outright — the same "never trust structured output
// blindly" posture this codebase already had.
export const GROQ_TEXT_MODEL = "qwen/qwen3.6-27b";

// qwen/qwen3.6-27b is a hybrid thinking/non-thinking model — Groq exposes this as a
// reasoning_effort param, "default" for its thinking mode (multi-step reasoning for math/code/
// complex logic, spending part of max_tokens on an invisible reasoning pass before the visible
// answer) or "none" for its non-thinking mode (answers directly). Every Dotbot task is single-turn
// content generation (a dictionary lookup, a short suggestion list, a mnemonic story, a Q&A
// answer) with no multi-step reasoning to do, so this is always passed as "none" — Gemini's own
// mandatory-thinking models already burned this exact codebase once, back when its text routes
// ran on Gemini (a reasoning-heavy query spent 284 of a 300-token budget on invisible "thinking"
// and left ~12 tokens for the actual answer), and there's no reason to reintroduce that failure
// mode here when the model offers an explicit off switch.
export const GROQ_REASONING_EFFORT = "none";
