# Friction report: building Countersign on Arkiv

Every item names the surface, the version, steps to reproduce, expected vs actual, and a suggested fix. Items marked **source** were verified by reading the released code. Items marked **live** were measured on Tiramisu by `npm run smoke`, whose raw output is committed in `arkiv/smoke-results.json`. Paths that worked are documented with the same rigour as the ones that did not.

Versions: `@arkiv-network/sdk` **0.8.1** (git tag `v0.8.1`, commit `ace83ed`), viem 2.x, Node 22, Tiramisu chain `7738577`.

## Issues

### F1. SDK README still shows 0.6 in its install output (source)
- **Surface:** `arkiv-sdk-js/README.md` at tag `v0.8.1`, lines 86–90.
- **Steps:** follow the README's "Project Setup", then compare with the snippet it says `npm install` produces.
- **Expected:** the snippet matches the current major (`^0.8.x`).
- **Actual:** it shows `"@arkiv-network/sdk": "^0.6.0"`. 0.8.0 rewrote attributes, expiry and events (see CHANGELOG), so a reader who pins what the README shows gets an API where none of the 0.8 examples compile.
- **Fix:** update the snippet, or drop the version numbers from it.

### F2. SDK README publishes a shared private key "for quick testing" (source)
- **Surface:** `arkiv-sdk-js/README.md` at `v0.8.1`, line 286 onward.
- **Steps:** read "Wallet Client Example".
- **Expected:** guidance to generate a key locally (`generatePrivateKey()` from viem) and fund it from the hub faucet.
- **Actual:** a literal private key is printed for everyone to paste into code. Anything written with it has a `$creator` anyone can sign as, which teaches exactly the trust mistake this hackathon's Security pillar is about. Arkiv's own agent skills say never to handle private keys in chat or code.
- **Fix:** remove the key and show `generatePrivateKey()` plus the faucet link.

### F3. Uppercase attribute names pass the SDK, then the node rejects them with a self-contradicting message (source + live)
- **Surface:** SDK 0.8.1 `src/attr/names.ts` (`NAME_RE = /^[A-Za-z][A-Za-z0-9._-]*$/`) and the Tiramisu engine's revert message.
- **Steps (live, 2026-10-19, SDK 0.8.1, viem 2.57.7, Node 22.23.3):** `createEntity({ attributes: { app: "countersign-smoke", Severity: u64(1) }, ... })`. Step "an uppercase attribute name is refused" in the table below.
- **Expected:** one rule in both places, and an error before anything is sent: `InvalidAttributeNameError` from the SDK.
- **Actual:** the SDK accepts the name and builds the transaction. The node then refuses it with: *an attribute name holds "S" (0x53) at byte 0, which is outside the name charset ("A"-"Z", "a"-"z", "0"-"9", ".", "-" and "_", with a letter first)*. The message lists `A`–`Z` as allowed while rejecting `S`. A builder who reads it carefully will conclude their name is valid and look for the bug elsewhere.
- **Fix:** make the node's message say lowercase only (`"a"-"z"`), and make `NAME_RE` lowercase-only so the SDK rejects it client-side, like it already does for 129-byte strings (`InvalidValueError`, step "attribute values over 128 bytes"). We lowercased every attribute name in our schema.

### F4. `brotli-wasm` is a hard dependency but nothing in 0.8.1 calls it (source)
- **Surface:** `package.json` `dependencies` at `v0.8.1`; `src/utils/compression.ts`.
- **Steps:** `grep -rn "compression" src --include=*.ts` returns only `compression.ts` and its test.
- **Expected:** a dependency that ships to every app, including browsers, is used.
- **Actual:** `compress()` is never imported by the write path in 0.8.1. Payloads go on chain uncompressed (we confirmed by decoding raw `arkiv_query` payload hex as plain JSON). Every install still pulls a WASM package.
- **Fix:** remove it, or move it to an optional peer dependency until compression returns.

### F5. `watchEntityEvents` cannot be scoped to one app (source + live)
- **Surface:** `src/actions/public/watchEntityEvents.ts`: the filter is the Arkiv operation address only.
- **Steps:** watch events on Tiramisu during the hackathon with any filter you like.
- **Expected:** a way to subscribe to "entities where `app = 'countersign'`", or to a set of creators.
- **Actual:** every app receives every app's events. `EntityCreated` carries only `entityKey`, `owner` and `expiresAt`, so we cannot tell whether a new entity is ours without fetching it. We re-read the board on every foreign create, debounced to at most one read per ~2.5 s.
- **Fix:** an optional attribute or creator filter on the subscription, or attributes in `EntityCreated`.

