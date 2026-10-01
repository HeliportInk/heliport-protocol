<div align="center">

# Heliport

**Payments without the noise.**
A shielded payment protocol for ETH on Robinhood Chain.

[heliport.ink](https://heliport.ink) · [Whitepaper](docs/whitepaper.md) · [Architecture](docs/architecture.md) · [Roadmap](docs/roadmap.md) · [Tokenomics](docs/tokenomics.md)

</div>

---

## Overview

Public ledgers publish everything: who paid, who received, how much. Heliport keeps ETH payments useful onchain while keeping those details out of public view.

- **Shield.** ETH enters a shielded balance, the starting point for every discreet transfer.
- **Prove.** Each payment carries a zero-knowledge proof showing the transfer is valid without exposing its details. The proof is computed on the payer's own device.
- **Move.** Transfers, withdrawals and other onchain operations stay verifiable for anyone, without unnecessary exposure.

## Network

| | |
| --- | --- |
| Chain | Robinhood Chain |
| Chain id | `4663` |
| Public RPC | `https://rpc.mainnet.chain.robinhood.com` |
| Site | [heliport.ink](https://heliport.ink) |

The site at heliport.ink also carries a live readout of the chain: locked value (DefiLlama), block height and gas price (chain RPC) and the busiest ETH pairs (DexScreener). All of it is fetched in the visitor's browser; nothing is stored server-side.

## Contract address

| Item | Status |
| --- | --- |
| Contract address | **Not stated yet** |

The site pins one contract-address slot at the top of every screen. It stays inert until an address is stated. Until then, nothing in this repository represents a tradable asset. Always compare any address with the project's official channels before sending funds.

## Links

| Channel | Status |
| --- | --- |
| Website | [heliport.ink](https://heliport.ink) |
| X | Not stated yet |
| GitHub | This repository |
| Wallet app | Not stated yet |

Facts are tracked in a register with three states: *stated*, *absent* and *unconfirmed*. Only stated entries become links.

## Repository layout

```
src/        site source, colour tokens, brand-derived assets
scripts/    build and palette-sampling scripts
gates/      automated checks (layout, motion, data, copy, palette)
brand/      supplied logo files
reference/  supplied presentation slides
docs/       protocol documents
.github/    contribution and security policies
```

## Develop

```bash
npm install
npm run build    # src/ -> dist/
npm run gates    # automated checks against synthetic fixtures
```

## Documentation

- [Whitepaper](docs/whitepaper.md): protocol overview and vision
- [Architecture](docs/architecture.md): components and data flow
- [Tokenomics](docs/tokenomics.md): token structure, with open items marked
- [Roadmap](docs/roadmap.md): phases and exit criteria
- [Contributing](.github/CONTRIBUTING.md) · [Security](.github/SECURITY.md)

## Status

Heliport is experimental software. Nothing here is investment guidance. Privacy tools narrow what outsiders can learn; they do not make anyone invisible.

## License

[MIT](LICENSE)
