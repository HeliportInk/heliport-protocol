# Heliport Whitepaper

*Protocol overview and vision. Working draft; sections marked "open" are undecided.*

## 1. Problem

A public chain is a permanent, searchable record. Every payment exposes a sender, a receiver and an amount, and those records can be joined into a picture of someone's finances. For salaries, supplies, donations or ordinary spending, that exposure is a cost nobody agreed to.

Most responses force a trade: either give up verifiability, or give up usability. Heliport aims to keep both.

## 2. Vision

Payments should be as quiet onchain as cash is in a pocket, yet as checkable as any transaction. Heliport targets that on Robinhood Chain (chain id 4663) for ETH.

Design principles:

1. **Quiet by default.** Privacy is the normal path, not a special mode.
2. **Verifiable.** Anyone can confirm a payment is valid without learning its details.
3. **Local proving.** Proofs are generated on the payer's device, so sensitive inputs do not travel to a remote prover.
4. **Honest limits.** The system narrows what outsiders learn. It does not promise invisibility.

## 3. Protocol in brief

| Step | What happens | Who sees what |
| --- | --- | --- |
| Shield | ETH moves into a shielded balance | Deposit is a public onchain action |
| Prove | Payer's device builds a zero-knowledge proof | Nothing leaves the device but the proof |
| Pay | Proof and a private note update are submitted | Observers learn that a valid payment occurred, not sender or amount |
| Withdraw | Value leaves the shielded balance | Exit is a public onchain action |

Details are in [architecture.md](architecture.md).

## 4. Threat model (draft)

In scope: observers reading chain data, indexers linking addresses, passive timing analysis.
Out of scope for the protocol itself: compromised user devices, coerced disclosure, and behavioural patterns such as depositing and withdrawing identical amounts in quick succession.

Entry and exit points touch public rails. Careless habits can leave patterns. Users should vary timing and amounts and keep their devices clean.

## 5. Governance and token

Whether a token exists, what it does and how it is distributed are not stated. See [tokenomics.md](tokenomics.md) for the framework used to document it once decided.

## 6. Open questions

- Proof system choice and circuit audit scope
- Relayer model for fee payment without linking addresses
- Anonymity-set growth strategies
- Disclosure options for users who need to prove a payment to a third party

## 7. Disclaimer

This document describes intent, not a guarantee. It is not investment guidance.