### F6. No server-side ordering, so a sorted feed needs every page (source)
- **Surface:** CHANGELOG 0.8.0: "`orderBy` … removed. Sort the fetched entities in JavaScript."
- **Steps:** build a "newest first" feed of alerts.
- **Expected:** fetch the first page, newest first.
- **Actual:** the newest alerts can be on any page, so the board walks every page (cursor, 200 per page, pinned to one block) and sorts locally. That is fine at demo scale, but it grows linearly.
- **Fix:** ordering by one numeric attribute, even ascending only, so a `u64` timestamp can drive a feed.

### F7. A query's cost is visible only in a response header, and nothing says what it is counted against (live)
- **Surface:** public Tiramisu RPC, `arkiv_query`; SDK 0.8.1 `select().fetch()`.
- **Steps (live):** one raw `arkiv_query` with `limit: 1` and `select: { key: true }`. Step "one arkiv_query: record the node's Arkiv-Cost and RateLimit headers".
- **Observed:** HTTP 200 with `Arkiv-Cost: 100` and `RateLimit: limit=600, remaining=589, reset=4`. So the smallest possible query is charged 100 units, while `RateLimit` describes a 600-request window, which is a different budget. Nothing in the response, the SDK README or the SDK source says what the 100 units are drawn from, how large that allowance is, or what happens when it runs out. The SDK does not expose either header on its `QueryResult`.
- **Expected:** the cost model documented next to `select()`, and the headers surfaced on `QueryResult`, so an app can budget its reads.
- **What we changed because of it:** every board view is one `arkiv_query` (everything with `app = 'countersign'`, split by type locally), live events are filtered to known wallets before any re-read, the expiry sweep runs every 2 minutes, and an HTTP 429 becomes a clear message instead of an empty board (both tested in `test/verdict.test.mjs`).
- **Fix:** document the per-query cost and the allowance it counts against; expose `Arkiv-Cost` and `RateLimit` on `QueryResult`; add an `apiKey` option to the client factories.

### F8. Error messages for refused writes are excellent (live, works as documented)
Three refusals we provoked on purpose, each with a message that names the entity, the rule and the numbers:
- patching a readonly entity: *was created readonly, so its contents can never change. Its expiry can still be extended, and it can be transferred or deleted*;
- another wallet extending a non-permissionless entity: *is owned by 0xd5Da…Ac97, not 0x001f…a698*;
- extending to an earlier block: *already expires at block 792013, so extending it to 791627 would shorten its life*.
These are the messages every SDK should aim for. They made our tests of the readonly and permissionless-extension rules trivial to read.

### F9. Write latency we measured (live, for planning UIs)
`createEntity` took 9.7–11.1 s to return (it waits for the receipt), `extendEntity` 5.2 s, a create + extend `executeBatch` 4.8 s, and a `watchEntityEvents` subscriber over WebSocket saw our `EntityCreated` 7.2 s after we sent the transaction. Reads were 0.5–0.6 s. The board therefore shows "signing…" states on its buttons, and the demo endpoints return as soon as the receipt arrives.

### F10. Expiry is silent (source, works as documented)
- **Surface:** `sample/events_example.ts` says it plainly: reaching the expiry block is not an operation, so no event fires.
- **Effect on us:** a board with only push updates would show expired alerts forever. We added a 60-second re-read, which is the documented pattern. We list this as a tested path, not a bug.
- **Nice to have:** an `arkiv_` method or query helper for "expiring between blocks A and B" that is cheap to poll.

### F11. Lifetimes are in blocks, and the 2-second conversion is approximate (source, works as documented)
- **Surface:** `src/entity/expiry.ts`.
- **What we checked:** `ExpirationTime.fromDays(7)` becomes `302400` blocks at the nominal 2 s block time. The SDK says this is approximate and returns the resolved target block. Our UI shows "days left" from blocks remaining × 2 s, and the exact block on hover, so the approximation stays visible.

## Paths that worked

These are the steps from `scripts/smoke.mjs`, run against Tiramisu. The table below is generated from `arkiv/smoke-results.json` by `npm run friction`.

<!-- SMOKE:START -->
Run 2026-10-19T18:02:09.755Z against `https://rpc.tiramisu.db-chain.testnet.arkiv.network`. SDK 0.8.1, viem 2.57.7, Node v22.23.3, linux x64.

