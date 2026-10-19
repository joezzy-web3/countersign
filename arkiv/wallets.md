# Wallets that create Countersign's entities on Tiramisu (chain 7738577)

Public addresses only. Every Countersign entity in the demo was created by one of these five wallets.

| role | address | creates |
|---|---|---|
| root of trust | `0xa35b4CF284cf5FF87912a5Eeb533CB3bF52778C7` | grant, revoke |
| tiramisu-sentinel (demo signer) | `0xc5b115b49F1f5690862c65a686Eac462EE5b7c9c` | alert, cosign |
| watchtower-dao (demo signer, also /api/cosign) | `0x001f7b52B26e563B0c3A4d909fFf7D8c6b6aa698` | alert, cosign |
| relay-guild (signer revoked in the demo) | `0xBddF4A21E147Ab02b0fA7fe553Cc5F72Fe6e7a1d` | alert |
| impostor (also /api/attack) | `0xd5DaE49f8f9f78FB0465afC4B4207c67dba3Ac97` | alert, cosign |

Explorer: https://tiramisu.explorer.arkiv.network. Every transaction the scripts sent is in arkiv/onchain-log.json.
