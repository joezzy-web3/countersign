import assert from "node:assert/strict";
import { test } from "node:test";
import {
  STATUS,
  boardDigest,
  buildTrust,
  canonicalVerdicts,
  judgeBoard,
} from "../web/core/verdict.js";
import { Q, normalizeEntity, queryAll } from "../web/core/rpc.js";

const ROOT = "0x" + "a".repeat(40);
const SENT = "0x" + "b".repeat(40); // tiramisu-sentinel
const WATCH = "0x" + "c".repeat(40); // watchtower-dao
const COMP = "0x" + "d".repeat(40); // compromised signer
const IMP = "0x" + "e".repeat(40); // impostor
const key = (n) => "0x" + n.toString(16).padStart(64, "0");

const grant = (k, signer, label, { creator = ROOT, createdAt = 10, expiresAt = 10_000 } = {}) => ({
  key: key(k), creator, createdAt, expiresAt,
  attrs: { app: "countersign", type: "grant", signer, label },
});
const revoke = (k, signer, { creator = ROOT, createdAt = 50 } = {}) => ({
  key: key(k), creator, createdAt, expiresAt: 99_999,
  attrs: { app: "countersign", type: "revoke", signer },
});
const alert = (k, creator, claims, issued = k) => ({
  key: key(k), creator, createdAt: 20, expiresAt: 9_000,
  attrs: { app: "countersign", type: "alert", claims, severity: 4, issued_ms: issued },
});
const cosign = (k, creator, alertKey) => ({
  key: key(k), creator, createdAt: 30, expiresAt: 9_000,
  attrs: { app: "countersign", type: "cosign", alert: alertKey },
});

const base = () => ({
  head: 100,
  grants: [
    grant(1, SENT, "tiramisu-sentinel"),
    grant(2, WATCH, "watchtower-dao"),
    grant(3, COMP, "relay-guild"),
  ],
  revokes: [],
  alerts: [],
  cosigns: [],
});

const statusOf = (board, k) => board.alerts.find((a) => a.key === key(k)).verdict.status;

test("an alert signed by a granted signer is verified", () => {
  const s = base();
  s.alerts.push(alert(100, SENT, "tiramisu-sentinel"));
  assert.equal(statusOf(judgeBoard(s, ROOT), 100), STATUS.VERIFIED);
});

test("an alert signed by the root itself is verified", () => {
  const s = base();
  s.alerts.push(alert(100, ROOT, ""));
  assert.equal(statusOf(judgeBoard(s, ROOT), 100), STATUS.VERIFIED);
});

test("copying a trusted label from another wallet is flagged as impostor", () => {
  const s = base();
  s.alerts.push(alert(100, IMP, "tiramisu-sentinel"));
  const b = judgeBoard(s, ROOT);
  assert.equal(statusOf(b, 100), STATUS.IMPOSTOR);
  assert.match(b.alerts[0].verdict.reason, /Claims to be tiramisu-sentinel/);
});

test("label matching is case and whitespace insensitive, so 'Tiramisu-Sentinel ' is still caught", () => {
  const s = base();
  s.alerts.push(alert(100, IMP, " Tiramisu-Sentinel "));
  assert.equal(statusOf(judgeBoard(s, ROOT), 100), STATUS.IMPOSTOR);
});

test("an unknown wallet claiming nobody is unverified, not impostor", () => {
  const s = base();
  s.alerts.push(alert(100, IMP, "some-random-group"));
  assert.equal(statusOf(judgeBoard(s, ROOT), 100), STATUS.UNVERIFIED);
});

test("a grant written by a non-root wallet is ignored (forged grant)", () => {
  const s = base();
  s.grants.push(grant(9, IMP, "imp-team", { creator: IMP }));
  s.alerts.push(alert(100, IMP, "imp-team"));
  const b = judgeBoard(s, ROOT);
  assert.equal(statusOf(b, 100), STATUS.UNVERIFIED);
  assert.equal(b.trust.signers.has(IMP), false);
});

test("a forged grant cannot steal a real label: impostor stays impostor", () => {
  const s = base();
  s.grants.push(grant(9, IMP, "tiramisu-sentinel", { creator: IMP }));
  s.alerts.push(alert(100, IMP, "tiramisu-sentinel"));
  assert.equal(statusOf(judgeBoard(s, ROOT), 100), STATUS.IMPOSTOR);
});

test("a revoke written by a non-root wallet is ignored", () => {
  const s = base();
  s.revokes.push(revoke(9, SENT, { creator: IMP }));
  s.alerts.push(alert(100, SENT, "tiramisu-sentinel"));
  assert.equal(statusOf(judgeBoard(s, ROOT), 100), STATUS.VERIFIED);
});

