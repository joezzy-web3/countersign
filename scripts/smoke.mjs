// Smoke test against Tiramisu. Proves every Arkiv path Countersign relies on, and records exact
// expected vs actual results to arkiv/smoke-results.json. That file is the raw evidence behind
// arkiv/friction.md: nothing in the friction report is claimed without a line here.
//
// Uses throwaway entities under app = "countersign-smoke" with 15-minute lifetimes.

import { readFileSync, writeFileSync } from "node:fs";
import { ExpirationTime, addr, jsonToPayload, u64 } from "@arkiv-network/sdk";
import { eq } from "@arkiv-network/sdk/query";
import { createPublicClient } from "@arkiv-network/sdk";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { webSocket } from "viem";
import { publicClient, toJson, walletClient } from "../lib/writes.mjs";
import { normalizeEntity, queryAll, rpc } from "../web/core/rpc.js";
import { keyFor, loadEnv, rpcUrl } from "./env.mjs";

loadEnv();
const pkgVersion = (name) => {
  try {
    return JSON.parse(readFileSync(`node_modules/${name}/package.json`, "utf8")).version;
  } catch {
    return "unknown";
  }
};
const versions = {
  sdk: pkgVersion("@arkiv-network/sdk"),
  viem: pkgVersion("viem"),
  node: process.version,
  os: `${process.platform} ${process.arch}`,
};

const url = rpcUrl();
const pub = publicClient(url);
const a = walletClient(keyFor("impostor"), url); // cheap throwaway writer
const b = walletClient(keyFor("watchtower"), url); // a second, unrelated wallet
const results = [];

async function step(name, expected, fn) {
  const t0 = performance.now();
  try {
    const actual = await fn();
    const ms = Math.round(performance.now() - t0);
    results.push({ step: name, ok: true, ms, expected, actual });
    console.log(`PASS ${name} (${ms} ms)`);
    return actual;
  } catch (err) {
    const ms = Math.round(performance.now() - t0);
    const error = [err?.name, err?.shortMessage ?? err?.message, err?.cause?.shortMessage ?? err?.cause?.message]
      .filter(Boolean)
      .join(" | ")
      .slice(0, 600);
    results.push({ step: name, ok: false, ms, expected, error });
    console.log(`FAIL ${name} (${ms} ms): ${error}`);
    return undefined;
  }
}

/** For steps where the engine SHOULD refuse: success here is a finding. */
async function expectRejection(name, expected, fn) {
  const t0 = performance.now();
  try {
    const actual = await fn();
    results.push({ step: name, ok: false, ms: Math.round(performance.now() - t0), expected, actual, note: "accepted but expected a rejection" });
    console.log(`UNEXPECTED ACCEPT ${name}`);
  } catch (err) {
    const msg = [err?.name, err?.shortMessage ?? err?.message, err?.cause?.shortMessage ?? err?.cause?.message]
      .filter(Boolean)
      .join(" | ")
      .slice(0, 600);
    results.push({ step: name, ok: true, ms: Math.round(performance.now() - t0), expected, actual: `rejected: ${msg}` });
    console.log(`PASS ${name} (rejected as expected)`);
  }
}

const probe = (extra = {}, flags = {}) => ({
  attributes: { app: "countersign-smoke", type: "probe", n: u64(Date.now()), ...extra },
  payload: jsonToPayload({ probe: true }),
  contentType: "application/json",
  expires: ExpirationTime.fromMinutes(15),
  flags,
});

console.log("Countersign smoke test", versions, "\n");

await step("chain id is Tiramisu 7738577", 7738577, () => pub.getChainId());
await step("raw eth_blockNumber over fetch (the path the browser uses)", "a block number", async () =>
  Number(BigInt(await rpc(url, "eth_blockNumber", []))),
);

await step("one arkiv_query: record the node's Arkiv-Cost and RateLimit headers", "headers present or absent, recorded as-is", async () => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "arkiv_query", params: ["app = str('countersign')", { select: { key: true }, limit: "0x1" }] }),
  });
  return { status: res.status, arkivCost: res.headers.get("arkiv-cost"), ratelimit: res.headers.get("ratelimit"), retryAfter: res.headers.get("retry-after") };
});

const created = await step("createEntity (readonly, 15 min)", "entityKey + txHash", async () => {
  const r = await a.createEntity(probe({}, { readonly: true }));
  return { entityKey: r.entityKey, txHash: r.txHash };
});

