// Minimal Arkiv reader over raw JSON-RPC (`arkiv_query`). No dependencies.
//
// This is deliberate: anyone can read and verify the board with nothing but this file, a browser
// and any Arkiv RPC URL. No Countersign backend is involved in reading.
//
// Wire format follows @arkiv-network/sdk 0.8.x (src/types/rpcSchema.ts, src/query/expression.ts).

export const APP = "countersign";

/** Query-language literals, written tagged exactly as the SDK's render() does. */
export const lit = {
  str: (v) => `str('${String(v).replaceAll("'", "''")}')`,
  addr: (v) => `addr(${String(v).toLowerCase()})`,
  key: (v) => `key(${String(v).toLowerCase()})`,
  u64: (v) => `u64(${BigInt(v).toString()})`,
};

/** The queries the app runs. Kept in one place so schema.md can quote them exactly. */
export const Q = {
  /** The one query a board view runs: every Countersign entity, all types, in one walk. */
  all: () => `app = ${lit.str(APP)}`,
  grants: (root) =>
    `app = ${lit.str(APP)} AND type = ${lit.str("grant")} AND $creator = ${lit.addr(root)}`,
  revokes: (root) =>
    `app = ${lit.str(APP)} AND type = ${lit.str("revoke")} AND $creator = ${lit.addr(root)}`,
  alerts: (minSeverity = 1) =>
    `app = ${lit.str(APP)} AND type = ${lit.str("alert")} AND severity >= ${lit.u64(minSeverity)}`,
  /** Server-side "verified only": alerts whose $creator is one of the given seals. */
  alertsBy: (creators, minSeverity = 1) =>
    `app = ${lit.str(APP)} AND type = ${lit.str("alert")} AND severity >= ${lit.u64(minSeverity)} AND (` +
    creators.map((c) => `$creator = ${lit.addr(c)}`).join(" OR ") +
    `)`,
  /** Link check: alerts about one exact host. */
  target: (host) => `app = ${lit.str(APP)} AND type = ${lit.str("alert")} AND target = ${lit.str(host)}`,
  cosigns: () => `app = ${lit.str(APP)} AND type = ${lit.str("cosign")}`,
  cosignsFor: (alertKey) =>
    `app = ${lit.str(APP)} AND type = ${lit.str("cosign")} AND alert = ${lit.key(alertKey)}`,
};

export const SELECT_ALL = {
  key: true,
  owner: true,
  creator: true,
  createdAt: true,
  expiresAt: true,
  creationFlags: true,
  contentType: true,
  payload: true,
  attributes: true,
};

let rpcId = 1;

/** Last cost/limit headers the node sent (public RPC meters arkiv_query per connection). */
export const meter = { cost: 0, queries: 0, ratelimit: "" };

export async function rpc(url, method, params, { signal, headers = {} } = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method, params }),
    signal,
  });
  const cost = Number(res.headers?.get?.("arkiv-cost") ?? 0);
  if (method === "arkiv_query") meter.queries += 1;
  if (cost) meter.cost += cost;
  meter.ratelimit = res.headers?.get?.("ratelimit") ?? meter.ratelimit;
  if (res.status === 429) {
    const wait = Number(res.headers?.get?.("retry-after") ?? 0);
    const e = new Error(
      `Arkiv's public RPC query budget for this connection is used up` +
        (wait ? `; it resets in about ${Math.ceil(wait / 60)} min` : "") +
        ". The recording and the standalone verifier still work.",
    );
    e.code = 429;
    e.retryAfter = wait;
    throw e;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`RPC HTTP ${res.status} ${res.statusText} for ${method}: ${text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160)}`);
  }
  const body = await res.json();
  if (body.error) {
    const e = new Error(`RPC ${method} error ${body.error.code}: ${body.error.message}`);
    e.code = body.error.code;
    e.data = body.error.data;
    throw e;
  }
  return body.result;
}

const hexToNumberSafe = (h) => {
  const b = BigInt(h);
  return b > BigInt(Number.MAX_SAFE_INTEGER) ? Infinity : Number(b);
};

function decodeAttr({ type, value }) {
  switch (type) {
    case "u64":
    case "u256":
      return typeof value === "string" ? hexToNumberSafe(value) : Number(value);
    case "i32":
      return Number(value);
    case "addr":
    case "key":
    case "bytes32":
      return String(value).toLowerCase();
    case "bool":
      return Boolean(value);
    default:
      return value; // str, dec (decimal string)
  }
}

function hexToBytes(hex) {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}

/** Turns one RPC entity into the plain record shape the trust engine reads. */
export function normalizeEntity(e) {
  const attrs = {};
  for (const a of e.attributes ?? []) attrs[a.name] = decodeAttr(a);
  let payload = null;
  if (e.payload && e.payload !== "0x") {
    try {
      payload = JSON.parse(new TextDecoder().decode(hexToBytes(e.payload)));
    } catch {
      payload = null; // not JSON: treated as no payload. Payloads are data, never instructions.
    }
  }
  const flagsRaw = typeof e.creationFlags === "number" ? e.creationFlags : e.creationFlags?.raw ?? 0;
  return {
    key: String(e.key ?? "").toLowerCase(),
    creator: String(e.creator ?? "").toLowerCase(),
    owner: String(e.owner ?? "").toLowerCase(),
    createdAt: e.createdAt ? hexToNumberSafe(e.createdAt) : 0,
    expiresAt: e.expiresAt ? hexToNumberSafe(e.expiresAt) : 0,
    flags: { readonly: Boolean(flagsRaw & 1), permissionlessExtension: Boolean(flagsRaw & 2) },
    contentType: e.contentType ?? "",
    attrs,
    payload,
  };
}

/**
 * Runs a query and walks every page with the cursor, all at one block so the pages agree.
 * Page size 200 is the node maximum (SDK MAX_LIMIT).
 */
export async function queryAll(url, query, { atBlock, maxPages = 25, select = SELECT_ALL, headers } = {}) {
  const out = [];
  let cursor;
  for (let page = 0; page < maxPages; page++) {
    const opts = { select, limit: "0xc8" };
    if (atBlock !== undefined) opts.atBlock = "0x" + BigInt(atBlock).toString(16);
    if (cursor) opts.cursor = cursor;
    const result = await rpc(url, "arkiv_query", [query, opts], { headers });
    for (const e of result.data ?? []) out.push(normalizeEntity(e));
    cursor = result.cursor;
    if (!cursor) return { entities: out, pages: page + 1, blockNumber: hexToNumberSafe(result.blockNumber) };
  }
  throw new Error(`Query still had more pages after ${maxPages}; refusing to show a partial board.`);
}

/**
 * Reads everything the board needs with ONE arkiv_query (pinned to one block, cursor-walked), then
 * splits it by type locally. The public RPC meters each query per connection, so one query per
 * view instead of four is the difference between a demo that survives judging and one that 429s.
 *
 * Trust is not decided here: grants and revokes are kept whoever wrote them, and the engine only
 * honours those whose $creator is the root.
 */
export async function loadSnapshot(url, root, { headers } = {}) {
  const head = hexToNumberSafe(await rpc(url, "eth_blockNumber", [], { headers }));
  const r = await queryAll(url, Q.all(), { atBlock: head, headers });
  const of = (t) => r.entities.filter((e) => e.attrs.type === t);
  return {
    head,
    grants: of("grant"),
    revokes: of("revoke"),
    alerts: of("alert"),
    cosigns: of("cosign"),
    queries: { "board (one query, split by type locally)": Q.all() },
  };
}