test("revoking a signer greys out every alert it signed, past and future", () => {
  const s = base();
  s.alerts.push(alert(100, COMP, "relay-guild"), alert(101, COMP, "relay-guild"));
  s.revokes.push(revoke(9, COMP));
  const b = judgeBoard(s, ROOT);
  assert.equal(statusOf(b, 100), STATUS.REVOKED);
  assert.equal(statusOf(b, 101), STATUS.REVOKED);
});

test("a later re-grant restores a revoked signer; the latest root decision wins", () => {
  const s = base();
  s.revokes.push(revoke(9, COMP, { createdAt: 50 }));
  s.grants.push(grant(10, COMP, "relay-guild", { createdAt: 60 }));
  s.alerts.push(alert(100, COMP, "relay-guild"));
  assert.equal(statusOf(judgeBoard(s, ROOT), 100), STATUS.VERIFIED);
});

test("grant and revoke in the same block: revoke wins (fail closed)", () => {
  const s = base();
  s.grants = [grant(1, SENT, "tiramisu-sentinel", { createdAt: 50 })];
  s.revokes.push(revoke(9, SENT, { createdAt: 50 }));
  s.alerts.push(alert(100, SENT, "tiramisu-sentinel"));
  assert.equal(statusOf(judgeBoard(s, ROOT), 100), STATUS.REVOKED);
});

test("an expired grant no longer verifies (seal lapsed)", () => {
  const s = base();
  s.grants = [grant(1, SENT, "tiramisu-sentinel", { expiresAt: 90 })];
  s.alerts.push(alert(100, SENT, "tiramisu-sentinel"));
  const b = judgeBoard(s, ROOT);
  assert.equal(statusOf(b, 100), STATUS.UNVERIFIED);
  assert.match(b.alerts[0].verdict.reason, /expired/);
});

test("a lapsed signer claiming its own old label is unverified, not an impostor of itself", () => {
  const s = base();
  s.grants = [grant(1, SENT, "tiramisu-sentinel", { expiresAt: 90 }), grant(2, WATCH, "watchtower-dao")];
  s.alerts.push(alert(100, SENT, "tiramisu-sentinel"), alert(101, SENT, "watchtower-dao"));
  const b = judgeBoard(s, ROOT);
  assert.equal(statusOf(b, 100), STATUS.UNVERIFIED);
  assert.equal(statusOf(b, 101), STATUS.IMPOSTOR); // but claiming someone else's seal still is
});

test("cosigns count only from active seals, never self, once per cosigner", () => {
  const s = base();
  s.alerts.push(alert(100, SENT, "tiramisu-sentinel"));
  const a = key(100);
  s.cosigns.push(
    cosign(200, WATCH, a), // counts
    cosign(201, WATCH, a), // duplicate cosigner: ignored
    cosign(202, IMP, a), // impostor: ignored
    cosign(203, SENT, a), // self: ignored
    cosign(204, ROOT, a), // root: counts
  );
  s.revokes.push(revoke(9, COMP));
  s.cosigns.push(cosign(205, COMP, a)); // revoked: ignored
  const b = judgeBoard(s, ROOT);
  const row = b.alerts[0];
  assert.deepEqual(row.cosigners.map((c) => c.label).sort(), ["root", "watchtower-dao"]);
  assert.equal(row.ignoredCosigns, 4);
});

test("addresses compare case-insensitively (checksummed vs lowercase)", () => {
  const s = base();
  const mixed = "0x" + "B".repeat(40);
  s.alerts.push({ ...alert(100, mixed, "tiramisu-sentinel") });
  assert.equal(statusOf(judgeBoard(s, ROOT.toUpperCase().replace("0X", "0x")), 100), STATUS.VERIFIED);
});

test("verdict digest is deterministic and independent of input order", async () => {
  const s1 = base();
  s1.alerts.push(alert(100, SENT, "tiramisu-sentinel"), alert(101, IMP, "watchtower-dao"));
  const s2 = { ...base(), alerts: [...s1.alerts].reverse(), grants: [...s1.grants].reverse() };
  const d1 = await boardDigest(judgeBoard(s1, ROOT));
  const d2 = await boardDigest(judgeBoard(s2, ROOT));
  assert.equal(d1, d2);
  assert.match(d1, /^[0-9a-f]{64}$/);
  assert.equal(
    canonicalVerdicts(judgeBoard(s1, ROOT)),
    `${key(100)}:verified:0\n${key(101)}:impostor:0`,
  );
});

test("buildTrust ignores malformed signer addresses", () => {
  const s = base();
  s.grants.push(grant(9, "not-an-address", "bad"));
  const t = buildTrust(s, ROOT);
  assert.equal(t.signers.has("not-an-address"), false);
});

