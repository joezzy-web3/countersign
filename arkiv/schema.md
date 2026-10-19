# Countersign data schema on Arkiv

Network: Tiramisu testnet, chain ID `7738577`. SDK: `@arkiv-network/sdk` 0.8.1 for writes, raw `arkiv_query` JSON-RPC for reads.

All entities share `app = "countersign"`. Every attribute name is lowercase on purpose: Tiramisu rejects A–Z in attribute names even though SDK 0.8.1 accepts them (see `friction.md`, F3).

## The trust rule

An alert is trusted only if its **`$creator`** is the root, or holds a live seal (`grant`) whose `$creator` is the root, and that seal has not been revoked by the root. `$creator` is set by the chain from the transaction signature. No attribute or payload field is ever used to decide trust. The `claims` attribute exists only so the app can catch someone *pretending*.

The root address is the one trust decision, hard-coded in `web/core/config.js`. The code that applies the rule is `web/core/verdict.js` (pure, deterministic, 24 tests).

## Entity types

| type | created by | attributes (queried) | payload (not queried) | flags | lifetime | why that lifetime |
|---|---|---|---|---|---|---|
| `grant` | root only | `app` str, `type` str, `signer` addr, `label` str, `role` str, `granted_ms` u64 | `{label, note}` | `readonly` | **30 days**, renewed by the root with `extendEntity` only while the signer is active | Trust should decay. An idle signer's seal lapses by itself, with no cleanup job. |
| `revoke` | root only | `app`, `type`, `signer` addr, `grant` key, `revoked_ms` u64 | `{reason}` | `readonly` | **60 days** | Must outlive any grant it cancels. A grant lives at most 30 days from its last renewal, so 60 leaves margin. |
| `alert` | anyone | `app`, `type`, `target` str, `kind` str, `severity` u64 (1–5), `claims` str, `issued_ms` u64 | `{title, summary, evidence[]}` | `readonly`, `permissionlessExtension` | **7 days**, renewed by every countersign | A scam warning matters for days, not forever. Unconfirmed alerts (including impostor spam) expire on their own; confirmed ones stay alive as long as signers keep confirming them. |
| `cosign` | any signer | `app`, `type`, `alert` key, `cosigned_ms` u64 | `{note}` | `readonly` | **7 days** | Lives exactly as long as the renewal it caused. |

### Why these flags

- **`readonly` on everything.** Arkiv's `$creator` proves who *created* an entity, not who last edited it. If alerts were mutable, a key holder could later rewrite a sealed alert. Readonly makes "signed by X" mean "these exact bytes were signed by X".
- **`permissionlessExtension` on alerts only.** A countersign comes from a *different* wallet than the alert's author. Permissionless extension lets that wallet renew the alert without being able to change it. Grants are not permissionless: only the root decides how long trust lasts.
- **Ownership transfer is not used, on purpose.** `$owner` can be transferred without the recipient's consent, so it says nothing about authorship. Countersign never reads `$owner` for trust.

## Atomic batches (`executeBatch`)

| batch | operations | why atomic |
|---|---|---|
| charter (`npm run seed`) | create 3 `grant`s | The trust table is never half-written. |
| countersign (`/api/cosign`, `seed`) | create `cosign` + extend `alert` by 7 days | There is never a renewal without a visible signature, or a signature that did not renew. |
| renewal (`npm run renew`) | extend every active signer's `grant` | All active seals renew together, from one decision at one block. |

## Queries the app runs

Reads use raw `arkiv_query` (`web/core/rpc.js`), pinned to one block (`atBlock`) and walked with the cursor at the node's maximum page size of 200. The strings are exactly what SDK 0.8.1's `render()` produces (tested in `test/verdict.test.mjs`).

**One query per board view.** The public RPC meters `arkiv_query` per connection, so the board reads every Countersign entity with a single query and splits it by `type` locally. The trust engine then honours only grants and revokes whose `$creator` is the root, so fetching everything costs nothing in safety. Live events are filtered to known wallets before any re-read, and an HTTP 429 becomes a clear "budget used up" message instead of a hang (tested).

```text
# the board view: everything, one query
app = str('countersign')

# seals: grants whose $creator is the root (used by scripts/revoke.mjs)
app = str('countersign') AND type = str('grant') AND $creator = addr(<root>)

# revocations: same, from the root only
app = str('countersign') AND type = str('revoke') AND $creator = addr(<root>)

# the feed: a numeric range on severity
app = str('countersign') AND type = str('alert') AND severity >= u64(1)

# "Verified only" tab: the node filters by $creator, not the browser
app = str('countersign') AND type = str('alert') AND severity >= u64(1) AND ($creator = addr(<root>) OR $creator = addr(<signer1>) OR ...)

# countersigns
app = str('countersign') AND type = str('cosign')

# on-chain rate limit inside /api/attack: the impostor's alerts in the last 10 minutes
app = str('countersign') AND type = str('alert') AND $creator = addr(<impostor>) AND issued_ms >= u64(<now - 600000>)
```

Select used: `key, owner, creator, createdAt, expiresAt, creationFlags, contentType, payload, attributes`.

### Reproduce a verdict yourself

```bash
curl -s https://rpc.tiramisu.db-chain.testnet.arkiv.network \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"arkiv_query","params":["app = str('"'"'countersign'"'"') AND type = str('"'"'alert'"'"')",{"select":{"key":true,"creator":true,"attributes":true},"limit":"0xc8"}]}'
```

Compare each alert's `creator` with the `signer` attributes of the root's grants. Or open `web/verify.html`, which does exactly that with zero dependencies.

## Quorum

An alert's seal count is its author's seal plus independent countersigns from other active seals. At **2 seals** it is *confirmed*. An `all-clear` alert can override a warning on the link check only when it is confirmed and newer than the last confirmed warning. So one leaked signer key, before the root revokes it, can post a sealed alert but cannot single-handedly clear a scam (`test/check.test.mjs`).

## Live updates

The board subscribes with the SDK's `watchEntityEvents` over a **WebSocket** transport, with no `fromBlock`, so the node pushes events instead of the browser polling. Every Arkiv app shares one event stream, so the board reacts only to `EntityCreated` from a wallet it knows (root, seals, demo wallets, any alert author already on the board) or to events on keys it already shows, with one debounced re-read. Expiry emits no event, so the board also re-reads every 2 minutes.

## What deliberately stays off Arkiv

- **Private keys.** The demo endpoints' testnet keys live only in Netlify environment variables.
- **Personal data.** None anywhere: the orgs are synthetic, every target is a `.example` domain, and evidence is text written for the demo.
- **Screenshots and files.** Evidence is short text in the payload. Large media does not belong in a warning that should load instantly.
- **UI state** (selected tab, replay position) stays in the browser.
- **The verdict itself.** It is never stored. It is recomputed from chain state by anyone who reads the board, so there is nothing to forge.
