import assert from "node:assert/strict";
import { test } from "node:test";
import { extractLinks, scanMessage } from "../web/core/scan.js";
import { judgeBoard } from "../web/core/verdict.js";

const ROOT = "0x" + "a".repeat(40);
const SENT = "0x" + "b".repeat(40);
const WATCH = "0x" + "c".repeat(40);
const GUILD = "0x" + "d".repeat(40);
const IMP = "0x" + "e".repeat(40);
const key = (n) => "0x" + n.toString(16).padStart(64, "0");
const grant = (k, signer, label) => ({ key: key(k), creator: ROOT, createdAt: k, expiresAt: 9999, attrs: { signer, label } });
const alert = (k, creator, claims, target, title, kind = "drainer") => ({
  key: key(k), creator, createdAt: 20 + k, expiresAt: 9000,
  attrs: { claims, target, kind, issued_ms: k }, payload: { title },
});
const board = judgeBoard(
  {
    head: 100,
    grants: [grant(1, SENT, "tiramisu-sentinel"), grant(2, WATCH, "watchtower-dao"), grant(3, GUILD, "relay-guild")],
    revokes: [{ key: key(4), creator: ROOT, createdAt: 50, expiresAt: 9999, attrs: { signer: GUILD } }],
    alerts: [
      alert(10, SENT, "tiramisu-sentinel", "claim-tiramisu-drop.example", "Fake airdrop claim page drains wallets"),
      alert(12, IMP, "tiramisu-sentinel", "tiramisu-migrate.example", "URGENT: migrate your tokens now", "advisory"),
      alert(13, GUILD, "relay-guild", "relay-guild-bridge.example", "Bridge maintenance window", "advisory"),
    ],
    cosigns: [],
  },
  ROOT,
);

test("extracts plain, schemed and defanged links, and skips file names", () => {
  const hosts = extractLinks("go to https://www.Claim-Tiramisu-Drop.example/claim?x=1, or hxxps://evil[.]example/x. see notes.md").map((s) => s.host);
  assert.deepEqual(hosts, ["claim-tiramisu-drop.example", "evil.example"]);
});

test("impersonation: the message repeats a claim an impostor wallet already posted", () => {
  const r = scanMessage(board, "URGENT from Tiramisu Sentinel: migrate your tokens before Friday at tiramisu-migrate.example");
  assert.equal(r.level, "danger");
  assert.match(r.headline, /^Impersonation/);
  assert.ok(r.spans.some((s) => s.type === "name") && r.spans.some((s) => s.type === "link"));
});

test("a genuine warning is recognised as signed by the signer it names", () => {
  const r = scanMessage(board, "⚠️ @tiramisu_sentinel: do NOT sign anything on claim-tiramisu-drop.example, it is a drainer.");
  assert.equal(r.level, "danger");
  assert.match(r.headline, /^Genuine warning\. tiramisu-sentinel signed this/);
});

test("a flagged link without a named signer still says don't click", () => {
  const r = scanMessage(board, "free mint here: claim-tiramisu-drop.example");
  assert.equal(r.level, "danger");
  assert.match(r.headline, /^Don't click/);
});

test("speaking for a revoked signer is flagged", () => {
  const r = scanMessage(board, "Relay Guild here: bridge reopened, deposit at relay-guild-bridge2.example");
  assert.equal(r.level, "danger");
  assert.match(r.headline, /relay-guild's key was revoked/);
});

test("speaking for a live signer with an unbacked link is unverified", () => {
  const r = scanMessage(board, "Hi, Watchtower DAO here. Refunds are open, connect your wallet at watchtower-refund.example within 24 hours.");
  assert.equal(r.level, "caution");
  assert.match(r.headline, /^Unverified\. It speaks for watchtower-dao/);
  assert.match(r.detail, /tactics/);
});

test("drainer tactics alone raise caution, a plain message stays clear, empty asks for input", () => {
  assert.equal(scanMessage(board, "Send your seed phrase to support to unlock funds").level, "caution");
  assert.equal(scanMessage(board, "Docs are at docs.example, see you at the meetup").level, "clear");
  assert.equal(scanMessage(board, "  ").level, "empty");
  assert.equal(scanMessage(board, "gm frens").level, "empty");
});

test("spans never overlap", () => {
  const r = scanMessage(board, "Claim now at claim-tiramisu-drop.example — Tiramisu Sentinel airdrop, urgent!");
  for (let i = 1; i < r.spans.length; i++) assert.ok(r.spans[i].start >= r.spans[i - 1].end);
});

test("words inside a link are not counted as tactics", () => {
  const r = scanMessage(board, "⚠️ @tiramisu_sentinel: do NOT sign anything on claim-tiramisu-drop.example.");
  assert.equal(r.tactics.length, 0);
});
