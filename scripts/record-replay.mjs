// Records the current on-chain board into web/replay.json.
// The site opens on this recording and plays it entity by entity (by creation block), so a judge
// sees the whole story in 30 seconds even before anything new happens on-chain.
// It is real Tiramisu data: every key and address in it can be checked on the explorer.

import { writeFileSync } from "node:fs";
import { CONFIG } from "../web/core/config.js";
import { loadSnapshot } from "../web/core/rpc.js";
import { boardDigest, judgeBoard } from "../web/core/verdict.js";
import { loadEnv, rpcUrl } from "./env.mjs";

loadEnv();
const url = rpcUrl();
const snap = await loadSnapshot(url, CONFIG.root);
const board = judgeBoard(snap, CONFIG.root);
const digest = await boardDigest(board);

const toPlain = (v) => JSON.parse(JSON.stringify(v, (_k, x) => (x === Infinity ? "Infinity" : x)));
writeFileSync(
  "web/replay.json",
  JSON.stringify(
    {
      recordedAt: new Date().toISOString(),
      rpc: url,
      root: CONFIG.root,
      head: snap.head,
      digest,
      snapshot: toPlain({ ...snap, queries: undefined }),
    },
    null,
    1,
  ) + "\n",
);
console.log(`Recorded block ${snap.head}: ${snap.grants.length} grants, ${snap.revokes.length} revokes, ${snap.alerts.length} alerts, ${snap.cosigns.length} cosigns`);
console.log("Verdicts:", board.counts, "digest", digest.slice(0, 16));

process.exit(0); // done: close open RPC connections so the terminal returns
