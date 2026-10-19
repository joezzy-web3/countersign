# Credits

Ideas we learned from other builders in this challenge, and what we did with them. No code was copied; each idea was re-implemented for Countersign.

| From | What we learned | What Countersign does with it |
|---|---|---|
| **Mirrorlease** ([0xmago77/Mirrorlease](https://github.com/0xmago77/Mirrorlease)) | Their public friction report showed that the public Tiramisu RPC meters `arkiv_query` per connection. | One query per board view, live events filtered to known wallets, and a clear message on HTTP 429 instead of a hang. |
| **Mirrorlease** | A "read it without us" page with the raw query, and pinning the trusted address in the browser with a warning if it changes. | A copyable `curl` for the whole board, and `verify.html` pins the root and warns loudly if a later copy uses a different one. |
| **On the Clock** ([RaYYeR220/on-the-clock](https://github.com/RaYYeR220/on-the-clock)) | A `PROOF.md` that backs every claim with explorer links, and grounding the problem in a real, dated incident. | `npm run proof` writes `PROOF.md` from the chain, and the README cites the January 2024 Mandiant and CertiK account takeovers. |
| **Mandate** ([1888-Labs/Mandate](https://github.com/1888-Labs/Mandate)) | Every ALLOW/DENY answer shows the delegation chain behind it. | Every alert shows its trust path: root → seal → `$creator` → alert, and where the chain breaks for an impostor. |

## Libraries and assets

- [`@arkiv-network/sdk`](https://github.com/Arkiv-Network/arkiv-sdk-js) and [viem](https://github.com/wevm/viem) (MIT)
- [three.js](https://github.com/mrdoob/three.js) (MIT), bundled into `web/vendor/seal3d.js`
- [Archivo](https://github.com/Omnibus-Type/Archivo) by Omnibus-Type and [Martian Mono](https://github.com/evilmartians/mono) by Evil Martians (SIL Open Font License, see `web/fonts/`)
- Arkiv's [agent skills](https://github.com/Arkiv-Network/skills), read as reference for the SDK's behaviour
