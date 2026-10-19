// Shared guard rails for the two demo endpoints. Testnet keys only, set in Netlify env vars.
import { CONFIG } from "../../web/core/config.js";

export const RPC = process.env.ARKIV_RPC_URL || CONFIG.rpcHttp;

export function json(status, body) {
  return new Response(JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

// Per-instance, per-IP limit. Soft (instances do not share memory); the hard limit is on-chain:
// each endpoint counts its own recent writes with an Arkiv query before writing again.
const hits = new Map();
export function ipLimited(req, max = 4, windowMs = 10 * 60 * 1000) {
  const ip = req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for") || "?";
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= max) return true;
  list.push(now);
  hits.set(ip, list);
  return false;
}

/** Reject cross-site POSTs from browsers (not an auth system: these endpoints are public demos). */
export function badOrigin(req) {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host !== new URL(req.url).host;
  } catch {
    return true;
  }
}

export function safeError(err) {
  const msg = String(err?.shortMessage ?? err?.message ?? err).replace(/0x[0-9a-fA-F]{64}/g, "0x…");
  return msg.slice(0, 240);
}
