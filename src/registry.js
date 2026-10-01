// The register. To state a fact: set state to "stated" and fill value / url, then rebuild.
// Socials store the full URL only; the visible handle is derived from it at build time.
//   app    -> full URL of the wallet app
//   x      -> e.g. https://x.com/<handle>
//   github -> e.g. https://github.com/<org-or-user>
//   ca     -> 0x + 40 hex characters

export const REGISTRY = {
  domain: { state: 'stated', value: 'heliport.ink', url: 'https://heliport.ink' },
  chain: { state: 'stated', value: 4663 },
  rpc: { state: 'stated', value: 'https://rpc.mainnet.chain.robinhood.com' },
  app: { state: 'absent' },
  ca: { state: 'absent' },
  ticker: { state: 'absent' },
  x: { state: 'absent' },
  github: { state: 'absent' },
  srcLlama: { state: 'stated', value: 'DefiLlama', url: 'https://defillama.com/chain/Robinhood%20Chain' },
  srcDex: { state: 'stated', value: 'DexScreener', url: 'https://dexscreener.com/robinhood' },
};
