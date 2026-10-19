// Posts one fresh sealed alert from tiramisu-sentinel (1 of 2 seals), so the live demo always has
// something to countersign. Then the countersign button takes it to "Confirmed · 2 seals".
import { alertParams, walletClient } from "../lib/writes.mjs";
import { keyFor, loadEnv, rpcUrl } from "./env.mjs";
import { logTx } from "./log.mjs";

loadEnv();
const w = walletClient(keyFor("sentinel"), rpcUrl());
const stamp = new Date().toISOString().slice(11, 16).replace(":", "");
const r = await w.createEntity(
  alertParams({
    target: `wallet-health-check-${stamp}.example`,
    kind: "drainer",
    severity: 4,
    claims: "tiramisu-sentinel",
    title: "Fake 'wallet health check' extension drains approvals",
    summary: "A browser extension asks you to 'scan' your wallet, then requests an unlimited approval.",
    evidence: ["Extension published 1 day ago", "Approval spender is not a known contract"],
  }),
);
logTx("fresh: sentinel posts a new single-seal alert", "sentinel", r.txHash, [r.entityKey]);
console.log(`New sealed alert (1 of 2 seals): ${r.entityKey}\n  tx ${r.txHash}`);
process.exit(0);
