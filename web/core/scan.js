// "Someone sent me this. Is it legit?" — scans a pasted message (tweet, DM, Discord announcement)
// against a judged board. Pure: no network, no DOM, same answer in the browser and in tests.
//
// It looks for three things:
//   links   every domain in the text, including defanged ones (hxxp, [.]); each is run through checkTarget
//   names   every signer label the root ever granted ("Tiramisu Sentinel", @tiramisu_sentinel, ...)
//   tactics phrases drainers lean on (urgency, seed phrases, "connect your wallet"). Patterns, not proof.
//
// The verdict comes from the chain (sealed alerts, revocations, impostor posts), never from the
// tactics alone. Tactics only raise a "nothing on the board" answer to "be careful".
import { STATUS } from "./verdict.js";
import { checkTarget, normalizeHost } from "./check.js";

const SEP = String.raw`(?:\[\.\]|\(\.\)|\{\.\}|\.)`;
const LABEL = String.raw`[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?`;
const DOMAIN_RE = new RegExp(
  String.raw`(?:h[tx]{2}ps?(?:\[:\]|:)\/\/)?(?:${LABEL}${SEP})+[a-z]{2,24}(?![a-z0-9-])(?:[:\/?#][^\s<>"'\])]*)?`,
  "gi",
);
const NOT_TLD = new Set(["js", "md", "png", "jpg", "jpeg", "gif", "svg", "pdf", "txt", "json", "html", "mp4", "zip", "exe"]);

