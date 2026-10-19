// Seeds the demo scenario on Tiramisu. Safe to re-run: it skips grants that already exist.
// Every transaction is appended to arkiv/onchain-log.json (on-chain evidence for judges).
//
//   1. root grants three seals in ONE atomic batch (the charter)
//   2. two real signers and one soon-to-be-compromised signer each issue an alert
//   3. signers countersign each other's alerts (cosign + lease renewal in one batch)
//   4. the impostor posts a fake "official" alert claiming tiramisu-sentinel's name

import { CONFIG } from "../web/core/config.js";
import { Q, loadSnapshot, queryAll } from "../web/core/rpc.js";
import { judgeBoard } from "../web/core/verdict.js";
import { alertParams, cosignBatch, grantParams, walletClient } from "../lib/writes.mjs";
import { keyFor, loadEnv, rpcUrl } from "./env.mjs";
import { logTx } from "./log.mjs";

loadEnv();
const url = rpcUrl();
const w = Object.fromEntries(
  ["root", "sentinel", "watchtower", "compromised", "impostor"].map((n) => [n, walletClient(keyFor(n), url)]),
);
if (w.root.account.address.toLowerCase() !== CONFIG.root.toLowerCase()) {
  console.error("web/core/config.js root does not match KEY_ROOT. Run: npm run keys -- --sync");
  process.exit(1);
}

const SEALS = [
  { wallet: "sentinel", label: "tiramisu-sentinel", note: "Security research desk (synthetic demo org)" },
  { wallet: "watchtower", label: "watchtower-dao", note: "Community scam watch (synthetic demo org)" },
  { wallet: "compromised", label: "relay-guild", note: "Bridge operators' guild (synthetic demo org)" },
];

// 1. Charter: all grants in one batch, so the trust table is never half-written.
const existing = await queryAll(url, Q.grants(CONFIG.root));
const have = new Set(existing.entities.map((g) => g.attrs.signer));
const missing = SEALS.filter((s) => !have.has(w[s.wallet].account.address.toLowerCase()));
if (missing.length) {
  const r = await w.root.executeBatch({
    creates: missing.map((s) => grantParams({ signer: w[s.wallet].account.address, label: s.label, note: s.note })),
  });
  logTx("charter: root grants seals (one batch)", "root", r.txHash, r.createdEntities);
  console.log(`charter: granted ${missing.map((s) => s.label).join(", ")} in tx ${r.txHash}`);
} else {
  console.log("charter: all seals already granted, skipping");
}

// 2. Alerts. All targets are synthetic .example domains: no real sites, people or data.
const ALERTS = [
  {
    by: "sentinel",
    target: "claim-tiramisu-drop.example",
    kind: "drainer",
    severity: 5,
    claims: "tiramisu-sentinel",
    title: "Fake airdrop claim page drains wallets",
    summary: "The page asks for a 'claim' signature that is actually an unlimited token approval.",
    evidence: ["Approval spender is an unverified contract", "Domain registered 2 days ago"],
  },
  {
    by: "watchtower",
    target: "arkiv-hub-support.example",
    kind: "phishing",
    severity: 4,
    claims: "watchtower-dao",
    title: "Fake support desk asks for seed phrases",
    summary: "Impersonates faucet support in DMs and links to a form that collects recovery phrases.",
    evidence: ["Real support never asks for a seed phrase", "Form posts to a third-party endpoint"],
  },
  {
    by: "compromised",
    target: "relay-guild-bridge.example",
    kind: "advisory",
    severity: 3,
    claims: "relay-guild",
    title: "Bridge maintenance window",
    summary: "Deposits paused for 2 hours. (This signer's key is later revoked in the demo.)",
    evidence: [],
  },
  {
    by: "impostor",
    target: "tiramisu-migrate.example",
    kind: "advisory",
    severity: 5,
    claims: "tiramisu-sentinel",
    title: "URGENT: migrate your tokens now",
    summary: "Official notice: all holders must migrate before Friday at the link above.",
    evidence: ["Signed: Tiramisu Sentinel security team"],
  },
];

const before = await loadSnapshot(url, CONFIG.root);
const posted = {};
for (const a of ALERTS) {
  const signer = w[a.by].account.address.toLowerCase();
  const dup = before.alerts.find((x) => x.creator === signer && x.attrs.target === a.target);
  if (dup) {
    posted[a.by] = dup.key;
    console.log(`alert by ${a.by} on ${a.target} exists, skipping`);
    continue;
  }
  const r = await w[a.by].createEntity(alertParams(a));
  posted[a.by] = r.entityKey;
  logTx(`alert by ${a.by}: ${a.title}`, a.by, r.txHash, [r.entityKey]);
  console.log(`alert by ${a.by.padEnd(11)} ${r.entityKey}`);
}

// 3. Countersigns: each is a cosign record + alert renewal in one atomic batch.
const COSIGNS = [
  { by: "watchtower", alertOf: "sentinel" },
  { by: "sentinel", alertOf: "watchtower" },
  { by: "impostor", alertOf: "impostor" }, // self-cosign by impostor: the engine ignores it
];
const snap = await loadSnapshot(url, CONFIG.root);
for (const c of COSIGNS) {
  const alertKey = posted[c.alertOf];
  const me = w[c.by].account.address.toLowerCase();
  if (snap.cosigns.some((x) => x.creator === me && x.attrs.alert === alertKey)) {
    console.log(`cosign by ${c.by} on ${c.alertOf}'s alert exists, skipping`);
    continue;
  }
  const r = await w[c.by].executeBatch(cosignBatch({ alertKey }));
  logTx(`cosign by ${c.by} on ${c.alertOf}'s alert (cosign + renewal, one batch)`, c.by, r.txHash, r.createdEntities);
  console.log(`cosign by ${c.by.padEnd(11)} on ${c.alertOf}'s alert  tx ${r.txHash}`);
}

const board = judgeBoard(await loadSnapshot(url, CONFIG.root), CONFIG.root);
console.log("\nBoard:", board.counts);
for (const a of board.alerts) {
  console.log(`  ${a.verdict.status.padEnd(10)} ${a.attrs.target.padEnd(30)} cosigns ${a.cosigners.length}`);
}
console.log("\nNext: npm run replay  (records the opening scenario the site plays)");

process.exit(0); // done: close open RPC connections so the terminal returns
