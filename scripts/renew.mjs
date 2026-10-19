// Activity-based lease renewal for seals.
//
// A seal (grant) lives 30 days. The root renews it only if the signer was active (issued an
// alert or countersigned one) in that window. Idle seals lapse on their own; no cleanup job,
// no stale trust. All renewals go out as one atomic batch.

import { CONFIG } from "../web/core/config.js";
import { loadSnapshot } from "../web/core/rpc.js";
import { buildTrust } from "../web/core/verdict.js";
import { LIFETIME, walletClient } from "../lib/writes.mjs";
import { keyFor, loadEnv, rpcUrl } from "./env.mjs";
import { logTx } from "./log.mjs";

loadEnv();
const url = rpcUrl();
const root = walletClient(keyFor("root"), url);
const snap = await loadSnapshot(url, CONFIG.root);
const trust = buildTrust(snap, CONFIG.root);
const since = Date.now() - 30 * 24 * 3600 * 1000;

const active = new Set(
  [...snap.alerts.filter((a) => a.attrs.issued_ms >= since), ...snap.cosigns.filter((c) => c.attrs.cosigned_ms >= since)].map(
    (e) => e.creator,
  ),
);

const renew = [];
for (const [signer, s] of trust.signers) {
  if (s.state !== "active") continue; // lapsed and revoked seals are never renewed here
  if (active.has(signer)) renew.push({ signer, label: s.label, grantKey: s.grantKey });
  else console.log(`idle, letting it lapse: ${s.label} ${signer}`);
}
if (!renew.length) {
  console.log("Nothing to renew.");
  process.exit(0);
}
const r = await root.executeBatch({
  extensions: renew.map((x) => ({ entityKey: x.grantKey, expires: LIFETIME.grant() })),
});
logTx(`renew: root renews ${renew.map((x) => x.label).join(", ")} (one batch)`, "root", r.txHash, r.extendedEntities);
console.log(`Renewed ${renew.map((x) => x.label).join(", ")} for 30 days. tx ${r.txHash}`);

process.exit(0); // done: close open RPC connections so the terminal returns
