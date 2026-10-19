# Demo video script (target 2:40, hard limit 3:00)

Record the live site in a 1280×800 browser window, with a terminal beside it for the revoke. Speak plainly. Every number on screen must be real.

| time | screen | say |
|---|---|---|
| 0:00–0:15 | Landing page, replay starting | "Scam warnings travel on display names. Anyone can copy a name. Countersign judges every alert by the wallet that actually signed it, its Arkiv `$creator`." |
| 0:15–0:45 | Replay plays: seals granted, alerts land, impostor stamped | "This is a recording of real Tiramisu data. The root grants three seals in one batch. Signers post alerts. Then a wallet posts an 'urgent migration' notice in tiramisu-sentinel's name. Same name, same tone, and it's stamped impostor, because the `$creator` isn't the one the root sealed." |
| 0:45–1:10 | Switch to Live. Click **Launch impostor attack** | "Now live. I'll attack it myself." Wait for the stamp. "The node pushed the event over a WebSocket, the board re-read Arkiv straight from my browser, and the verdict came from `$creator`." |
| 1:10–1:35 | Click **Countersign** on a sealed alert | "Watchtower confirms this alert. One atomic batch creates the cosign record and renews the alert's seven-day lease. You never get one without the other. Unconfirmed alerts just expire." |
| 1:35–2:00 | Terminal: `npm run revoke`. Back to the board | "relay-guild's key leaked. The root writes one revoke entity, and every alert relay-guild ever signed turns grey, for every viewer, at once." |
| 2:00–2:25 | Open `verify.html` from disk, press Verify | "This is the censorship-resistance part. One HTML file, no dependencies, raw JSON-RPC to any Arkiv node. Same verdicts, same digest as the board. If our website disappears, the warnings don't." |
| 2:25–2:40 | README criteria table, `arkiv/friction.md` | "Schema, the friction report with versions and reproduction steps, and the wallets are all in the repo. Countersign: no seal, no trust." |

Before recording: run `npm run seed` and `npm run replay` (and redeploy) so the replay is fresh, open the live site once to warm the CDN, and check that `/api/attack` works.