| step | as expected | ms | expected | actual |
|---|---|---|---|---|
| chain id is Tiramisu 7738577 | yes | 4041 | 7738577 | 7738577 |
| raw eth_blockNumber over fetch (the path the browser uses) | yes | 980 | a block number | 791558 |
| one arkiv_query: record the node's Arkiv-Cost and RateLimit headers | yes | 1515 | headers present or absent, recorded as-is | {"status":200,"arkivCost":"100","ratelimit":"limit=600, remaining=589, reset=4","retryAfter":null} |
| createEntity (readonly, 15 min) | yes | 11077 | entityKey + txHash | {"entityKey":"0xe854e0ea503b1d215309d952a964e0362ffd6b9e6ba7fcd2e7700ca46da59572","txHash":"0x0daa2e189381f9e2d5a883d68f28985badb980f25240043a6b6cb8cf7386d7cd"} |
| getEntity returns $creator = signer | yes | 590 | 0xd5DaE49f8f9f78FB0465afC4B4207c67dba3Ac97 | 0xd5DaE49f8f9f78FB0465afC4B4207c67dba3Ac97 |
| raw arkiv_query sees the same entity and creator | yes | 534 | 0xd5dae49f8f9f78fb0465afc4b4207c67dba3ac97 | 0xd5dae49f8f9f78fb0465afc4b4207c67dba3ac97 |
| SDK select().where().createdBy() finds it | yes | 615 | 1+ entities | 1 entities |
| patching a readonly entity is refused | yes | 1077 | revert | rejected: EntityMutationError \| Transaction failed: entity 0xe854e0ea…a59572 was created readonly, so its contents can never change. Its expiry can still be extended, and it can be transferred or deleted \| The contract |
| another wallet cannot extend a non-permissionless entity | yes | 1796 | revert | rejected: EntityMutationError \| Transaction failed: entity 0xe854e0ea…a59572 is owned by 0xd5DaE49f8f9f78FB0465afC4B4207c67dba3Ac97, not 0x001f7b52B26e563B0c3A4d909fFf7D8c6b6aa698 \| The contract function "execute" reve |
| extending to an earlier expiry is refused (no silent shortening) | yes | 1530 | revert | rejected: EntityMutationError \| Transaction failed: entity 0xe854e0ea…a59572 already expires at block 792013, so extending it to 791627 would shorten its life \| The contract function "execute" reverted. |
| createEntity with permissionlessExtension | yes | 9727 | entityKey | {"entityKey":"0xd0a4a182ea66ae86fca6fd45716198e8e597f788e19bbc7a327b081d87c031d2","txHash":"0x31bdab1e67a1be8661c3e4eb36cddf3d64e57021a89e2563aa3f883bbee3933f"} |
| a different wallet CAN extend a permissionless entity | yes | 5209 | new expiresAt | {"txHash":"0xf4cc253ecce2c2ff2b60746d49836f18a4176650a520235238505568dadde6e6","expiresAt":"792475"} |
| executeBatch: create + extend land in one transaction | yes | 4788 | one txHash, 1 created, 1 extended | {"txHash":"0x592dbc1c9ba89fb907bff0e0821c857ee38cc8ffba2eab1caea282078e33e7fa","created":1,"extended":1} |
| an uppercase attribute name is refused | yes | 1399 | rejected (SDK or node) | rejected: EntityMutationError \| Transaction failed: an attribute name holds "S" (0x53) at byte 0, which is outside the name charset ("A"-"Z", "a"-"z", "0"-"9", ".", "-" and "_", with a letter first) \| The contract func |
| attribute values over 128 bytes are refused client-side | yes | 1 | InvalidValueError | rejected: InvalidValueError: Invalid str value "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx...": 129 UTF-8 bytes exceeds the 128-byte limit on a str. Store the long form in the entity payload and keep a |
| watchEntityEvents over WebSocket sees our create (no fromBlock) | yes | 7230 | EntityCreated within 30 s | {"entityKey":"0x9985f8a96712f69b1d9e45b81e028e40c2d135ad87fc1de8e70df067a4b874ca","eventBlock":"791580","msFromSend":7228} |
<!-- SMOKE:END -->

## What we would ask for first

1. Scoped event subscriptions (F5) plus a documented query cost (F7). Together they decide how often any live Arkiv UI can afford to refresh.
2. Node and SDK agreeing on attribute names, with a message that does not list `A`–`Z` as allowed (F3). It is the first error most builders will hit.
3. Remove the shared key from the README (F2). On a network where `$creator` is the trust primitive, a shared key undermines it.
