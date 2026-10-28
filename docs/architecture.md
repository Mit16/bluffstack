# Bluffstack Architecture

---

## Overview

Bluffstack is a serverless, multiplayer bluffing game. The architecture
prioritises a correct, auditable state machine and avoids infrastructure
complexity that would not survive a 4-day hackathon timeline.

---

## Layer diagram

`
Browser (React + Vite)
   |  polls every 2 s
   v
Netlify Functions  (single function: game.ts)
   |  read / write with optimistic locking
   v
Supabase PostgreSQL  (one rooms table)
`

---

## Frontend

- **Framework:** React 19 + Vite 8 + TypeScript 5
- **Style:** Single-page app, mobile-first, plain CSS (src/styles.css)
- **State:** Server is the source of truth. The client holds only the
  current PlayerGameView returned from the last poll.
- **Polling:** Every 2 seconds. The request carries the current version
  number. If the server version matches, the API returns a minimal
  unchanged signal so the client can skip a re-render.
- **Countdown timers:** The client computes countdown from
  phaseDeadline (absolute UTC ms) minus server-time offset. It does
  not rely on a local clock alone.

---

## Backend

A single Netlify Function at netlify/functions/game.ts handles every
action and poll. It:

1. Reads the room row from Supabase.
2. Calls advanceGameState(state, now) to apply any expired deadlines.
3. Dispatches the player action via applyAction(state, action, now).
4. Writes the new state back with an optimistic-locking check on version.
5. Returns a per-player redacted view via getPlayerGameView().

The function never returns the raw GameState to the browser.

### Idempotency

Phase transitions are idempotent. An ADVANCE request for round 3 WRITE
is a no-op if the state is already past that point. Concurrent advance
attempts from multiple polling clients are safe.

### Lazy deadlines

There is no background scheduler. Phases advance when the next request
arrives after the deadline has passed. advanceDeadline() is bounded so
it handles requests that arrive after multiple consecutive deadlines.

---

## State machine

`
LOBBY -> WRITE -> VOTE -> REVEAL -> WRITE (repeat) -> FINISHED
                  ^                    |
                  |___ (next round) ___|
`

State transitions are driven by:
- All active players completing an action (early advance)
- A timer deadline expiring (lazy advance on next request)
- A player leaving that makes all remaining players done

### GameState shape (src/types/game.ts)

- roomCode: 4-char uppercase alphanumeric
- version: integer incremented on every successful write
- phase: LOBBY | WRITE | VOTE | REVEAL | FINISHED
- hostPlayerId: id of the current host
- players: Player[] with id, name, score, lastSeen, active
- terms: TechTerm[] (25 pre-loaded terms)
- roundNumber: 1-5
- phaseDeadline: absolute UTC ms or null
- currentRound: RoundState or null
- history: RoundResult[] (revealed rounds only)

---

## Database

See ADR-001 for the full decision record.

- **Engine:** Supabase PostgreSQL
- **Table:** rooms (one row per room)
- **Optimistic locking:** The version column is compared on every
  UPDATE. A concurrent write that arrives with a stale version is
  rejected; the caller retries with a fresh read.
- **Schema changes:** Managed via Supabase migrations (supabase/migrations/).
  Manual edits to the database schema are not allowed.

---

## Game engine

See ADR-002 for the design rationale.

The engine is a set of pure functions in src/lib/game-engine.ts:

- createRoomState(input) => GameState
- applyAction(state, action, now) => GameState
- advanceGameState(state, now) => GameState
- getLeaderboard(state) => Player[]
- getWinners(state) => Player[]

No side effects. No I/O. No randomness (random shuffle is injected by
the caller). Tests use a fake clock.

---

## Privacy and security

- The server never returns fake authors during VOTE.
- The server never returns the real definition during WRITE.
- Shuffle order is computed server-side and stored; it is never
  recomputed from the client.
- Player identity is server-assigned (UUID generated at join time).
  Clients cannot supply their own IDs.
- All API inputs are validated with Zod before reaching the engine.
- The Supabase service key is never exposed to browser code.

---

## Content

25 tech terms are stored as static JSON in data/terms.json. Each term
has an id, term name, real definition, and a sourceUrl pointing to the
authoritative reference. Definitions were verified against primary
sources; ChatGPT-generated text was checked and corrected.

---

## Testing strategy

- **Unit tests (Vitest):** Pure engine functions tested with a fake
  clock. No network, no database, no filesystem.
- **Integration tests:** Planned for the API layer (Phase 5).
- **E2E tests:** Planned for two-window playtest simulation (Phase 7).
- **Browser tests:** Added when UI behaviour needs coverage.

---

## Deployment

- **Host:** Netlify (Functions + static site)
- **Database:** Supabase (hosted PostgreSQL)
- **Build command:** npm run build
- **Publish directory:** dist/
- **Environment variables required:**
  - SUPABASE_URL
  - SUPABASE_SERVICE_ROLE_KEY (server only, never in browser bundle)
