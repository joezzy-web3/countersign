// Countersign trust engine.
//
// Pure, deterministic, dependency-free. Same input snapshot -> same verdicts -> same digest.
// The web app, the standalone verifier (web/verify.html) and the tests all run this logic,
// so anyone can check that a verdict follows from on-chain data alone.
//
// The one rule: trust comes from $creator (set by the chain from the transaction signature),
// never from an attribute or payload field, because anyone can write those.

export const STATUS = Object.freeze({
  VERIFIED: "verified",
  IMPOSTOR: "impostor",
  REVOKED: "revoked",
  UNVERIFIED: "unverified",
});

/** Independent seals needed before an alert counts as confirmed. */
export const QUORUM = 2;

const lc = (a) => (typeof a === "string" ? a.toLowerCase() : "");

/**
 * Builds the trust table from grants and revokes.
 *
 * A grant or revoke only counts if its $creator is the root. For each signer the most recent
 * root decision (by creation block) wins, so a root can revoke and later re-grant.
 *
 * @param {object} snapshot { head, grants[], revokes[] }
 * @param {string} root root address
 */
export function buildTrust(snapshot, root) {
  const rootLc = lc(root);
  const head = Number(snapshot.head);
  /** @type {Map<string, any>} signer address -> latest decision */
  const decisions = new Map();

  const consider = (record, kind) => {
    if (lc(record.creator) !== rootLc) return; // forged grant/revoke from a non-root wallet: ignored
    const signer = lc(record.attrs?.signer);
    if (!/^0x[0-9a-f]{40}$/.test(signer)) return;
    const prev = decisions.get(signer);
    const at = Number(record.createdAt ?? 0);
    // Tie on the same block: a revoke beats a grant (fail closed).
    if (!prev || at > prev.at || (at === prev.at && kind === "revoke")) {
      decisions.set(signer, { kind, at, record });
    }
  };
  for (const g of snapshot.grants ?? []) consider(g, "grant");
  for (const r of snapshot.revokes ?? []) consider(r, "revoke");

  /** @type {Map<string, any>} */
  const signers = new Map();
  /** label -> signer address, for every label the root ever granted (live, lapsed or revoked) */
  const labels = new Map();

  for (const g of snapshot.grants ?? []) {
    if (lc(g.creator) !== rootLc) continue;
    const label = String(g.attrs?.label ?? "").trim().toLowerCase();
    if (label) labels.set(label, lc(g.attrs?.signer));
  }

  for (const [signer, d] of decisions) {
    if (d.kind === "revoke") {
      // Keep the label the signer held before revocation, so the UI can say whose seal it was.
      const label = [...labels.entries()].find(([, a]) => a === signer)?.[0] ?? "";
      signers.set(signer, { state: "revoked", label, revokeKey: d.record.key, revokedAt: d.at });
      continue;
    }
    const live = Number(d.record.expiresAt) > head;
    signers.set(signer, {
      state: live ? "active" : "lapsed",
      label: String(d.record.attrs?.label ?? "").trim().toLowerCase(),
      grantKey: d.record.key,
      expiresAt: Number(d.record.expiresAt),
    });
  }
  return { root: rootLc, head, signers, labels };
}

/**
 * Judges one alert against the trust table.
 * @returns {{status: string, issuer: string, reason: string}}
 */
export function judgeAlert(alert, trust) {
  const creator = lc(alert.creator);
  const claims = String(alert.attrs?.claims ?? "").trim().toLowerCase();
  const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "?");

  if (creator === trust.root) {
    return { status: STATUS.VERIFIED, issuer: "root", reason: "Signed by the root seal." };
  }
  const s = trust.signers.get(creator);
  if (s?.state === "revoked") {
    return {
      status: STATUS.REVOKED,
      issuer: s.label || short(creator),
      reason: `Signer ${short(creator)} was revoked by the root at block ${s.revokedAt}. Its seals no longer count.`,
    };
  }
  if (s?.state === "active") {
    return {
      status: STATUS.VERIFIED,
      issuer: s.label,
      reason: `Signed by ${s.label} (${short(creator)}), granted by the root until block ${s.expiresAt}.`,
    };
  }
  // Impostor: claims a label the root granted to a *different* wallet.
  if (claims && trust.labels.has(claims) && trust.labels.get(claims) !== creator) {
    const real = trust.labels.get(claims);
    return {
      status: STATUS.IMPOSTOR,
      issuer: claims,
      reason: `Claims to be ${claims}, but was signed by ${short(creator)}. ${claims}'s seal is ${short(real)}.`,
    };
  }
  if (s?.state === "lapsed") {
    return {
      status: STATUS.UNVERIFIED,
      issuer: s.label || short(creator),
      reason: `Signer ${short(creator)}'s grant expired at block ${s.expiresAt} and was not renewed.`,
    };
  }
  return {
    status: STATUS.UNVERIFIED,
    issuer: short(creator),
    reason: `Signed by ${short(creator)}, which holds no seal from the root.`,
  };
}

/**
 * Judges the whole board. Cosigns only count when the cosigner holds an active seal and is not
 * the alert's own author; one count per cosigner.
 */
export function judgeBoard(snapshot, root) {
  const trust = buildTrust(snapshot, root);
  const cosignsByAlert = new Map();
  for (const c of snapshot.cosigns ?? []) {
    const target = lc(c.attrs?.alert);
    if (!target) continue;
    if (!cosignsByAlert.has(target)) cosignsByAlert.set(target, []);
    cosignsByAlert.get(target).push(c);
  }

  const alerts = (snapshot.alerts ?? []).map((a) => {
    const verdict = judgeAlert(a, trust);
    const seen = new Set();
    const cosigners = [];
    let ignored = 0;
    for (const c of cosignsByAlert.get(lc(a.key)) ?? []) {
      const who = lc(c.creator);
      const s = trust.signers.get(who);
      const counts =
        (s?.state === "active" || who === trust.root) && who !== lc(a.creator) && !seen.has(who);
      if (counts) {
        seen.add(who);
        cosigners.push({ address: who, label: who === trust.root ? "root" : s.label, key: c.key });
      } else {
        ignored += 1;
      }
    }
    // Quorum: the author's seal plus independent countersigns. One leaked signer key can post a
    // sealed alert, but it cannot reach a quorum of 2 on its own.
    const seals = verdict.status === STATUS.VERIFIED ? 1 + cosigners.length : 0;
    return { ...a, verdict, cosigners, ignoredCosigns: ignored, seals, confirmed: seals >= QUORUM };
  });

  alerts.sort(
    (x, y) =>
      Number(y.attrs?.issued_ms ?? 0) - Number(x.attrs?.issued_ms ?? 0) ||
      (x.key < y.key ? -1 : x.key > y.key ? 1 : 0),
  );

  const counts = { verified: 0, impostor: 0, revoked: 0, unverified: 0 };
  for (const a of alerts) counts[a.verdict.status] += 1;
  return { trust, alerts, counts, head: trust.head };
}

/** Canonical text of a board's verdicts: one line per alert, sorted by key. */
export function canonicalVerdicts(board) {
  return board.alerts
    .map((a) => `${lc(a.key)}:${a.verdict.status}:${a.cosigners.length}`)
    .sort()
    .join("\n");
}

/** SHA-256 hex of the canonical verdicts (Web Crypto: works in browsers and Node 20+). */
export async function boardDigest(board) {
  const bytes = new TextEncoder().encode(canonicalVerdicts(board));
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
