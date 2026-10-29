# Bluffstack - Current State

_Last updated: 2026-10-29_

---

## Phase summary

| Phase | Status |
| --- | --- |
| 1 - Project setup | Complete |
| 2 - Pure game engine | Complete |
| 3 - Engine hardening and security invariants | Complete |
| 4 - Supabase schema and persistence layer | Implemented; migration applied to hosted database |
| 5 - Netlify Function API | Implemented locally; integration verification pending |
| 6 - React multiplayer UI | Pending |
| 7 - Deployment and playtesting | Pending |

**Current milestone:** Connect the server-authoritative game engine to persistent storage through the Netlify Function API, then verify the integration before starting the multiplayer UI.

## Implemented architecture

- **Frontend:** React, Vite, TypeScript.
- **Backend:** Netlify Functions.
- **Database:** Supabase PostgreSQL.
- **Validation:** Zod.
- **Testing:** Vitest.
- **Authentication:** Signed player tokens using HMAC-SHA-256.
- **Game logic:** Pure TypeScript state machine.
- **Vote-option ordering:** Server-side cryptographically secure Fisher-Yates shuffle.
- **Client synchronization:** Planned polling every two seconds with server-time offset handling.

The game engine remains independent of database and HTTP concerns. Production API mutations use the persistence layer rather than relying on an in-memory room store.

---

## Game rules and engine

Primary implementation: `src/lib/game-engine.ts`

The engine owns game state transitions and scoring. The server must never trust client-provided scores, deadlines, roles, or phase transitions.

### Game rules

- Room size: 2-8 players.
- Game length: 5 rounds.
- WRITE phase: 45 seconds.
- VOTE phase: 30 seconds.
- REVEAL phase: 10 seconds.
- Correct vote for the real definition: +3 points.
- Each vote received by a player's fake definition: +2 points.
- No submission: no penalty.
- Tied highest scores share the win.
- Only the host can start a game or initiate another game after completion.
- New players may join only during LOBBY or FINISHED.
- The host is selected from eligible active players when succession is required.

### Engine safeguards

- Fake submissions must contain 20-500 characters.
- Duplicate and near-identical fake submissions are rejected.
- Similarity checks cover the real definition and other submitted fakes.
- Voting rejects duplicate votes and votes for a player's own fake.
- Deadlines are advanced lazily when requests arrive.
- Phase transitions are bounded to avoid unbounded deadline-processing loops.
- Inactive players are detected when their last-seen time is more than 15 seconds old.
- Host succession and player reconnection are covered by tests.
- Routine heartbeats avoid unnecessary public-version increments.
- Secure vote-option ordering is injectable into the engine and supplied by the API when relevant transitions generate options.

### Player-specific views

Primary implementation: `src/lib/game-view.ts`

The API returns a player's authorized view rather than exposing raw internal game state.

| Phase | Visibility |
| --- | --- |
| LOBBY | Room metadata and player list |
| WRITE | Current term and the viewer's own submission; no real definition or other submissions |
| VOTE | Option IDs and text; no authors, real/fake flags, or other players' votes |
| REVEAL | Revealed options, authors, real/fake status, votes, definition, and source |
| FINISHED | Final room and leaderboard information |

Option ordering is generated and stored server-side so all players see consistent options.

---

## Supabase persistence

Relevant files:

- `supabase/migrations/20261028000000_create_game_rooms.sql`
- `netlify/functions/_shared/database.types.ts`
- `netlify/functions/_shared/supabase.ts`
- `netlify/functions/_shared/room-store.ts`

### Implemented

- PostgreSQL `public.game_rooms` table with room code, JSONB game state, revision, and timestamps.
- Row-level security enabled.
- Database RPC `create_game_room` for room creation.
- Database RPC `save_game_room_state` for revision-checked state updates.
- Optimistic concurrency handling to prevent silently overwriting a newer room state.
- Server-side Supabase client configuration.
- State validation when loading persisted rooms.
- Explicit handling for room collisions, missing rooms, and save conflicts.

### Hosted database status

The migration was applied to the linked Supabase project. The migration list was checked, and the table, both RPCs, RLS status, and intended role permissions were verified through read-only SQL checks.

