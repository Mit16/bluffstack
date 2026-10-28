# Bluffstack - Current State

_Last updated: 2026-10-28 - Commit: 4905d70_

---

## Phase summary

| Phase | Status |
|---|---|
| 1 - Project setup | Complete |
| 2 - Pure game engine | Complete |
| 3A - Submission integrity | Complete |
| 3B - Fake-answer similarity (inter-fake) | Complete |
| 3C - Voting-option shuffle | Next |
| 3D - Lifecycle and deadline edge cases | Pending |
| 3E - Final engine verification | Pending |
| 4 - Supabase schema and persistence layer | Not started |
| 5 - Netlify Function API | Not started |
| 6 - React UI | Not started |
| 7 - Deploy and playtest | Not started |

---

## What is implemented

### Game engine (src/lib/game-engine.ts)

The authoritative, pure TypeScript state machine. All mutations go through
applyAction(state, action, now) => GameState. The original state is never
mutated; a deep clone is returned on every successful action.

**Implemented actions**

| Action | Behaviour |
|---|---|
| JOIN | Allowed in LOBBY or FINISHED only. Resets scores when joining a finished room. |
| HEARTBEAT | Updates player.lastSeen; used to detect inactive players. |
| LEAVE | Marks player inactive; triggers early-advance if applicable. |
| START_GAME | Host only; requires 2+ active players; begins round 1. |
| SUBMIT_FAKE | WRITE phase only; validates length 20-500 chars and similarity against real definition; advances to VOTE when all active players have submitted. |
| SUBMIT_VOTE | VOTE phase only; rejects self-votes and duplicates; advances to REVEAL when all active players have voted. |
| ADVANCE | Manual phase advance; also fires lazily when advanceDeadline is called on any request after a deadline expires. |
| PLAY_AGAIN | FINISHED phase only; host resets scores and starts round 1 with same players. |

**Phase timers**

- WRITE deadline: now + 45 000 ms
- VOTE deadline: now + 30 000 ms
- REVEAL deadline: now + 10 000 ms
- All deadlines are stored as absolute epoch timestamps in state.phaseDeadline.
- advanceDeadline() is called inside applyAction and advanceGameState; bounded to MAX_ROUNDS x 3 + 3 iterations to handle requests arriving after multiple missed deadlines.

**Presence detection**

advanceGameState(state, now) marks any player whose lastSeen is more than 15 000 ms in the past as inactive. Host succession runs immediately after.

**Scoring** (applied once in enterReveal, guarded by round.scored)

- Correct vote (real definition): +3
- Vote received on your fake: +2 per vote
- Submitting nothing: no penalty

**Tie handling**

getWinners() returns every player whose score equals the highest score.

**Known gaps to be fixed in Phase 3**

- A player can re-submit a fake and silently overwrite their earlier entry.
- Fakes are only compared against the real definition; two players can submit identical fakes to each other.
- stableOrder() uses a deterministic hash, not a true random shuffle. The shuffle must be generated server-side and stored once.
- If all players become inactive, electHost leaves the previous host ID in place with no active player attached.

---

### Player-specific views (src/lib/game-view.ts)

getPlayerGameView(state, playerId) => PlayerGameView

| Phase | What the viewer receives |
|---|---|
| LOBBY or FINISHED | Room metadata and player list; no round data. |
| WRITE | Current term name and the viewer own submission if any; no real definition, no other submissions, no options. |
| VOTE | Shuffled options with id and text only; no authorPlayerId, no isReal; no other players votes. |
| REVEAL | Full options with authors and isReal; real definition; all votes; source URL. |

History contains only rounds that have been fully scored. The full internal GameState is never returned to a client.

---

### Tests (tests/unit/)

27 tests across 7 files, all passing.

| File | Tests | Coverage area |
|---|---|---|
| setup.test.ts | 1 | Vitest is wired up. |
| game-engine.test.ts | 7 | Lobby, WRITE to VOTE early advance, self-vote rejection, scoring, duplicate votes, deadline expiry, tie wins. |
| game-engine-edge-cases.test.ts | 4 | Phase enforcement, 8-player cap, non-host start rejection, PLAY_AGAIN reset. |
| game-view.test.ts | 5 | LOBBY/WRITE/VOTE/REVEAL redaction, stranger rejection. |
| player-activity.test.ts | 4 | lastSeen expiry, host succession, early-advance on last voter leaving, all-inactive fallback. |
| deadline-transition.test.ts | 3 | WRITE to VOTE to REVEAL to next-round cascade, REVEAL to FINISHED after round 5. |
| deadline-action.test.ts | 3 | Heartbeat advances an expired deadline, ADVANCE action semantics. |

---

### Project scaffold

| Area | Status |
|---|---|
| Vite + React + TypeScript app shell | Placeholder App.tsx and styles.css present |
| Netlify function stub (netlify/functions/game.ts) | Empty, not implemented |
| Supabase client (src/lib/api.ts) | Empty, not implemented |
| React pages and components | Not started |
| Content (data/ terms JSON) | Not confirmed |

---

## Storage

No persistence layer exists yet. The engine operates on in-memory GameState objects passed directly in tests. The production plan is Supabase PostgreSQL with optimistic-locking on a version column, see ADR-001.

Running environment: All tests use pure in-memory state. There is no database connection at this time.

---

## How to run

Install dependencies: npm install

Run tests: npm test

Start local dev server: npm run dev

Production build (also runs tsc): npm run build
