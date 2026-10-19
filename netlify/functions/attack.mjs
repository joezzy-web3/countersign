// POST /api/attack
// Publishes a fresh impostor alert from the demo impostor wallet: it copies a real signer's name
// word for word. The board should stamp it IMPOSTOR within a block, for every viewer.

import { lit, queryAll } from "../../web/core/rpc.js";
import { alertParams, apiHeaders, walletClient } from "../../lib/writes.mjs";
import { RPC, badOrigin, ipLimited, json, safeError } from "../lib/shared.mjs";

const TEMPLATES = [
  {
    claims: "tiramisu-sentinel",
    target: "sentinel-verify-wallet.example",
    kind: "advisory",
    title: "Security notice: re-verify your wallet",
    summary: "Due to an incident, all wallets must be re-verified at the link above within 24 hours.",
  },
  {
    claims: "watchtower-dao",
    target: "watchtower-refund.example",
    kind: "advisory",
    title: "Refunds for scam victims are open",
    summary: "Connect the affected wallet at the link above to receive your refund.",
  },
  {
    claims: "tiramisu-sentinel",
    target: "claim-tiramisu-drop.example",
    kind: "all-clear",
    title: "All clear: the airdrop page is safe",
    summary: "Our earlier warning was a false positive. You can claim normally.",
  },
];

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  if (badOrigin(req)) return json(403, { error: "cross-site request refused" });
  if (ipLimited(req)) return json(429, { error: "Easy: 4 attacks per 10 minutes per visitor." });
  if (!process.env.KEY_IMPOSTOR) return json(503, { error: "Demo writer not configured on this deployment." });

  try {
    const impostor = walletClient(process.env.KEY_IMPOSTOR, RPC);
    const me = impostor.account.address.toLowerCase();
    const since = Date.now() - 10 * 60 * 1000;
    // Global, stateless rate limit enforced from chain data.
    const recent = await queryAll(
      RPC,
      `app = ${lit.str("countersign")} AND type = ${lit.str("alert")} AND $creator = ${lit.addr(me)} AND issued_ms >= ${lit.u64(since)}`,
      { headers: apiHeaders() },
    );
    if (recent.entities.length >= 6) {
      return json(429, { error: "The impostor already struck 6 times in the last 10 minutes. Watch those land first." });
    }
    const t = TEMPLATES[Math.floor(Math.random() * TEMPLATES.length)];
    const r = await impostor.createEntity(alertParams({ ...t, severity: 5, evidence: [`Signed: ${t.claims}`] }));
    return json(200, { entityKey: r.entityKey, txHash: r.txHash, impostor: impostor.account.address, claims: t.claims });
  } catch (err) {
    if (err.code === 429) return json(429, { error: "Arkiv's query budget for this server is used up. Try again shortly." });
    return json(502, { error: safeError(err) });
  }
};

export const config = { path: "/api/attack" };
