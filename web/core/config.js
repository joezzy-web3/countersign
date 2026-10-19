// Public configuration. Addresses only: never put a private key here.
// `npm run keys` rewrites this file with the addresses of the wallets it generates.

export const CONFIG = {
  chainId: 7738577,
  rpcHttp: "https://rpc.tiramisu.db-chain.testnet.arkiv.network",
  rpcWs: "wss://rpc.tiramisu.db-chain.testnet.arkiv.network",
  explorer: "https://tiramisu.explorer.arkiv.network",
  dataExplorer: "https://data.arkiv.network",
  repo: "https://github.com/joezzy-web3/countersign",
  // The root of trust. The only hard-coded trust decision in the whole app.
  root: "0xa35b4CF284cf5FF87912a5Eeb533CB3bF52778C7",
  // Public addresses of the demo wallets, listed for judges (on-chain evidence gate).
  wallets: {
    root: "0xa35b4CF284cf5FF87912a5Eeb533CB3bF52778C7",
    sentinel: "0xc5b115b49F1f5690862c65a686Eac462EE5b7c9c",
    watchtower: "0x001f7b52B26e563B0c3A4d909fFf7D8c6b6aa698",
    compromised: "0xBddF4A21E147Ab02b0fA7fe553Cc5F72Fe6e7a1d",
    impostor: "0xd5DaE49f8f9f78FB0465afC4B4207c67dba3Ac97",
  },
};
