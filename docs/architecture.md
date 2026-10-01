# Architecture

Technical overview of Heliport's components. The protocol layers describe the design target; the website layer describes what exists in this repository today.

## 1. Layers

```
┌───────────────────────────────┐
│ Client (browser)              │  key handling, note storage, proving
├───────────────────────────────┤
│ Submission                    │  transaction to Robinhood Chain (id 4663)
├───────────────────────────────┤
│ Onchain contracts             │  shielded balance, nullifier set, verifier
├───────────────────────────────┤
│ Robinhood Chain               │  settlement and data availability
└───────────────────────────────┘
```

## 2. Protocol components (design)

**Shielded balance.** ETH deposited into a contract becomes a commitment inside a Merkle tree. Value is represented as private notes known only to their owner.

**Notes.** A note binds an amount and an owner secret into a commitment. Spending reveals a nullifier, never the note.

**Nullifier set.** The contract records nullifiers to prevent double-spends without linking a spend to its original commitment.

**Proofs.** A zero-knowledge proof shows that the spender owns an unspent note in the tree, that inputs equal outputs, and that new commitments are well formed. The proof is generated on the payer's device, so secrets never leave it.

**Verifier.** An onchain verifier checks the proof and updates state. Observers learn that a valid payment occurred.

## 3. Data flow

1. Client builds inputs from local notes.
2. Client proves locally and produces a proof plus public outputs.
3. Transaction carries the proof, nullifiers and new commitments.
4. Contract verifies, records nullifiers and appends commitments.
5. Recipient's client scans new commitments and recovers notes addressed to it.

## 4. Privacy boundary

| Visible | Hidden |
| --- | --- |
| Deposits (address, amount) | Amount of a shielded payment |
| Withdrawals (recipient, amount) | Sender and receiver of a shielded payment |
| That a valid payment occurred | Which commitment funded a spend |

Small anonymity sets and timing correlation reduce practical privacy; see the threat model in the [whitepaper](whitepaper.md).

## 5. Website layer (implemented)

- Static build from `src/` into `dist/`, no runtime dependencies in the page.
- **Register** (`src/registry.js`): each external fact is a record with state *stated*, *absent* or *unconfirmed*. Links and the contract slot render only for stated records; handles are derived from stored URLs.
- **Live readout:** chain TVL from DefiLlama, block height and gas price from the chain RPC with a chain-id check, ETH pairs from DexScreener. Each source degrades independently.
- **Tokens:** colours live in one generated file with per-pixel provenance from the supplied brand assets.
- **Checks:** headless-browser gates cover layout at five widths, tap targets, motion, reduced-motion behaviour, failure paths and copy.

## 6. Open design items

Proof system and circuit size, relayer design, note discovery strategy, and upgrade policy for contracts.
