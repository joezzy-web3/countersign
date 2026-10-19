// "Is this link safe?" — pure lookup over a judged board. Only sealed (verified) alerts decide,
// and an "all clear" only overrides a warning once it reaches a quorum of independent seals.
import { QUORUM } from "./verdict.js";

/** Reduces anything a user might paste to a bare lowercase host. */
export function normalizeHost(input) {
  let s = String(input ?? "").trim().toLowerCase();
  if (!s) return "";
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, ""); // scheme
  s = s.replace(/^[^@/]*@/, ""); // credentials
  s = s.split(/[/?#\\]/)[0]; // path, query, fragment
  s = s.replace(/:\d+$/, ""); // port
  s = s.replace(/^www\./, "").replace(/\.$/, "");
  return /^[a-z0-9.-]+$/.test(s) ? s : "";
}

/**
 * @returns {{host, level: "danger"|"caution"|"clear"|"invalid", headline, detail, matches}}
 */
export function checkTarget(board, input) {
  const host = normalizeHost(input);
  if (!host) {
    return { host, level: "invalid", headline: "That doesn't look like a link or domain.", detail: "", matches: [] };
  }
  const matches = board.alerts.filter((a) => {
    const t = String(a.attrs?.target ?? "").toLowerCase();
    return t && (t === host || host.endsWith("." + t));
  });
  const by = (s) => matches.filter((a) => a.verdict.status === s);
  const sealed = by("verified");
  const impostors = by("impostor");
  const revoked = by("revoked");
  const unsealed = by("unverified");

  const isClear = (a) => String(a.attrs?.kind ?? "") === "all-clear";
  const warnings = sealed.filter((a) => !isClear(a));
  const clears = sealed.filter(isClear);
  const newest = (list) => list.reduce((m, a) => (!m || Number(a.attrs?.issued_ms) > Number(m.attrs?.issued_ms) ? a : m), null);
  // A confirmed "all clear" wins only if no confirmed warning was issued after it.
  const lastConfirmedWarning = newest(warnings.filter((a) => a.confirmed));
  const candidate = newest(clears.filter((a) => a.confirmed));
  const confirmedClear =
    candidate && (!lastConfirmedWarning || Number(candidate.attrs?.issued_ms) > Number(lastConfirmedWarning.attrs?.issued_ms))
      ? candidate
      : null;

  if (warnings.length && !confirmedClear) {
    const lead = warnings.find((a) => a.confirmed) ?? warnings[0];
    const names = [...new Set(warnings.flatMap((a) => [a.verdict.issuer, ...a.cosigners.map((c) => c.label)]))];
    const notes = [];
    if (lead.confirmed) notes.push(`Confirmed by ${lead.seals} independent seals.`);
    else notes.push("One seal so far; a second independent seal would confirm it.");
    if (clears.length) notes.push(`A single-seal "all clear" exists but cannot override a warning without ${QUORUM} independent seals.`);
    if (impostors.length) notes.push(`${impostors.length} impostor post${impostors.length > 1 ? "s" : ""} about this domain ${impostors.length > 1 ? "were" : "was"} ignored.`);
    return {
      host,
      level: "danger",
      headline: `Don't open it. Sealed warning: ${lead.payload?.title ?? lead.attrs.kind}.`,
      detail: `Signed by ${names.join(", ")}. ${notes.join(" ")}`,
      matches,
    };
  }
  if (confirmedClear) {
    return {
      host,
      level: "clear",
      headline: `Cleared by ${confirmedClear.seals} independent seals.`,
      detail: `${confirmedClear.payload?.title ?? "All clear"}. Earlier warnings were withdrawn by a quorum of sealed signers, not by one key.`,
      matches,
    };
  }
  if (revoked.length || impostors.length || unsealed.length) {
    return {
      host,
      level: "caution",
      headline: "No sealed warning, but unsealed posts mention it.",
      detail:
        `${matches.length} post${matches.length > 1 ? "s" : ""} about this domain, none from a live seal` +
        (impostors.length ? `, including ${impostors.length} from an impostor` : "") +
        ". Treat them as rumours. Impostors post here too, sometimes to promote the scam.",
      matches,
    };
  }
  return {
    host,
    level: "clear",
    headline: "No warnings on the board for this domain.",
    detail: "That is not a guarantee it is safe. It means no sealed signer has flagged it.",
    matches,
  };
}
