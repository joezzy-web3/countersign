// The standalone verifier must run the exact engine the board runs.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { boardDigest, judgeBoard } from "../web/core/verdict.js";

const ROOT = "0x" + "a".repeat(40);
const key = (n) => "0x" + n.toString(16).padStart(64, "0");
const snapshot = {
  head: 100,
  grants: [
    { key: key(1), creator: ROOT, createdAt: 10, expiresAt: 999, attrs: { signer: "0x" + "b".repeat(40), label: "tiramisu-sentinel" } },
  ],
  revokes: [],
  alerts: [
    { key: key(2), creator: "0x" + "b".repeat(40), createdAt: 20, expiresAt: 900, attrs: { claims: "tiramisu-sentinel", issued_ms: 2 } },
    { key: key(3), creator: "0x" + "e".repeat(40), createdAt: 21, expiresAt: 900, attrs: { claims: "tiramisu-sentinel", issued_ms: 3 } },
  ],
  cosigns: [],
};

test("verify.html is rebuilt from the current engine and is fully self-contained", () => {
  execFileSync(process.execPath, ["scripts/build-verifier.mjs"]);
  const html = readFileSync("web/verify.html", "utf8");
  assert.doesNotMatch(html, /<script[^>]+src=/, "no external scripts");
  assert.doesNotMatch(html, /<link[^>]+href=/, "no external stylesheets or fonts");
  assert.doesNotMatch(html, /^\s*import\s/m, "no imports left in the inlined code");
});

test("the verifier's inlined engine reaches the same verdicts and digest as the board", async () => {
  const html = readFileSync("web/verify.html", "utf8");
  const code = html.split('<script type="module">')[1].split("// ---- verifier UI ----")[0];
  const mod = await import(
    "data:text/javascript," + encodeURIComponent(code + "\nexport { judgeBoard as jb, boardDigest as bd };")
  );
  const mine = await boardDigest(judgeBoard(snapshot, ROOT));
  const theirs = await mod.bd(mod.jb(snapshot, ROOT));
  assert.equal(theirs, mine);
  assert.deepEqual(
    mod.jb(snapshot, ROOT).alerts.map((a) => a.verdict.status),
    ["impostor", "verified"],
  );
});
