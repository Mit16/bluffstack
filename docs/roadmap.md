# Bluffstack Roadmap

---

## Timeline

| Day | Goal |
|---|---|
| Mon 27 Oct (done) | Engine, player views, 27 tests passing, production build clean |
| Tue 28 Oct (today) | Phase 3 engine hardening (3A-3E) |
| Wed 29 Oct | Supabase schema, Netlify Function API (phases 4-5) |
| Thu 30 Oct | React UI, two-window testing, deploy |
| Fri 31 Oct | Playtest on real phones; submit |

Treat Thu 30 as the hard deadline. Friday is buffer only.

---

## Phase 1 — Project setup (done)

- [x] Vite + React + TypeScript scaffold
- [x] Vitest configured
- [x] Netlify CLI and Functions devDependency installed
- [x] Supabase JS client installed
- [x] Zod installed
- [x] .env.example committed; .env in .gitignore

---

## Phase 2 — Pure game engine (done)

- [x] GameState, GameAction, Player, TechTerm, RoundState types defined
- [x] createRoomState()
- [x] applyAction() with all 8 action types
- [x] advanceGameState() with presence detection and host succession
- [x] advanceDeadline() — lazy, bounded, idempotent
- [x] enterVote() / enterReveal() — scoring, history, options
- [x] getPlayerGameView() redaction for WRITE, VOTE, REVEAL
- [x] getWinners() / getLeaderboard()
- [x] 27 unit tests covering scoring, ties, phases, deadlines, views

---

## Phase 3 — Engine hardening (current)

### 3A — Submission integrity (next task)

- [ ] Reject duplicate SUBMIT_FAKE from the same player in the same round
- [ ] Verify the rejected action leaves original state unchanged
- [ ] Add tests: first submit succeeds; second is rejected; original persists
- [ ] Confirm existing 27 tests still pass after the change

### 3B — Fake-answer similarity

- [ ] Compare each new fake against all previously submitted fakes, not just the real definition
- [ ] Reject near-duplicates (Jaccard >= 0.85 threshold, same normalize() function)
- [ ] Add tests: identical fakes rejected; sufficiently different fakes accepted
- [ ] Add tests: rejection does not overwrite earlier submission

### 3C — Voting-option shuffle

- [ ] Decision: record how randomness is injected (ADR-003)
- [ ] Replace stableOrder() deterministic hash with a caller-supplied shuffle
- [ ] The server generates the shuffle once and stores it in round.options
- [ ] The view layer serves the stored order; it never reshuffles
- [ ] Add tests: order is stable across multiple view calls; real and fakes all appear

### 3D — Lifecycle and deadline edge cases

- [ ] If all players become inactive, electHost must still transfer to no-one gracefully
- [ ] Host succession when the host is the last active player
- [ ] Late SUBMIT_FAKE after WRITE deadline: rejected cleanly
- [ ] Late SUBMIT_VOTE after VOTE deadline: rejected cleanly
- [ ] ADVANCE in REVEAL phase: rejected with a clear message
- [ ] Verify deadline transitions survive a rejected action (no state mutation)

### 3E — Final verification

- [ ] Full test suite passes with zero failures
- [ ] npm run build completes with no type errors
- [ ] Diff check: no unintended files changed
- [ ] Update docs/current-state.md
- [ ] Commit with a descriptive message

---

## Phase 4 — Supabase schema

- [ ] Create supabase/migrations/ directory
- [ ] Migration: rooms table (room_code PK, state JSONB, version INT, created_at)
- [ ] Apply migration to Supabase project
- [ ] StorageAdapter interface: read(roomCode), write(roomCode, state, expectedVersion)
- [ ] InMemoryStorage implementation (used in unit tests)
- [ ] SupabaseStorage implementation (used in production)
- [ ] The running implementation is logged at startup so it is always visible
- [ ] Integration test: write then read round-trips correctly
- [ ] Integration test: concurrent write with stale version is rejected

---

## Phase 5 — Netlify Function API

- [ ] Implement netlify/functions/game.ts
- [ ] Routes: POST /game (action), GET /game (poll)
- [ ] Zod schemas for all request bodies
- [ ] Player identity: UUID assigned by server on first JOIN; stored in browser localStorage
- [ ] All responses are PlayerGameView (never raw GameState)
- [ ] Poll returns a minimal unchanged response when version matches
- [ ] Server time offset returned in every response for client countdown
- [ ] Error responses: 400 (validation), 403 (rule violation), 404 (room not found), 409 (version conflict with retry hint)
- [ ] Confirmed which storage implementation is active at startup

---

## Phase 6 — React UI

- [ ] Lobby screen: room code entry, create room, player name input
- [ ] Waiting room: player list, host start button
- [ ] WRITE screen: term display, textarea, submit button, countdown
- [ ] VOTE screen: shuffled option list, one-vote selection, countdown
- [ ] REVEAL screen: highlighted real answer, author labels, score delta, leaderboard
- [ ] FINISHED screen: final leaderboard, winners, Play Again button
- [ ] Reconnect handling: poll resumes on tab focus
- [ ] Game in progress screen: shown when joining an active room
- [ ] Two-window test: normal tab + incognito tab as two players

---

## Phase 7 — Deploy and playtest

- [ ] Set environment variables in Netlify dashboard
- [ ] Set environment variables in Supabase project
- [ ] netlify deploy --prod
- [ ] Smoke test: create room, join from phone, play one round end-to-end
- [ ] Playtest with 2-3 real people on real phones
- [ ] Fix any bugs found during playtest
- [ ] Verify no credentials in browser bundle (check network tab)
- [ ] Submit with link and short writeup

---

## Out of scope

The following are explicitly excluded unless a decision is made to add them:

- User accounts or authentication
- Animations or sound
- Chat
- Spectator mode
- Similarity check more sophisticated than Jaccard word overlap
- More than 5 rounds per game
- More than 8 players per room
- WebSockets or server-sent events
