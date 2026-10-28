# ADR-002: Game State — Pure Engine Function

**Status:** Accepted
**Date:** 2026-10-27

---

## Context

The game has a moderately complex state machine: five phases, lazy deadlines,
per-player redaction, scoring, presence detection, and host succession. The
logic needs to be correct and verifiable before the API or database layers
are added.

---

## Decision

Implement the game engine as a set of **pure functions** with no side effects,
no I/O, and no global state:

- applyAction(state, action, now) => GameState
- advanceGameState(state, now) => GameState
- createRoomState(input) => GameState
- getPlayerGameView(state, playerId) => PlayerGameView
- getLeaderboard(state) => Player[]
- getWinners(state) => Player[]

The now parameter is always a caller-supplied timestamp. The engine has no
access to Date.now(). This makes every behaviour testable with a fake clock.

The state argument is never mutated. applyAction clones it first. If the action
is rejected (via GameRuleError), the original state is untouched.

---

## Consequences

**Good**

- Every rule, scoring edge case, and phase transition can be unit-tested
  without a server, a database, or a network connection.
- Bugs are caught before the API layer exists.
- The engine can be reasoned about in isolation.
- The pure design maps cleanly to the optimistic-locking pattern in ADR-001:
  the engine computes the new state, and the storage layer decides whether to
  commit it.

**Constraints this creates**

- Randomness (shuffle order) cannot be generated inside the engine; it must be
  injected by the caller. The API layer supplies a shuffled order when
  transitioning to VOTE, and the engine stores it. Tests can supply a
  deterministic order.
- The engine does not call advanceGameState itself. The API layer calls it
  before dispatching any action so that expired deadlines are resolved first.

**Rejected alternatives**

- Class-based stateful engine: harder to clone, harder to test, unnecessary
  for this scale.
- Engine that calls Date.now() internally: untestable with a fake clock.
- Engine with side effects (logging, DB writes): mixes concerns and
  complicates testing.

---

## Error handling

The engine throws GameRuleError for all rule violations. The API layer catches
these and maps them to HTTP 400 or 403 responses. Any other error is an
unexpected bug and becomes an HTTP 500.

---

## Versioning

Every successful applyAction call increments state.version by 1. The storage
layer uses this version for optimistic-locking. advanceGameState also
increments version when it makes changes (deadline advance or player expiry).

---

## Phase transition idempotency

Advance attempts carry a roundNumber. If the state has already advanced past
that round or phase, the request is a no-op (or returns a clear error). This
makes concurrent advance attempts from multiple polling clients safe.
