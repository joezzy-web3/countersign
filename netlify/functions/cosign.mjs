// POST /api/cosign  { "alertKey": "0x…" }
// Asks a demo signer (watchtower-dao, else tiramisu-sentinel) to countersign a VERIFIED alert:
// one atomic batch that creates the cosign record and renews the alert's 7-day lease.

import { CONFIG } from "../../web/core/config.js";
import { loadSnapshot } from "../../web/core/rpc.js";
import { STATUS, judgeBoard } from "../../web/core/verdict.js";
import { apiHeaders, cosignBatch, walletClient } from "../../lib/writes.mjs";
import { RPC, badOrigin, ipLimited, json, safeError } from "../lib/shared.mjs";

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  if (badOrigin(req)) return json(403, { error: "cross-site request refused" });
  if (ipLimited(req, 6)) return json(429, { error: "Easy: 6 countersigns per 10 minutes per visitor." });

  let alertKey;
  try {
    alertKey = String((await req.json()).alertKey ?? "").toLowerCase();
  } catch {
    return json(400, { error: "Body must be JSON: { alertKey }" });
  }
  if (!/^0x[0-9a-f]{64}$/.test(alertKey)) return json(400, { error: "alertKey must be a 32-byte hex entity key" });

  // Build each demo signer separately, so one badly pasted key cannot crash the endpoint.
  const signers = [];
  const broken = [];
  for (const name of ["KEY_WATCHTOWER", "KEY_SENTINEL"]) {
    if (!process.env[name]) continue;
    try {
      signers.push(walletClient(process.env[name], RPC));
    } catch {
      broken.push(name);
    }
  }
  if (!signers.length) {
    return json(503, { error: broken.length ? `Demo signer key(s) malformed in Netlify settings: ${broken.join(", ")}` : "Demo signers not configured on this deployment." });
  }

  try {
    const board = judgeBoard(await loadSnapshot(RPC, CONFIG.root, { headers: apiHeaders() }), CONFIG.root);
    const alert = board.alerts.find((a) => a.key === alertKey);
    if (!alert) return json(404, { error: "No live Countersign alert with that key." });
    if (alert.verdict.status !== STATUS.VERIFIED) {
      return json(409, { error: `Refused: this alert is ${alert.verdict.status.toUpperCase()}. Signers only countersign verified alerts.` });
    }
    const signer = signers.find((s) => {
      const me = s.account.address.toLowerCase();
      return me !== alert.creator && !alert.cosigners.some((c) => c.address === me);
    });
    if (!signer) return json(409, { error: "Every demo signer has already countersigned this alert." });

    const r = await signer.executeBatch(cosignBatch({ alertKey }));
    return json(200, { txHash: r.txHash, cosignKey: r.createdEntities[0], signer: signer.account.address });
  } catch (err) {
    if (err.code === 429) return json(429, { error: "Arkiv's query budget for this server is used up. Try again shortly." });
    return json(502, { error: safeError(err) });
  }
};

export const config = { path: "/api/cosign" };
