// One command for the live demo recording:
//   npm run demo          (revoke fires 150 s after setup)
//   npm run demo -- 90    (revoke fires 90 s after setup)
//
// 1. tiramisu-sentinel posts a fresh alert (1 of 2 seals), so there is always something to countersign.
// 2. The root re-grants relay-guild a seal, and relay-guild posts a fresh "bridge paused" notice (VERIFIED).
// 3. After the countdown, the root revokes relay-guild, and that notice turns REVOKED live on every screen.
import { privateKeyToAccount } from "viem/accounts";
import { alertParams, grantParams, revokeParams, walletClient } from "../lib/writes.mjs";
import { keyFor, loadEnv, rpcUrl } from "./env.mjs";
import { logTx } from "./log.mjs";

loadEnv();
const url = rpcUrl();
const wait = Math.max(30, Number(process.argv[2] ?? 150));
const stamp = new Date().toISOString().slice(11, 16).replace(":", "");
const root = walletClient(keyFor("root"), url);
const sentinel = walletClient(keyFor("sentinel"), url);
const guild = walletClient(keyFor("compromised"), url);
const guildAddr = privateKeyToAccount(keyFor("compromised")).address.toLowerCase();

console.log("Setting up the demo (about 20 seconds)...");

const a = await sentinel.createEntity(alertParams({
  target: `wallet-health-check-${stamp}.example`,
  kind: "drainer",
  severity: 4,
  claims: "tiramisu-sentinel",
  title: "Fake 'wallet health check' extension drains approvals",
  summary: "A browser extension asks you to 'scan' your wallet, then requests an unlimited approval.",
  evidence: ["Extension published 1 day ago", "Approval spender is not a known contract"],
}));
logTx("demo: sentinel posts a new single-seal alert", "sentinel", a.txHash, [a.entityKey]);

const g = await root.createEntity(grantParams({ signer: guildAddr, label: "relay-guild", note: "Re-granted for the live revoke demo" }));
logTx("demo: root re-grants relay-guild", "root", g.txHash, [g.entityKey]);

const b = await guild.createEntity(alertParams({
  target: `relay-guild-bridge-${stamp}.example`,
  kind: "advisory",
  severity: 3,
  claims: "relay-guild",
  title: "Relay Guild: bridge deposits paused",
  summary: "Deposits paused for 2 hours while validators rotate keys.",
  evidence: [],
}));
logTx("demo: relay-guild posts a notice", "compromised", b.txHash, [b.entityKey]);

console.log(`
READY. Start recording now. On the site (click Live, then refresh if needed) you will find:

  A) "Fake 'wallet health check' extension drains approvals"   VERIFIED, 1 of 2 seals
     -> click its Countersign button. It becomes "Confirmed · 2 seals".

  B) "Relay Guild: bridge deposits paused"                      VERIFIED (green)
     -> in ${wait} seconds the root revokes relay-guild and this card turns REVOKED by itself.

Do not close this window.
`);

for (let left = wait; left > 0; left -= 15) {
  console.log(`  revoke in ${left}s`);
  await new Promise((r) => setTimeout(r, Math.min(15, left) * 1000));
}

// Revoke the grant made above (no extra query), retrying if the network blips.
let r;
for (let i = 1; ; i++) {
  try {
    r = await root.createEntity(revokeParams({ signer: guildAddr, grantKey: g.entityKey, reason: "Signing key reported compromised (demo scenario)." }));
    break;
  } catch (err) {
    if (i >= 5) throw err;
    console.log(`  network hiccup (${err.cause?.code ?? err.message}), retrying in 5s (${i}/5)`);
    await new Promise((res) => setTimeout(res, 5000));
  }
}
logTx("demo: root revokes relay-guild", "root", r.txHash, [r.entityKey]);
console.log(`\nREVOKED relay-guild (tx ${r.txHash}). Watch card B turn grey, then stop recording.`);
process.exit(0);