test("normalizeEntity decodes the arkiv_query wire format", () => {
  const payload = Buffer.from(JSON.stringify({ title: "hi" })).toString("hex");
  const e = normalizeEntity({
    key: "0xABC",
    creator: "0xAbCd000000000000000000000000000000000001",
    createdAt: "0x10",
    expiresAt: "0xffffffffffffffff",
    creationFlags: { raw: 3 },
    payload: "0x" + payload,
    attributes: [
      { name: "severity", type: "u64", value: "0x4" },
      { name: "claims", type: "str", value: "tiramisu-sentinel" },
      { name: "alert", type: "key", value: "0xFF" },
      { name: "n", type: "i32", value: -2 },
    ],
  });
  assert.equal(e.key, "0xabc");
  assert.equal(e.creator, "0xabcd000000000000000000000000000000000001");
  assert.equal(e.createdAt, 16);
  assert.equal(e.expiresAt, Infinity); // permanent fits no JS number: treated as never expiring
  assert.deepEqual(e.flags, { readonly: true, permissionlessExtension: true });
  assert.deepEqual(e.attrs, { severity: 4, claims: "tiramisu-sentinel", alert: "0xff", n: -2 });
  assert.deepEqual(e.payload, { title: "hi" });
});

test("a non-JSON payload is kept as null, never executed", () => {
  const e = normalizeEntity({ key: "0x1", payload: "0x" + Buffer.from("<script>").toString("hex") });
  assert.equal(e.payload, null);
});

test("queries are rendered exactly as the SDK renders them", () => {
  assert.equal(
    Q.grants(ROOT),
    `app = str('countersign') AND type = str('grant') AND $creator = addr(${ROOT})`,
  );
  assert.equal(
    Q.alertsBy([SENT, WATCH], 3),
    `app = str('countersign') AND type = str('alert') AND severity >= u64(3) AND ($creator = addr(${SENT}) OR $creator = addr(${WATCH}))`,
  );
  assert.equal(Q.cosignsFor("0xAB"), `app = str('countersign') AND type = str('cosign') AND alert = key(0xab)`);
});

test("queryAll walks cursor pages at one pinned block", async () => {
  const calls = [];
  const pages = [
    { data: [{ key: "0x1" }], blockNumber: "0x64", cursor: "c1" },
    { data: [{ key: "0x2" }], blockNumber: "0x64" },
  ];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body.params[1]);
    return { ok: true, json: async () => ({ jsonrpc: "2.0", id: body.id, result: pages.shift() }) };
  };
  try {
    const r = await queryAll("http://x", "q", { atBlock: 100 });
    assert.deepEqual(r.entities.map((e) => e.key), ["0x1", "0x2"]);
    assert.equal(calls[0].atBlock, "0x64");
    assert.equal(calls[0].limit, "0xc8");
    assert.equal(calls[1].cursor, "c1");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("an RPC error is surfaced, never shown as an empty board", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "bad query" } }),
  });
  try {
    await assert.rejects(() => queryAll("http://x", "q"), /bad query/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a board view costs exactly one arkiv_query, split by type locally", async () => {
  const { loadSnapshot } = await import("../web/core/rpc.js");
  const methods = [];
  const realFetch = globalThis.fetch;
  const ent = (k, type) => ({ key: "0x" + k, creator: "0x1", attributes: [{ name: "type", type: "str", value: type }] });
  globalThis.fetch = async (_u, init) => {
    const body = JSON.parse(init.body);
    methods.push(body.method);
    const result =
      body.method === "eth_blockNumber"
        ? "0x64"
        : { data: [ent(1, "grant"), ent(2, "alert"), ent(3, "cosign"), ent(4, "revoke"), ent(5, "alert")], blockNumber: "0x64" };
    return { ok: true, status: 200, headers: new Map(), json: async () => ({ jsonrpc: "2.0", id: body.id, result }) };
  };
  try {
    const s = await loadSnapshot("http://x", ROOT);
    assert.deepEqual(methods, ["eth_blockNumber", "arkiv_query"]);
    assert.deepEqual([s.grants.length, s.alerts.length, s.cosigns.length, s.revokes.length], [1, 2, 1, 1]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("an exhausted query budget (HTTP 429) is a clear, typed error, never an empty board", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false, status: 429, statusText: "Too Many Requests",
    headers: new Map([["retry-after", "2016"]]),
    text: async () => '{"error":"ANON_COST_LIMITED"}',
  });
  try {
    await assert.rejects(() => queryAll("http://x", "q"), (e) => e.code === 429 && /resets in about 34 min/.test(e.message));
  } finally {
    globalThis.fetch = realFetch;
  }
});