The intended database access path is through the server-side Supabase client using the secret key. Database credentials must never be exposed to the browser.

**Verification boundary:** Schema and permission checks have been performed against the hosted database. This does not yet establish that complete concurrent multiplayer requests work end-to-end through a deployed Netlify Function.

---

## Netlify Function API

Primary entry point: `netlify/functions/game.ts`

Shared implementation:

- `netlify/functions/_shared/game-api.ts`
- `netlify/functions/_shared/player-token.ts`
- `netlify/functions/_shared/secure-shuffle.ts`
- `netlify/functions/_shared/room-store.ts`
- `netlify/functions/_shared/supabase.ts`

### Implemented

- Request validation and HTTP method enforcement.
- Room creation and joining.
- Signed player-token creation and verification.
- Player identity verification for game actions and reconnections.
- Server-authoritative game mutations.
- Lazy deadline advancement.
- Player-specific response redaction.
- Secure vote-option ordering.
- Persistence through Supabase RPCs.
- Optimistic revision handling.
- Routine heartbeat write throttling.
- Error handling for invalid requests, game-rule violations, missing rooms, and unexpected failures.
- A bounded retry for room-code collisions.

Player tokens use HMAC-SHA-256 and expire after 30 days. The signing secret must contain at least 32 characters.

### API verification status

Unit tests cover room creation, joining, tokens, game actions, validation, and relevant failure cases.

The current test suite passes locally. The API has not yet been fully verified through a deployed Netlify endpoint against the hosted Supabase database.

---

## Tech-term catalog

File: `data/techTerms.json`

- Contains 25 tech terms.
- Entries include IDs, term names, definitions, and HTTPS source URLs.
- Unit tests check the catalog structure, required fields, and uniqueness constraints.

These tests establish structural validity. They do not independently establish the factual accuracy or quality of every definition and source.

---

## Frontend status

The React/Vite application shell is present.

The home screen remains a placeholder. The full multiplayer experience is not yet connected to the API.

Remaining frontend work includes:

- Create-room and join-room flows.
- Player identity and token persistence on the client.
- Lobby and host controls.
- WRITE, VOTE, and REVEAL screens.
- Polling and server-adjusted countdowns.
- Results and leaderboard screens.
- Loading, reconnection, and error states.
- End-to-end multiplayer verification.

The browser must never receive the Supabase secret key or the internal, unredacted game state.

---

## Tests and build

Latest verified local result: **75 tests passing across 11 test files.**

| Verification | Result |
| --- | --- |
| `npm test` | 75 passed, 11 files passed |
| `npm run build` | Passed; TypeScript check and Vite production build succeeded |
| `git diff --check` | No whitespace errors; LF-to-CRLF warnings remain for `.env.example` and `.gitignore` |

The invalid-secret API test intentionally exercises an error path, which produces expected stderr output while the test passes.

Tests run locally do not replace integration tests against the hosted database or deployed function.

---

## Environment configuration

Local environment variables belong in the ignored `.env` file. Use `.env.example` as the template.

Required server-side variables:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `PLAYER_TOKEN_SECRET`

Configure the same variables in Netlify's environment settings before deploying the API.

Never commit `.env`, paste secret values into issue reports, or expose the Supabase secret key in frontend code.

The Supabase CLI is linked to the hosted project. Running `supabase status` for local services may require Docker or Podman; hosted database migrations do not require running a local Supabase stack.

---

## Next steps

1. Review the pending API, persistence, migration, catalog, and test changes.
2. Verify the rejected-join error path and the full local test/build results.
3. Confirm the documentation matches the implementation.
4. Stage and inspect a focused API milestone commit.
5. Configure the server-side environment and perform a controlled API integration test against hosted Supabase.
6. Build the React multiplayer UI against the verified API.
7. Deploy and playtest with multiple players before creating a release tag.

## How to run

Install dependencies:

`npm install`

Run unit tests:

`npm test`

Start the frontend development server:

`npm run dev`

Run the production build and TypeScript check:

`npm run build`

Check whitespace and patch formatting:

`git diff --check`