export const TACTICS = [
  { kind: "urgency", re: /\b(urgent(?:ly)?|immediately|act now|last chance|right away|before (?:it'?s too late|monday|tuesday|wednesday|thursday|friday|saturday|sunday|midnight)|within \d+\s*(?:h|hrs?|hours?|mins?|minutes?))\b/gi },
  { kind: "secrets", re: /\b(seed phrase|recovery phrase|secret phrase|private key|(?:12|24)[ -]words?)\b/gi },
  { kind: "wallet action", re: /\b(connect (?:your |the (?:affected )?)?wallet|re-?verify|validate (?:your )?wallet|sync (?:your )?wallet|approve (?:the|this|a)\b|sign (?:the|this|a) (?:message|transaction|request))/gi },
  { kind: "bait", re: /\b(airdrop|claim(?: now| your)?|refunds?|compensation|giveaway|double your)\b/gi },
  { kind: "migration", re: /\b(migrat(?:e|ion)|swap your (?:old )?tokens)\b/gi },
];

const defang = (s) =>
  s.replace(/^h[tx]{2}p/i, (m) => m.replace(/x/gi, "t")).replace(/\[:\]/g, ":").replace(/\[\.\]|\(\.\)|\{\.\}/g, ".");

/** Escapes a label into a regex that also matches "Tiramisu Sentinel", "tiramisu_sentinel", "@TiramisuSentinel". */
function labelPattern(label) {
  const parts = label.split(/[-_.\s]+/).filter(Boolean).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(String.raw`@?\b${parts.join(String.raw`[\s_.-]*`)}\b`, "gi");
}

export function extractLinks(text) {
  const spans = [];
  for (const m of String(text).matchAll(DOMAIN_RE)) {
    const raw = m[0].replace(/[.,;:!?]+$/, "");
    const host = normalizeHost(defang(raw));
    const tld = host.split(".").pop();
    if (!host || !host.includes(".") || NOT_TLD.has(tld)) continue;
    spans.push({ start: m.index, end: m.index + raw.length, host, raw });
  }
  return spans;
}

/**
 * @returns {{
 *   level: "danger"|"caution"|"clear"|"empty",
 *   headline: string, detail: string,
 *   links: {host, check}[], names: {label, address, state, backed, echoes}[], tactics: {kind, text}[],
 *   spans: {start, end, type: "link"|"name"|"tactic", level?}[]
 * }}
 */
export function scanMessage(board, text) {
  text = String(text ?? "").slice(0, 4000);
  const spans = [];

  // Links
  const linkSpans = extractLinks(text);
  const hosts = [...new Set(linkSpans.map((s) => s.host))];
  const links = hosts.map((host) => ({ host, check: checkTarget(board, host) }));
  const levelOf = new Map(links.map((l) => [l.host, l.check.level]));
  for (const s of linkSpans) spans.push({ start: s.start, end: s.end, type: "link", level: levelOf.get(s.host), host: s.host });

  const hostMatches = (target) => {
    const t = String(target ?? "").toLowerCase();
    return t && hosts.some((h) => h === t || h.endsWith("." + t));
  };

  // Names the message speaks for
  const names = [];
  for (const [label, address] of board.trust.labels ?? []) {
    const re = labelPattern(label);
    let hit = false;
    for (const m of text.matchAll(re)) {
      hit = true;
      spans.push({ start: m.index, end: m.index + m[0].length, type: "name", label });
    }
    if (!hit) continue;
    const s = board.trust.signers.get(address);
    const mine = board.alerts.filter((a) => String(a.creator).toLowerCase() === address);
    names.push({
      label,
      address,
      state: s?.state ?? "unknown",
      revokedAt: s?.revokedAt,
      backed: mine.filter((a) => a.verdict.status === STATUS.VERIFIED && hostMatches(a.attrs?.target)),
      echoes: board.alerts.filter(
        (a) => a.verdict.status === STATUS.IMPOSTOR && a.attrs?.claims === label && hostMatches(a.attrs?.target),
      ),
    });
  }

  // Tactics
  for (const t of TACTICS) {
    for (const m of text.matchAll(t.re)) {
      spans.push({ start: m.index, end: m.index + m[0].length, type: "tactic", kind: t.kind });
    }
  }

  // Keep non-overlapping spans: links win, then names, then tactics.
  const rank = { link: 0, name: 1, tactic: 2 };
  spans.sort((a, b) => rank[a.type] - rank[b.type] || a.start - b.start);
  const kept = [];
  for (const s of spans) if (!kept.some((k) => s.start < k.end && k.start < s.end)) kept.push(s);
  kept.sort((a, b) => a.start - b.start);
  // Tactics count only where they are real words, not part of a link ("claim-tiramisu-drop.example").
  const tactics = kept.filter((s) => s.type === "tactic").map((s) => ({ kind: s.kind, text: text.slice(s.start, s.end) }));

  const out = { links, names, tactics, spans: kept };
  const kinds = [...new Set(tactics.map((t) => t.kind))];
  const tacticNote = kinds.length ? ` It also uses ${kinds.length} tactic${kinds.length > 1 ? "s" : ""} drainers lean on (${kinds.join(", ")}).` : "";

  if (!text.trim()) return { ...out, level: "empty", headline: "Paste a whole message.", detail: "" };

  // 1. The exact claim was already posted by an impostor wallet: impersonation.
  const echoed = names.find((n) => n.echoes.length);
  if (echoed) {
    const e = echoed.echoes[0];
    return {
      ...out,
      level: "danger",
      headline: `Impersonation. This speaks for ${echoed.label}, but ${echoed.label} never signed it.`,
      detail: `An impostor wallet (${e.creator.slice(0, 6)}…${e.creator.slice(-4)}) already posted "${e.payload?.title ?? e.attrs?.kind}" about ${e.attrs?.target} under ${echoed.label}'s name. The real ${echoed.label} signs with a different wallet.${tacticNote}`,
    };
  }

  // 2. A link in it carries a sealed warning.
  const flagged = links.filter((l) => l.check.level === "danger");
  if (flagged.length) {
    const lead = flagged[0];
    const genuine = names.find((n) => n.backed.some((a) => lead.check.matches.includes(a)));
    if (genuine) {
      return {
        ...out,
        level: "danger",
        headline: `Genuine warning. ${genuine.label} signed this on Arkiv. Stay away from ${lead.host}.`,
        detail: `The message matches a sealed alert by ${genuine.label} (${genuine.address.slice(0, 6)}…${genuine.address.slice(-4)}). ${lead.check.detail}`,
      };
    }
    return {
      ...out,
      level: "danger",
      headline: `Don't click. ${flagged.length > 1 ? `${flagged.length} links in this message are` : `${lead.host} is`} flagged by sealed signers.`,
      detail: `${lead.check.headline.replace(/^Don't open it\. /, "")} ${lead.check.detail}${tacticNote}`,
    };
  }

  // 3. It speaks for a signer whose key was revoked.
  const revoked = names.find((n) => n.state === "revoked");
  if (revoked) {
    return {
      ...out,
      level: links.length ? "danger" : "caution",
      headline: `${revoked.label}'s key was revoked. Don't act on anything signed with it.`,
      detail: `The root revoked ${revoked.label} at block ${revoked.revokedAt}. A leaked key is exactly how fake "official" notices get out.${tacticNote}`,
    };
  }

  // 4. It speaks for a live signer, but that signer has signed nothing about these links.
  const unbacked = names.find((n) => n.state === "active" && links.length && !n.backed.length);
  if (unbacked) {
    return {
      ...out,
      level: "caution",
      headline: `Unverified. It speaks for ${unbacked.label}, but ${unbacked.label} signed nothing about ${hosts.length > 1 ? "these links" : hosts[0]}.`,
      detail: `A real ${unbacked.label} notice would be on Arkiv, signed by ${unbacked.address.slice(0, 6)}…${unbacked.address.slice(-4)}. Check their sealed alerts on the board before you click.${tacticNote}`,
    };
  }

  // 5. Only rumours (impostor, revoked or unsealed posts) about its links.
  const rumoured = links.find((l) => l.check.level === "caution");
  if (rumoured) {
    return { ...out, level: "caution", headline: `Unsealed posts mention ${rumoured.host}.`, detail: `${rumoured.check.detail}${tacticNote}` };
  }

  // 6. Nothing on chain, but the shape of a drainer message.
  if (kinds.length >= 2 || tactics.some((t) => t.kind === "secrets")) {
    return {
      ...out,
      level: "caution",
      headline: "Nothing on the board, but it reads like a drainer.",
      detail: `No sealed signer has flagged ${hosts.length ? hosts.join(", ") : "anything in it"}.${tacticNote} Real teams never ask for a seed phrase.`,
    };
  }

  if (!links.length && !names.length) {
    return {
      ...out,
      level: "empty",
      headline: "No links or signer names found.",
      detail: "Paste the whole message, including the link it wants you to open.",
    };
  }
  return {
    ...out,
    level: "clear",
    headline: "Nothing flagged on the board.",
    detail: `No sealed warnings for ${hosts.join(", ") || "the names it mentions"}. That is not a guarantee. It means no sealed signer has flagged it.${tacticNote}`,
  };
}
