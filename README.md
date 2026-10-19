<p align="center"><img src="docs/banner.png" alt="Countersign: anyone can copy a name, nobody can copy a $creator" width="100%"></p>

<p align="center">
  <a href="https://countersign-xyz.netlify.app"><b>Live app</b></a> ·
  <a href="https://countersign-xyz.netlify.app/verify.html"><b>Verify without us</b></a> ·
  <a href="#use-it-in-10-seconds-no-install">Use it</a> ·
  <a href="#evidence-first">Evidence</a> ·
  <a href="#how-it-works-one-loop">How it works</a> ·
  <a href="arkiv/schema.md">Schema</a> ·
  <a href="arkiv/friction.md">Friction report</a>
</p>

<p align="center">
  <img alt="Arkiv Tiramisu" src="https://img.shields.io/badge/Arkiv-Tiramisu%207738577-1f6f58?style=flat-square">
  <img alt="Tracks" src="https://img.shields.io/badge/tracks-Security%20%2B%20Censorship%20Resistance-e3c08a?style=flat-square&labelColor=151311">
  <img alt="Tests" src="https://img.shields.io/badge/tests-44%20passing-36b48c?style=flat-square&labelColor=151311">
  <img alt="Backend in read path" src="https://img.shields.io/badge/backend%20in%20read%20path-none-f2ebe1?style=flat-square&labelColor=151311">
  <img alt="Licence" src="https://img.shields.io/badge/licence-MIT-9b8f81?style=flat-square&labelColor=151311">
</p>

# Countersign

**Scam alerts on Arkiv, judged by `$creator`. No seal, no trust.**

Anyone can copy a security team's name, logo and wording. Nobody can copy the wallet that signed a message. Countersign is a public scam-alert board where every alert is judged by its Arkiv `$creator` and traced to one root seal. An impersonator gets stamped **IMPOSTOR** in front of every reader. A leaked signing key gets revoked once, and every alert it ever made turns grey everywhere at the same moment. And before you click anything, you can paste the whole suspicious message: Countersign finds every link and every name it claims to speak for, and tells you whether that name ever signed it.

