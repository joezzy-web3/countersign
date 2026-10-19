// Every Countersign write, in one place. Used by the scripts and by the Netlify functions.
// Built on @arkiv-network/sdk 0.8.x.
//
// Entity types and lifetimes (see arkiv/schema.md for the reasoning):
//   grant   root -> signer seal              30 days, renewed by the root while the signer is active
//   revoke  root -> signer tombstone         60 days, outlives any grant it cancels
//   alert   anyone                           7 days, renewed by each countersign (permissionless)
//   cosign  signer's confirmation of alert   7 days, created atomically with the alert's renewal

import {
  ExpirationTime,
  addr,
  createPublicClient,
  createWalletClient,
  jsonToPayload,
  key,
  u64,
} from "@arkiv-network/sdk";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const APP = "countersign";

export const LIFETIME = {
  grant: () => ExpirationTime.fromDays(30),
  revoke: () => ExpirationTime.fromDays(60),
  alert: () => ExpirationTime.fromDays(7),
  cosign: () => ExpirationTime.fromDays(7),
};

/** Optional Arkiv access key (hub.arkiv.network) for server-side calls, sent as X-API-KEY. */
export const apiHeaders = () => (process.env.ARKIV_API_KEY ? { "X-API-KEY": process.env.ARKIV_API_KEY } : {});
const transport = (url) => http(url, { fetchOptions: { headers: apiHeaders() } });

export function publicClient(url) {
  return createPublicClient({ chain: tiramisu, transport: transport(url) });
}

export function walletClient(privateKey, url) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey ?? "")) {
    throw new Error("Missing or malformed private key (expected 0x + 64 hex). Check your .env.");
  }
  return createWalletClient({
    chain: tiramisu,
    transport: transport(url),
    account: privateKeyToAccount(privateKey),
  });
}

const now = () => u64(Date.now());

/** Root grants a seal to a signer. Readonly: a seal's terms can never be edited, only renewed. */
export function grantParams({ signer, label, note = "" }) {
  return {
    attributes: {
      app: APP,
      type: "grant",
      signer: addr(signer),
      label: label.toLowerCase(),
      role: "issuer",
      granted_ms: now(),
    },
    payload: jsonToPayload({ label: label.toLowerCase(), note }),
    contentType: "application/json",
    expires: LIFETIME.grant(),
    flags: { readonly: true },
  };
}

/** Root revokes a signer. Readonly tombstone with the reason in the payload. */
export function revokeParams({ signer, grantKey, reason }) {
  return {
    attributes: {
      app: APP,
      type: "revoke",
      signer: addr(signer),
      grant: key(grantKey),
      revoked_ms: now(),
    },
    payload: jsonToPayload({ reason }),
    contentType: "application/json",
    expires: LIFETIME.revoke(),
    flags: { readonly: true },
  };
}

/**
 * An alert. Readonly, so its content stays exactly what its creator signed; permissionless
 * extension, so any signer can keep a confirmed alert alive without being able to change it.
 */
export function alertParams({ target, kind, severity, claims, title, summary, evidence = [] }) {
  const sev = Math.max(1, Math.min(5, Math.trunc(Number(severity))));
  return {
    attributes: {
      app: APP,
      type: "alert",
      target: String(target).toLowerCase().slice(0, 120),
      kind: String(kind).toLowerCase().slice(0, 40),
      severity: u64(sev),
      claims: String(claims ?? "").toLowerCase().slice(0, 64),
      issued_ms: now(),
    },
    payload: jsonToPayload({ title, summary, evidence }),
    contentType: "application/json",
    expires: LIFETIME.alert(),
    flags: { readonly: true, permissionlessExtension: true },
  };
}

/**
 * A countersign: one atomic batch that creates the cosign record AND renews the alert's lease.
 * Either both land or neither does, so there is never a renewal without a visible signature, or a
 * signature that did not renew.
 */
export function cosignBatch({ alertKey, note = "" }) {
  return {
    creates: [
      {
        attributes: { app: APP, type: "cosign", alert: key(alertKey), cosigned_ms: now() },
        payload: jsonToPayload({ note }),
        contentType: "application/json",
        expires: LIFETIME.cosign(),
        flags: { readonly: true },
      },
    ],
    extensions: [{ entityKey: alertKey, expires: LIFETIME.alert() }],
  };
}

/** JSON.stringify that survives bigint. */
export const toJson = (v) =>
  JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2);
