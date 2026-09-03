// ---------- Slash command tokenizer ----------
// Parses whatever's currently in the search box as a (possibly still-being-typed) slash command —
// used both to drive the live suggestions panel (app/dotto/lib/commandPalette.ts) and, on Enter, to
// resolve and execute a complete one (app/dotto/lib/commandTargetLookup.ts/commandVerbs.ts). Returns
// null for anything that isn't shaped like a command at all, so callers can fall back to normal
// search.
//
// Grammar: /(source|canvas) <target> [verb [arg]] — verb is parsed from the END of the string
// first (a known closed set below), so a target string that happens to contain a verb-like
// substring still parses correctly in the common case (a canvas literally titled "set public" is
// an accepted, known edge case — see the feature plan's own trade-offs section, not worth
// over-engineering against).

export const KINDS = ["source", "canvas"];
const VERB_RE = /\s+(set\s+(public|private)|invite\s+(\S+)|remove\s+(\S+)|place|copy)\s*$/i;

export type ParsedCommand =
  | { stage: "kind"; kindPrefix: string }
  | {
      stage: "target";
      kind: string;
      targetRaw: string;
      verb: "obtain" | "set" | "invite" | "remove" | "place" | "copy";
      arg: string | null;
    };

// stage 'kind'   — still choosing source vs canvas; kindPrefix is whatever's typed so far (e.g.
//                  "" right after a bare "/", or "s" while typing "source").
// stage 'target' — kind is chosen; targetRaw/verb/arg describe the rest. verb defaults to
//                  'obtain' with arg null until a recognized trailing verb appears — so
//                  "/source my notes" and "/source my notes set public" both parse, just with
//                  different verb/arg, and a still-incomplete verb (e.g. "/source my notes se")
//                  is simply treated as more of the target text until it fully matches.
export function parseCommandInput(value: string): ParsedCommand | null {
  if (!value.startsWith("/")) return null;
  const afterSlash = value.slice(1);
  const bareWordMatch = /^(\w*)$/.exec(afterSlash);
  if (bareWordMatch && !KINDS.includes(bareWordMatch[1].toLowerCase())) {
    return { stage: "kind", kindPrefix: bareWordMatch[1].toLowerCase() };
  }
  const m = /^(\w+)(\s+(.*))?$/.exec(afterSlash);
  if (!m || !KINDS.includes(m[1].toLowerCase())) return null;
  const kind = m[1].toLowerCase();
  const rest = m[3] || "";
  const vm = VERB_RE.exec(rest);
  if (!vm) return { stage: "target", kind, targetRaw: rest.trim(), verb: "obtain", arg: null };
  const targetRaw = rest.slice(0, vm.index).trim();
  if (vm[2]) return { stage: "target", kind, targetRaw, verb: "set", arg: vm[2].toLowerCase() };
  if (vm[3]) return { stage: "target", kind, targetRaw, verb: "invite", arg: vm[3] };
  if (vm[4]) return { stage: "target", kind, targetRaw, verb: "remove", arg: vm[4] };
  return { stage: "target", kind, targetRaw, verb: vm[1].toLowerCase() as "place" | "copy", arg: null };
}
