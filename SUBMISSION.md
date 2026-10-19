# Devfolio form answers (in the form's order)

Replace every `<…>` before pasting. Never paste a private key into any field.

**Project name:** Countersign

**Tagline:** Scam alerts on Arkiv, judged by $creator. No seal, no trust.

**Tracks:** Security, Censorship Resistance

**The problem it solves**
Security warnings travel on trusted accounts, and accounts get taken over. In January 2024 Mandiant's X account was hijacked to push a crypto drainer, and two days later CertiK's account posted a fake "Uniswap Router exploit" alert whose "revoke" link was the drainer. Wallet drainers took about $494M in 2024 (Scam Sniffer). Countersign is a scam-alert board on Arkiv where every alert is judged by its `$creator` and traced to one root seal. Copy a trusted name from another wallet and you are stamped IMPOSTOR for every reader. A hijacked signer key can post a sealed alert, but needs a second independent seal (quorum 2) to confirm anything or clear a warning, and one revoke greys out everything it signed, everywhere. Warnings can't be taken down: any browser, or a single saved HTML file, verifies the board straight from Arkiv. And it meets people where scams arrive: paste a whole tweet or DM into the scanner and Countersign resolves every link and every name it claims to speak for against the chain ("Impersonation", "Genuine warning", "Unverified", "Key revoked"), or click the "Countersign it" bookmark on any site. No install, no wallet, no login.

**Challenges I ran into**
SDK 0.8.1 accepts uppercase attribute names that Tiramisu rejects, so we lowercased the whole schema. Entity events cannot be scoped to one app, so the live board re-reads on every foreign create; we debounced that. There is no server-side ordering, so the feed walks every page at one pinned block and sorts locally. Expiry has no event, so the board re-reads every 60 seconds. Building a verifier with zero dependencies meant writing a raw `arkiv_query` reader that matches the SDK's wire format exactly; tests keep the two in step. Details: arkiv/friction.md.

1. **Live app URL:** https://countersign-xyz.netlify.app
2. **Indian nationality on the team:** No
3. **Why Arkiv?**
The product is the question "who signed this, according to the chain". On Postgres or our own API, the author is a column the operator can rewrite, and one takedown removes every warning. On IPFS, a hash proves bytes, not the publisher, and we would need our own signature scheme and index to ask "alerts by these signers, severity ≥ 3"; nothing expires, so impostor spam stays. A subgraph needs our contract and someone's indexer, which becomes the new point to censor. Arkiv gives `$creator` set by the chain and queryable, so trust is one query anyone can run against any node. Per-type expiry cleans up unconfirmed alerts and idle seals by itself. Permissionless extension lets other signers keep a confirmed alert alive without being able to edit it. Kept off Arkiv on purpose: keys, any personal data, large files, UI state, and the verdicts themselves, which every reader recomputes.
4. **How do you use Arkiv?**
- `$creator` queries: seals and revokes are read only where `$creator = addr(root)`. The "Verified only" tab has the node filter alerts by `$creator`. https://github.com/joezzy-web3/countersign/blob/main/web/core/rpc.js
- Typed attributes vs payload: `severity` u64 for range filters, `signer` addr, `alert` key. Text goes in the JSON payload. https://github.com/joezzy-web3/countersign/blob/main/lib/writes.mjs
- Compound queries and cursor pagination, all pages pinned to one `atBlock`. https://github.com/joezzy-web3/countersign/blob/main/web/core/rpc.js
- Per-type expiration (grant 30 d, revoke 60 d, alert 7 d, cosign 7 d), each for a product reason. https://github.com/joezzy-web3/countersign/blob/main/arkiv/schema.md
- `extendEntity` as a lease: each countersign renews the alert, and seals renew only while their signer is active. https://github.com/joezzy-web3/countersign/blob/main/scripts/renew.mjs
- Creation flags: `readonly` so a signature covers fixed bytes; `permissionlessExtension` on alerts so another signer can renew them. https://github.com/joezzy-web3/countersign/blob/main/lib/writes.mjs
- Atomic `executeBatch`: cosign + renewal together; the charter grants all seals together. https://github.com/joezzy-web3/countersign/blob/main/netlify/functions/cosign.mjs
- `watchEntityEvents` over WebSocket with no `fromBlock`: the board updates without a refresh. https://github.com/joezzy-web3/countersign/blob/main/web/app.js
- On-chain rate limit: the attack endpoint counts recent impostor alerts with an Arkiv query. https://github.com/joezzy-web3/countersign/blob/main/netlify/functions/attack.mjs
5. **Friction report:** https://github.com/joezzy-web3/countersign/blob/main/arkiv/friction.md
6. **Wallet addresses:** copy the table from arkiv/wallets.md:
- root of trust (creates grant, revoke): `<0x…>`
- tiramisu-sentinel, demo signer (alert, cosign): `<0x…>`
- watchtower-dao, demo signer and /api/cosign (alert, cosign): `<0x…>`
- relay-guild, signer revoked in the demo (alert): `<0x…>`
- impostor and /api/attack (alert, cosign): `<0x…>`
7. **Schema:** https://github.com/joezzy-web3/countersign/blob/main/arkiv/schema.md
8. **How can judges reproduce your Arkiv usage?**
(a) Open the live app. It replays the recorded Tiramisu scenario, then switches to the live chain. (b) Press "Launch impostor attack": a new alert claiming tiramisu-sentinel lands from the impostor wallet and is stamped IMPOSTOR within seconds. (c) Press "Countersign" on a sealed alert: the cosign chip and the renewed lease appear together, from one batch transaction. (d) In "Check before you click", try the four sample messages: an impersonation, a genuine reposted warning, an unverified refund DM, and a revoked signer. (e) Open /verify.html, or save it and open it from disk. It reads Tiramisu directly and shows the same verdicts and the same digest. (f) Run the curl query in the README and compare each alert's creator with the root's grants. (g) Full local setup: README, "Run it yourself" (`npm install`, `npm test`, `npm run keys`, `fund`, `smoke`, `seed`, `revoke`).
9. **Pre-existing work:** None. Libraries only: @arkiv-network/sdk, viem.
10. **Arkiv surfaces used:** TypeScript SDK, Direct JSON-RPC, WebSocket events, Docs, Hub, Faucet, Block Explorer, Arkiv skills (the `Arkiv-Network/skills` repo, read as reference)
12. **First Arkiv entity:** 2 hours or less <confirm from arkiv/onchain-log.json>
13. **LLMs used:** Claude (Anthropic)
14. **One thing Arkiv should improve first:** Scoped event subscriptions. Today every app receives every app's `EntityCreated` with no attributes, so a live UI has to re-fetch on every foreign write. A filter by attribute or creator would remove most wasted reads.
15. **Feedback call:** <Yes/No>
16. **Built during the challenge, disclosed:** Yes. Note: built during the extended window announced by Arkiv (deadline moved to 20 October, 11:00 CEST).
17. **Public, MIT, links accessible:** Yes
18. **Devcon:** <optional>
