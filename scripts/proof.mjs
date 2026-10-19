// Writes PROOF.md: every claim in the README, with the on-chain evidence a judge can click.
// Reads arkiv/onchain-log.json (written by the scripts) and the live board.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { CONFIG } from "../web/core/config.js";
import { loadSnapshot } from "../web/core/rpc.js";
import { boardDigest, judgeBoard } from "../web/core/verdict.js";
import { loadEnv, rpcUrl } from "./env.mjs";

loadEnv();
const X = CONFIG.explorer;
const tx = (h) => `[${h.slice(0, 10)}…](${X}/tx/${h})`;
const ent = (k) => `[${k.slice(0, 10)}…](${X}/entity/${k})`;
const addr = (a) => `[\`${a}\`](${X}/address/${a})`;

const log = existsSync("arkiv/onchain-log.json") ? JSON.parse(readFileSync("arkiv/onchain-log.json", "utf8")) : [];
const snap = await loadSnapshot(rpcUrl(), CONFIG.root);
const board = judgeBoard(snap, CONFIG.root);
const digest = await boardDigest(board);

const lines = [
  "# Proof",
  "",
  `Generated ${new Date().toISOString()} from Tiramisu (chain 7738577) at block ${snap.head}. Board digest \`${digest}\`: open \`verify.html\` at the same block and you get the same value.`,
  "",
  "## Wallets",
  "",
  ...Object.entries(CONFIG.wallets).map(([k, a]) => `- **${k}**: ${addr(a)}`),
  "",
  "## Every transaction the demo sent",
  "",
  "| when (UTC) | what | wallet | tx | entities |",
  "|---|---|---|---|---|",
  ...log.map((l) => `| ${l.at.slice(0, 16).replace("T", " ")} | ${l.what} | ${l.wallet} | ${tx(l.txHash)} | ${(l.entityKeys ?? []).map(ent).join(" ")} |`),
  "",
  "## Every alert on the board, and why it got its verdict",
  "",
  "| verdict | seals | alert | \`$creator\` | why |",
  "|---|---|---|---|---|",
  ...board.alerts.map(
    (a) => `| **${a.verdict.status}** | ${a.seals} | ${ent(a.key)} ${a.payload?.title ?? ""} | ${addr(a.creator)} | ${a.verdict.reason} |`,
  ),
  "",
  "## Seals granted by the root",
  "",
  ...[...board.trust.signers].map(([a, s]) => `- **${s.label}** ${addr(a)}: ${s.state}${s.grantKey ? `, grant ${ent(s.grantKey)}` : ""}${s.revokeKey ? `, revoke ${ent(s.revokeKey)}` : ""}`),
  "",
];
writeFileSync("PROOF.md", lines.join("\n"));
console.log(`PROOF.md written: ${log.length} transactions, ${board.alerts.length} alerts, digest ${digest.slice(0, 16)}`);

process.exit(0); // done: close open RPC connections so the terminal returns
