import assert from "node:assert/strict";
import { test } from "node:test";
import { checkTarget, normalizeHost } from "../web/core/check.js";
import { judgeBoard } from "../web/core/verdict.js";

const ROOT = "0x" + "a".repeat(40);
const SENT = "0x" + "b".repeat(40);
const IMP = "0x" + "e".repeat(40);
const key = (n) => "0x" + n.toString(16).padStart(64, "0");
const alert = (k, creator, claims, target, title) => ({
  key: key(k), creator, createdAt: 20, expiresAt: 9000,
  attrs: { claims, target, kind: "drainer", issued_ms: k }, payload: { title },
});
const board = judgeBoard(
  {
    head: 100,
    grants: [{ key: key(1), creator: ROOT, createdAt: 1, expiresAt: 999, attrs: { signer: SENT, label: "tiramisu-sentinel" } }],
    revokes: [],
    alerts: [
      alert(10, SENT, "tiramisu-sentinel", "claim-tiramisu-drop.example", "Fake airdrop"),
      alert(11, IMP, "tiramisu-sentinel", "claim-tiramisu-drop.example", "All clear"),
      alert(12, IMP, "tiramisu-sentinel", "tiramisu-migrate.example", "Migrate now"),
    ],
    cosigns: [],
  },
  ROOT,
);

test("normalizeHost strips scheme, credentials, www, port, path, query and case", () => {
  assert.equal(normalizeHost("HTTPS://user:pw@WWW.Claim-Tiramisu-Drop.example:8443/claim?x=1#y"), "claim-tiramisu-drop.example");
  assert.equal(normalizeHost("  claim-tiramisu-drop.example. "), "claim-tiramisu-drop.example");
  assert.equal(normalizeHost("<script>"), "");
  assert.equal(normalizeHost(""), "");
});

test("a sealed warning wins, and the impostor's 'all clear' is called out as ignored", () => {
  const r = checkTarget(board, "https://claim-tiramisu-drop.example/claim");
  assert.equal(r.level, "danger");
  assert.match(r.headline, /Fake airdrop/);
  assert.match(r.detail, /1 impostor post/);
});

test("subdomains of a flagged domain are flagged too", () => {
  assert.equal(checkTarget(board, "app.claim-tiramisu-drop.example").level, "danger");
});

test("only impostor posts: caution, never danger or clear", () => {
  const r = checkTarget(board, "tiramisu-migrate.example");
  assert.equal(r.level, "caution");
  assert.match(r.detail, /impostor/);
});

test("unknown domain: clear, with the honest caveat", () => {
  const r = checkTarget(board, "example.org");
  assert.equal(r.level, "clear");
  assert.match(r.detail, /not a guarantee/);
});

test("garbage input is rejected", () => {
  assert.equal(checkTarget(board, "%%%").level, "invalid");
});

test("quorum: one leaked signer key cannot clear a warning alone", () => {
  const WATCH = "0x" + "c".repeat(40);
  const snap = (clearCosigns) => ({
    head: 100,
    grants: [
      { key: key(1), creator: ROOT, createdAt: 1, expiresAt: 999, attrs: { signer: SENT, label: "tiramisu-sentinel" } },
      { key: key(2), creator: ROOT, createdAt: 1, expiresAt: 999, attrs: { signer: WATCH, label: "watchtower-dao" } },
    ],
    revokes: [],
    alerts: [
      alert(10, WATCH, "watchtower-dao", "drop.example", "Drainer"),
      { ...alert(11, SENT, "tiramisu-sentinel", "drop.example", "All clear"), attrs: { claims: "tiramisu-sentinel", target: "drop.example", kind: "all-clear", issued_ms: 11 } },
    ],
    cosigns: clearCosigns ? [{ key: key(50), creator: WATCH, createdAt: 30, expiresAt: 900, attrs: { alert: key(11) } }] : [],
  });
  const lone = checkTarget(judgeBoard(snap(false), ROOT), "drop.example");
  assert.equal(lone.level, "danger");
  assert.match(lone.detail, /cannot override a warning without 2 independent seals/);
  const quorum = checkTarget(judgeBoard(snap(true), ROOT), "drop.example");
  assert.equal(quorum.level, "clear");
  assert.match(quorum.headline, /Cleared by 2 independent seals/);
});

test("seals and confirmed are reported per alert", () => {
  const a = board.alerts.find((x) => x.attrs.target === "claim-tiramisu-drop.example" && x.verdict.status === "verified");
  assert.equal(a.seals, 1);
  assert.equal(a.confirmed, false);
  const imp = board.alerts.find((x) => x.verdict.status === "impostor");
  assert.equal(imp.seals, 0);
});

test("trust path: verified goes root → seal → $creator → alert; impostor breaks at $creator", async () => {
  const { trustPath } = await import("../web/core/path.js");
  const ver = board.alerts.find((a) => a.verdict.status === "verified");
  assert.deepEqual(trustPath(ver, board).map((n) => [n.label, n.ok]), [["root", true], ["seal · tiramisu-sentinel", true], ["$creator", true], ["alert", true]]);
  const imp = board.alerts.find((a) => a.verdict.status === "impostor");
  const p = trustPath(imp, board);
  assert.equal(p[2].ok, false);
  assert.match(p[2].sub, /≠/);
});
