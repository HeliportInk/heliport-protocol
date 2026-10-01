# Roadmap

Phases are ordered by dependency, not by calendar. No dates are promised; each phase ends when its exit criteria are met.

## Phase 0: Foundation (in progress)

- Brand identity and palette sampled from supplied assets
- Public website at heliport.ink with live Robinhood Chain readout
- Fact register: contract address, socials and app link stay inert until stated
- Automated checks for layout, motion, data fallbacks and copy

**Exit:** site and repository are stable and documented.

## Phase 1: Protocol design

- Finalise the threat model and privacy guarantees
- Choose the proof system and specify circuits
- Define note format, nullifier scheme and shielded-balance accounting
- Publish a specification for review

**Exit:** reviewed specification with open questions resolved or listed.

## Phase 2: Core implementation

- Shielded balance contracts
- Browser-side proving, with all inputs kept on the device
- Reference client for shield, pay and withdraw
- Test suite, including adversarial cases

**Exit:** end-to-end flow works on a test environment.

## Phase 3: Hardening

- Independent security review of circuits and contracts
- Fuzzing and invariant testing
- Responsible-disclosure channel exercised
- Usability pass on proving time and recovery

**Exit:** review findings addressed and published.

## Phase 4: Launch

- Wallet app announced through the register
- Documentation for users and integrators
- Monitoring and incident process in place

**Exit:** the app link is stated on the site.

## Later

Relayer options, disclosure tools for selective proof to third parties, and broader asset support, subject to Phase 1 and 3 outcomes.