- **Live app:** https://countersign-xyz.netlify.app (opens on a recorded Tiramisu scenario, then switches to the live chain)
- **Standalone verifier:** https://countersign-xyz.netlify.app/verify.html (one file, zero dependencies)
- **Demo video (under 3 min):** https://youtu.be/mFA_pVlZDNg
- **Tracks:** Security, Censorship Resistance
- **Builder:** [@joezzyweb3](https://x.com/joezzyweb3) · [github.com/joezzy-web3](https://github.com/joezzy-web3)
- **Network:** Arkiv Tiramisu testnet, chain `7738577`. Synthetic demo data only.

## Use it in 10 seconds (no install)

You never need a terminal, a wallet or an account to use Countersign.

| You are | You do | You need |
|---|---|---|
| **Someone who was just sent a link** | Open the site, paste the whole tweet, DM or Discord post into **Check before you click**, press **Scan message** | A browser |
| **Someone who browses a lot** | Drag the **Countersign it** button to your bookmarks bar once. On any site, click it to check that site. Highlight a message first and it scans the message instead. | A browser |
| **A judge** | Press **Launch impostor attack**, then **Countersign** on a sealed alert, then try the four sample messages in the scanner | A browser |
| **Someone who trusts nobody, including us** | Save [`verify.html`](https://countersign-xyz.netlify.app/verify.html), open it, point it at any Arkiv node | A browser |
| **A security team (signer)** | Post and countersign alerts with your own key ([`lib/writes.mjs`](lib/writes.mjs)) | A wallet key |
| **The root (trust anchor)** | Grant and revoke seals from a terminal, on purpose: the root key never touches a website | Node 22 |

### What the scanner tells you

| You paste | Countersign says | Because |
|---|---|---|
| "URGENT from Tiramisu Sentinel: migrate at tiramisu-migrate.example" | **Impersonation.** It speaks for tiramisu-sentinel, but tiramisu-sentinel never signed it. | An impostor wallet already posted this exact claim under that name |
| "@tiramisu_sentinel: do NOT sign anything on claim-tiramisu-drop.example" | **Genuine warning.** tiramisu-sentinel signed this on Arkiv. Stay away from the link. | A sealed alert by that signer names that domain, confirmed by 2 seals |
| "Watchtower DAO here, refunds open, connect your wallet at watchtower-refund.example within 24 hours" | **Unverified.** watchtower-dao signed nothing about this link. Plus 3 drainer tactics. | The real watchtower-dao wallet has no sealed alert about it |
| "Relay Guild here: bridge reopened at relay-guild-bridge2.example" | **relay-guild's key was revoked.** Don't act on anything signed with it. | The root revoked that signer |

The verdict always comes from the chain. The tactic highlights (urgency, seed phrases, "connect your wallet") are labelled *patterns, not proof* and can only raise "nothing flagged" to "be careful". Logic: [`web/core/scan.js`](web/core/scan.js), 9 tests in [`test/scan.test.mjs`](test/scan.test.mjs).

## Evidence first

| Claim | How it is shown |
|---|---|
| An impersonator cannot pass as a trusted signer, even with identical name and text | Press **Launch impostor attack** on the live site. A fresh alert claiming `tiramisu-sentinel` lands from another wallet and is stamped IMPOSTOR. Tests: `test/verdict.test.mjs` (impostor, forged grant, forged revoke, case tricks). |
| Revocation reaches every reader at once | `npm run revoke` writes one `revoke` entity. The board recomputes from chain state, so every open browser and the standalone verifier flip that signer's alerts to REVOKED. |
| Reading needs no Countersign server | `web/verify.html` inlines the same engine and talks raw JSON-RPC to any Arkiv node. `test/verifier.test.mjs` fails if it ever drifts from the board's engine. Both print the same SHA-256 verdict digest at the same block. |
| One leaked signer key cannot clear a scam on its own | Alerts need **2 independent seals** to be confirmed, and an "all clear" only overrides a warning when confirmed. `test/check.test.mjs` simulates the leaked key. |
| A judge's browser does not run out of RPC budget | One `arkiv_query` per board view (tested), live events filtered to known wallets, and a clear message on HTTP 429 instead of a hang. |
| Every verdict is deterministic | `web/core/verdict.js` is pure code: same snapshot gives the same verdicts and the same digest, in any input order. 44 tests, `npm test`. |
| A pasted message is judged by the chain, not by keywords | `web/core/scan.js` resolves every link and every claimed signer name against sealed alerts, impostor posts and revocations. Keyword "tactics" alone can never produce a danger verdict. `test/scan.test.mjs`. |
| Every Arkiv path we rely on works on Tiramisu | `npm run smoke` runs each path and commits expected vs actual to `arkiv/smoke-results.json`, rendered into `arkiv/friction.md`. |

## The problem (why Security, and why Censorship Resistance)

When a drainer site starts spreading, people learn about it from security teams' posts on X, Discord and Telegram. Those posts are trusted because of the account they come from, and accounts get taken over:

- **3 January 2024:** Mandiant's X account was hijacked and used to send followers to a crypto drainer page. Mandiant tied it to a drainer-as-a-service campaign that had taken at least $900,000. ([Infosecurity Magazine](https://infosecurity-magazine.com/news/mandiant-x-account-brute-force))
- **5 January 2024:** CertiK's X account posted a fake "Uniswap Router exploit" security alert telling users to revoke approvals through a link that was itself a drainer. ([CryptoSlate](https://cryptoslate.com/certiks-social-media-hacked-users-warned-against-phishing-links-disguised-as-uniswap-exploit/))
- Wallet drainers took about **$494 million** in 2024 across more than 300,000 addresses, using compromised accounts, fake accounts and ads on X among other channels. ([BleepingComputer, citing Scam Sniffer](https://www.bleepingcomputer.com/news/security/cryptocurrency-wallet-drainers-stole-494-million-in-2024))

Two things go wrong, and both hurt ordinary wallet holders at the exact moment they are trying to be careful:

1. **Forged or hijacked authority.** A display name proves nothing, and a hijacked account looks exactly like the real one. One stolen login is enough to issue a "security alert" that is the scam.
2. **Warnings that can be taken down.** A warning lives on one platform account or one website. A suspension, a mass-report campaign or a takedown removes it while the scam keeps running.

What changes from day one with Countersign:

- **An impersonator** copying CertiK-style wording from another wallet is stamped **IMPOSTOR**, because the verdict comes from `$creator`, not from the name.
- **A hijacked signer key** (the CertiK case) can post one sealed alert, but it shows **1 of 2 seals** and cannot clear an existing warning on the link check without a second, independent seal. The root revokes the key once, and every alert it signed turns grey for every reader at the same moment.
- **Censorship resistance:** anyone can read and query every alert, seal and revocation straight from Arkiv, without our backend. `verify.html` proves it and keeps working if this website disappears.

## How it works: one loop

```
  ISSUE ──────────► COUNTERSIGN ──────────► VERIFY ──────────► REVOKE
  a signer posts     another signer          every reader         the root cancels
  an alert           confirms it: cosign     recomputes trust     a leaked seal; its
  (readonly, 7 d)    + 7-day renewal in      from $creator        alerts grey out
                     ONE atomic batch        back to the root     everywhere, at once
```

```mermaid
flowchart LR
  R(("Root<br/>0xa35b…78c7")) -->|"grant (seal, 30 d)"| S1["tiramisu-sentinel"]
  R -->|grant| S2["watchtower-dao"]
  R -->|"grant, later revoke"| S3["relay-guild"]
  S1 -->|"$creator"| A1["alert: Fake airdrop<br/>VERIFIED · 2 seals"]
  S2 -.->|"cosign + extend<br/>(one atomic batch)"| A1
  S3 -->|"$creator"| A3["alert: Bridge notice<br/>REVOKED"]
  X["0xd5da…ac97<br/>(no seal)"] -->|"claims tiramisu-sentinel"| A2["alert: URGENT migrate<br/>IMPOSTOR"]
```

The only hard-coded trust decision is one root address. The root creates `grant` entities ("seals") for signers. An alert is **verified** if its `$creator` is the root, or holds a live seal from the root that the root has not revoked. It is an **impostor** if it claims a label the root gave to a different wallet. Otherwise it is **unverified**, or **revoked** if its signer was revoked. Full schema: [`arkiv/schema.md`](arkiv/schema.md).

### Architecture

```mermaid
flowchart TB
  subgraph Reader["Any browser (no login, no wallet)"]
    UI["Board · Message scanner · Link check<br/>web/app.js"] --> ENG["Pure trust engine<br/>verdict.js · check.js · scan.js"]
    V["verify.html<br/>(same engine, one file)"]
  end
  subgraph Arkiv["Arkiv · Tiramisu"]
    E[("grant · revoke · alert · cosign<br/>entities with $creator")]
  end
  UI -->|"1 arkiv_query per view<br/>+ WebSocket events"| E
  V -->|"raw JSON-RPC, any node"| E
  subgraph Demo["Netlify functions (demo writers only)"]
    AT["/api/attack<br/>impostor key"]
    CS["/api/cosign<br/>demo signer keys"]
  end
  UI -.->|"button press"| AT & CS
  AT & CS -->|"createEntity / executeBatch"| E
  ROOT["Root (terminal only)<br/>scripts/revoke.mjs"] -->|"grant / revoke"| E
```

Reads never touch our server. The two functions exist only so judges can trigger writes without a wallet; they are rate limited on-chain and refuse to countersign anything that is not already verified.

## Why Arkiv (what breaks elsewhere)

| Alternative | What breaks |
|---|---|
| **Postgres or our own API** | The operator can rewrite who "posted" an alert, because the author is just a column. Readers must trust us. One takedown or one outage removes every warning. |
| **IPFS** | Content addressing proves the bytes, not who published them. We would need a separate signature scheme and a separate index to ask "all alerts by these signers, severity ≥ 3". Nothing expires, so impostor spam lives forever unless someone unpins it. |
| **A subgraph** | It needs a contract we deploy and an indexer someone runs. The indexer operator becomes the new point to censor. Authorship would be `msg.sender` to a contract we wrote, rather than a property of the data itself. |
| **Arkiv** | `$creator` is set by the chain and is queryable (`$creator = addr(...)`), so trust is one query that anyone can run. Expiry makes unconfirmed alerts and idle seals vanish by themselves. Permissionless extension lets other signers keep a confirmed alert alive without being able to edit it. Any node serves the same answer. |

**Without `$creator` the product falls apart:** the whole verdict is "who signed this, according to the chain". **Deliberately kept off Arkiv:** private keys (Netlify env only), any personal data (none exists; targets are `.example` domains), screenshots or large files, UI state, and the verdicts themselves (recomputed by every reader, never stored, so there is nothing to forge).

## How we use Arkiv (each feature changes what the user sees)

| Feature | How | What the user sees | Code |
|---|---|---|---|
| `$creator` in queries | Seals and revokes are read with `$creator = addr(root)`. The "Verified only" tab asks the **node** for alerts whose `$creator` is in the active set. | The "signed by ($creator)" field next to "claims", and the IMPOSTOR stamp when they disagree. | [`web/core/rpc.js`](web/core/rpc.js), [`web/core/verdict.js`](web/core/verdict.js) |
| Typed attributes vs payload | Everything filtered on is a typed attribute (`severity` u64 for ranges, `signer` addr, `alert` key). Text is in the JSON payload. | The severity filter and a feed that loads by query, not by scanning blobs. | [`lib/writes.mjs`](lib/writes.mjs) |
| Compound queries + cursor pagination | `AND`, `OR`, `>=` ranges. Every page is pinned to one `atBlock` and walked with the cursor at 200 per page. | A board that is internally consistent at one block number, shown in the header. | [`web/core/rpc.js`](web/core/rpc.js) |
| Entity expiration per type | grant 30 d, revoke 60 d, alert 7 d, cosign 7 d, each for a product reason. | A lease bar on every alert. Unconfirmed alerts and idle seals disappear by themselves. | [`lib/writes.mjs`](lib/writes.mjs) |
| `extendEntity` as a lease | Each countersign renews its alert for 7 days. `npm run renew` renews only seals whose signers were active in the last 30 days. | The lease bar refills when an alert is countersigned. | [`lib/writes.mjs`](lib/writes.mjs), [`scripts/renew.mjs`](scripts/renew.mjs) |
| Creation flags | `readonly` everywhere, so "signed by X" means these exact bytes. `permissionlessExtension` on alerts, so a different signer can renew them. | Countersign from another wallet works. Nobody can edit a sealed alert after the fact. | [`lib/writes.mjs`](lib/writes.mjs) |
| Quorum from independent `$creator`s | An alert's seal count is its author plus countersigns from *other* active seals. 2 seals = confirmed. | "1 of 2 seals" / "Confirmed · 2 seals" on every sealed alert, and the link check refuses a single-seal "all clear". | [`web/core/verdict.js`](web/core/verdict.js), [`web/core/check.js`](web/core/check.js) |
| Atomic batches | Countersign = create `cosign` + extend `alert` in one `executeBatch`. The charter grants all seals in one batch. | A cosign chip and a renewed lease always appear together, never one without the other. | [`lib/writes.mjs`](lib/writes.mjs), [`netlify/functions/cosign.mjs`](netlify/functions/cosign.mjs) |
| WebSocket entity events | `watchEntityEvents` over a WebSocket transport, no `fromBlock`. Any relevant event triggers one debounced re-read. | Attacks, countersigns and revocations appear without a refresh, and the Threat digest narrates them. | [`web/app.js`](web/app.js) |
| On-chain rate limiting | `/api/attack` counts the impostor's alerts from the last 10 minutes with an Arkiv query before writing. | The demo cannot be spammed, with no database. | [`netlify/functions/attack.mjs`](netlify/functions/attack.mjs) |

## Run it yourself

Requirements: Node 22.10 or newer, a terminal, and testnet GLM from the Arkiv faucet.

```bash
git clone https://github.com/joezzy-web3/countersign && cd countersign
npm install
npm test                      # 44 tests, no network needed

npm run keys                  # makes 5 testnet wallets: keys go to .env (git-ignored), addresses to web/core/config.js and arkiv/wallets.md
# fund the ROOT address at https://hub.arkiv.network/faucet
npm run fund                  # root shares its GLM with the other 4 wallets
npm run smoke                 # proves every Arkiv path on Tiramisu, writes arkiv/smoke-results.json
npm run friction              # renders those results into arkiv/friction.md
npm run seed                  # charter, alerts, countersigns, and the impostor
npm run revoke                # root revokes the compromised signer
npm run replay                # records the board into web/replay.json for the opening scenario
npm run proof                 # writes PROOF.md: every transaction and verdict with explorer links
npm run demo -- 60            # live demo: fresh single-seal alert + re-granted relay-guild, revoked after 60 s
npm run dev                   # http://localhost:5173 (reads Tiramisu directly; the attack and countersign buttons need Netlify)
```

Deploy on Netlify: publish directory `web`, functions in `netlify/functions` (already in `netlify.toml`). Set these environment variables in the Netlify UI, never in the repo: `KEY_IMPOSTOR`, `KEY_WATCHTOWER`, `KEY_SENTINEL` (testnet keys from your `.env`).

### Reproduce one verdict by hand

```bash
curl -s https://rpc.tiramisu.db-chain.testnet.arkiv.network -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"arkiv_query","params":["app = str('"'"'countersign'"'"') AND type = str('"'"'grant'"'"')",{"select":{"key":true,"creator":true,"attributes":true}}]}'
```

The grants whose `creator` is the root address in [`arkiv/wallets.md`](arkiv/wallets.md) are the only seals. Run the same query with `type = str('alert')` and compare each alert's `creator` with those seals' `signer` attributes. That comparison is the whole verdict.

## Judging criteria map

| Criterion | Where to look |
|---|---|
| Why this pillar | "The problem" above. Security: the app filters by `$creator`. Censorship Resistance: `verify.html` reads without our backend. |
| Why Arkiv | "Why Arkiv" table above, including what stays off Arkiv. |
| How you use Arkiv | "How we use Arkiv" table above, with code links. Schema: [`arkiv/schema.md`](arkiv/schema.md). |
| Friction report | [`arkiv/friction.md`](arkiv/friction.md): 11 items with versions, steps, expected vs actual and fixes, plus the live smoke table. |

## Sceptic's FAQ

**Isn't the root address a central point of trust?** Yes, deliberately and visibly. It is one public address you can change in the verifier's input box. A reader chooses whom to trust. What Countersign removes is trust in *us*: we cannot forge a verdict, and we cannot hide one.

**Can the impostor just extend their own alert forever?** They can keep it alive. It stays stamped IMPOSTOR, because the verdict comes from `$creator`, not from age or lifetime.

**Can someone write a fake `grant` to make themselves trusted?** They can write one. It is ignored, because grants only count when `$creator` is the root. There is a test for it.

**What if one signer's key leaks?** Before the root revokes it, the attacker can post sealed alerts. They cannot reach a quorum of 2 alone, so they cannot clear a warning on the link check, and once revoked, every alert from that key turns grey everywhere.

**What if the root key leaks?** Then that trust anchor is gone. Readers move to a new root in one input. Hardware or multisig custody of the root is the real answer, and it is out of scope for a testnet demo.

**Your demo buttons hold signer keys on a server. Isn't that the opposite of the point?** They are testnet demo keys, so judges can try it without a wallet. They are rate limited on-chain and in memory. The countersign endpoint refuses anything that is not already verified. Real signers sign with their own keys, and the scripts show that flow.

**Doesn't the scanner just grep for scary words?** No. Words never decide. A danger verdict needs the chain: a sealed warning on a link, an impostor post with the same claim, or a revoked signer. Tactic words only turn "nothing flagged" into "be careful", and they are labelled *patterns, not proof*.

**Why no AI?** The point of Countersign is that the chain decides and anyone can recompute the answer. A model can be tricked by the very message it is judging. An "explain this in plain words" layer could sit on top later, never under the verdict.

**Why raw JSON-RPC for reads instead of the SDK?** So the verifier can be one file with zero dependencies. Writes and live events use the SDK.

## Verified and not verified

Verified here: the trust engine, quorum, link check and message scanner with their edge cases (44 tests), the raw RPC reader against the SDK's wire format, query strings against the SDK's `render()`, the verifier/board parity, the UI in replay mode at desktop and phone width.

Verified on Tiramisu by `npm run smoke`: see the table in [`arkiv/friction.md`](arkiv/friction.md).

Not verified: behaviour under heavy load, mainnet, and any wallet other than plain EOAs.

## Disclosure

- **Pre-existing work:** none. Built during the challenge (its deadline was extended to 20 October 2026, 11:00 CEST). Third-party code used as libraries only: `@arkiv-network/sdk`, `viem`.
- **AI assistance:** built with Claude (Anthropic) as a coding assistant.
- **Data:** every organisation, domain and message is synthetic. No private keys or personal data are stored on Arkiv.

## Credits

Ideas we learned from other builders in this challenge, and what we built from them: [`CREDITS.md`](CREDITS.md).

## Licence

MIT. See [`LICENSE`](LICENSE).
