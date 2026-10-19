// The trust path behind a verdict, as a short chain a person can read left to right.
// Idea credit: Mandate (1888-Labs), whose ALLOW/DENY answers show the delegation chain behind them.
import { STATUS } from "./verdict.js";

const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "?");
const lc = (a) => String(a ?? "").toLowerCase();

/** @returns {{label: string, sub: string, ok: boolean}[]} */
export function trustPath(alert, board) {
  const t = board.trust;
  const creator = lc(alert.creator);
  const claims = String(alert.attrs?.claims ?? "").trim().toLowerCase();
  const s = t.signers.get(creator);
  const root = { label: "root", sub: short(t.root), ok: true };
  const post = (ok) => ({ label: "alert", sub: short(alert.key), ok });

  switch (alert.verdict.status) {
    case STATUS.VERIFIED:
      if (creator === t.root) return [root, post(true)];
      return [
        root,
        { label: `seal · ${s.label}`, sub: `grant ${short(s.grantKey)}, until block ${s.expiresAt}`, ok: true },
        { label: "$creator", sub: short(creator), ok: true },
        post(true),
      ];
    case STATUS.REVOKED:
      return [
        root,
        { label: `seal · ${s.label}`, sub: `revoked at block ${s.revokedAt}`, ok: false },
        { label: "$creator", sub: short(creator), ok: false },
        post(false),
      ];
    case STATUS.IMPOSTOR: {
      const real = t.labels.get(claims);
      return [
        root,
        { label: `seal · ${claims}`, sub: `belongs to ${short(real)}`, ok: true },
        { label: "$creator", sub: `${short(creator)} ≠ ${short(real)}`, ok: false },
        post(false),
      ];
    }
    default:
      if (s?.state === "lapsed") {
        return [root, { label: `seal · ${s.label}`, sub: `expired at block ${s.expiresAt}`, ok: false }, { label: "$creator", sub: short(creator), ok: false }, post(false)];
      }
      return [{ label: "$creator", sub: short(creator), ok: false }, { label: "no seal", sub: "not granted by the root", ok: false }, post(false)];
  }
}