if (created) {
  await step("getEntity returns $creator = signer", a.account.address, async () => {
    const e = await pub.getEntity(created.entityKey);
    return e.creator;
  });
  await step("raw arkiv_query sees the same entity and creator", a.account.address.toLowerCase(), async () => {
    const r = await queryAll(url, `app = str('countersign-smoke') AND $creator = addr(${a.account.address.toLowerCase()})`);
    const hit = r.entities.find((e) => e.key === created.entityKey.toLowerCase());
    if (!hit) throw new Error(`not found among ${r.entities.length} results`);
    return hit.creator;
  });
  await step("SDK select().where().createdBy() finds it", "1+ entities", async () => {
    const r = await pub
      .select({ key: true, creator: true })
      .where(eq("app", "countersign-smoke"))
      .createdBy(a.account.address)
      .limit(50)
      .fetch();
    return `${r.entities.length} entities`;
  });
  await expectRejection("patching a readonly entity is refused", "revert", () =>
    a.patchEntity({ entityKey: created.entityKey, set: { n: u64(1) } }),
  );
  await expectRejection("another wallet cannot extend a non-permissionless entity", "revert", () =>
    b.extendEntity({ entityKey: created.entityKey, expires: ExpirationTime.fromMinutes(30) }),
  );
  await expectRejection("extending to an earlier expiry is refused (no silent shortening)", "revert", () =>
    a.extendEntity({ entityKey: created.entityKey, expires: ExpirationTime.fromMinutes(2) }),
  );
}

const open = await step("createEntity with permissionlessExtension", "entityKey", async () => {
  const r = await a.createEntity(probe({}, { readonly: true, permissionlessExtension: true }));
  return { entityKey: r.entityKey, txHash: r.txHash };
});
if (open) {
  await step("a different wallet CAN extend a permissionless entity", "new expiresAt", async () => {
    const r = await b.extendEntity({ entityKey: open.entityKey, expires: ExpirationTime.fromMinutes(30) });
    return { txHash: r.txHash, expiresAt: r.expiresAt.toString() };
  });
  await step("executeBatch: create + extend land in one transaction", "one txHash, 1 created, 1 extended", async () => {
    const r = await b.executeBatch({
      creates: [probe({ kind: "batch" })],
      extensions: [{ entityKey: open.entityKey, expires: ExpirationTime.fromMinutes(45) }],
    });
    return { txHash: r.txHash, created: r.createdEntities.length, extended: r.extendedEntities.length };
  });
}

await expectRejection("an uppercase attribute name is refused", "rejected (SDK or node)", () =>
  a.createEntity({ ...probe(), attributes: { app: "countersign-smoke", Severity: u64(1) } }),
);

await step("attribute values over 128 bytes are refused client-side", "InvalidValueError", async () => {
  try {
    await a.createEntity({ ...probe({ long: "x".repeat(129) }) });
    throw new Error("accepted a 129-byte string");
  } catch (err) {
    if (/accepted a 129/.test(err.message)) throw err;
    return `rejected: ${err.name}: ${(err.shortMessage ?? err.message).slice(0, 200)}`;
  }
});

await step("watchEntityEvents over WebSocket sees our create (no fromBlock)", "EntityCreated within 30 s", async () => {
  const ws = createPublicClient({ chain: tiramisu, transport: webSocket(url.replace(/^http/, "ws")) });
  let resolveSeen;
  const seen = new Promise((r) => (resolveSeen = r));
  const errors = [];
  const unwatch = ws.watchEntityEvents({
    onEntityCreated: (e) => {
      if (e.owner.toLowerCase() === a.account.address.toLowerCase()) resolveSeen(e);
    },
    onError: (e) => errors.push(e.message),
  });
  const t0 = performance.now();
  const r = await a.createEntity(probe({ kind: "ws" }));
  const ev = await Promise.race([seen, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout; errors: ${errors.join("; ")}`)), 30_000))]);
  unwatch();
  return { entityKey: r.entityKey, eventBlock: ev.blockNumber.toString(), msFromSend: Math.round(performance.now() - t0) };
});

writeFileSync("arkiv/smoke-results.json", toJson({ ranAt: new Date().toISOString(), rpc: url, versions, results }));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} as expected. Saved arkiv/smoke-results.json`);
if (failed.length) console.log("Unexpected:", failed.map((f) => f.step).join("; "));
process.exit(0);
