# Bluffstack: AI Coding Agent Instructions

## Project goal

Build a mobile-first multiplayer bluffing game for 2–8 players. Players join using a four-character room code without creating an account.

## Architecture

- Frontend: React, Vite, TypeScript.
- API: Netlify Functions.
- Database: Supabase PostgreSQL.
- Validation: Zod.
- Testing: Vitest, with browser tests added when appropriate.
- Live updates: polling every two seconds.
- No WebSockets, Redis, separate Express server, or unnecessary infrastructure.

## Core game rules

- Five rounds.
- WRITE: 45 seconds.
- VOTE: 30 seconds.
- REVEAL: 10 seconds.
- Correct real-definition vote: +3 points.
- Each vote received by a fake: +2 points for its author.
- No fake submitted: no fake entry and no penalty.
- Minimum two players, maximum eight.
- Joining is allowed only in LOBBY or FINISHED.
- The earliest-joined eligible active player becomes host when host succession is needed.
- Ties result in shared wins.

## Engineering constraints

1. The server is authoritative for identity, phases, deadlines, votes and scores.
2. Never trust client-supplied scores, deadlines, player roles or phase transitions.
3. Never return fake authors during VOTE or the real definition during WRITE.
4. Never expose database service credentials to browser code.
5. Implement game rules in a pure, testable TypeScript engine.
6. Use PostgreSQL transactions and atomic database operations where shared state is mutated.
7. Validate API inputs and authorize every player action.
8. Make duplicate requests and phase-advance attempts safe.
9. Use database migrations for schema changes. Do not rely on undocumented manual database edits.
10. Do not silently substitute in-memory storage for production persistence.
11. Keep changes small and focused. Do not rewrite working modules to fix an isolated bug.
12. Add or update tests whenever behavior changes.

## Working protocol

Before changing code:
- Read this file and docs/current-state.md.
- Check docs/architecture.md and relevant decision records.
- Inspect the existing implementation before proposing replacements.

After changing code:
- Run the relevant tests and build.
- Report the files changed, commands executed, results, and known limitations.
- Update docs/current-state.md when implementation status or architecture changes.
- Never claim that a deployment, integration test, or external service has been verified unless it actually has.

## Scope control

Prioritize a correct, deployable core loop. Do not add accounts, animations, sound, chat, or unrelated features without an explicit decision.