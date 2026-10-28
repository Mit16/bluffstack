# Bluffstack

A Balderdash-style bluffing game for developers. Players compete to write
convincing fake definitions for real, obscure tech terms. Join any game with
a 4-letter room code. No account needed.

---

## How to play

1. One player creates a room and shares the 4-letter code.
2. Up to 8 players join in the lobby.
3. The host starts the game.

Each round:

- **WRITE (45 s):** An obscure real tech term appears. Every player secretly
  types a fake definition that sounds plausible.
- **VOTE (30 s):** All fakes plus the real definition appear shuffled and
  anonymous. Pick the one you think is real. You cannot vote for your own fake.
- **REVEAL (10 s):** The real definition is highlighted. Scores update. Repeat
  for 5 rounds.

**Scoring**

- Pick the real definition: +3 points
- Someone votes for your fake: +2 points per vote
- Submit nothing: no penalty

Highest score after 5 rounds wins. Ties are shared wins.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 8, TypeScript 5 |
| Backend | Netlify Functions (single function) |
| Database | Supabase PostgreSQL |
| Validation | Zod |
| Tests | Vitest |

The interesting engineering here is:

- **Server-authoritative state machine** — the server owns identity, phases,
  deadlines, votes and scores. The client is a thin view layer.
- **Optimistic locking** — every write carries a version number. A stale write
  is rejected and retried, preventing two players from overwriting each other.
- **Lazy deadlines** — there is no background scheduler. Phases advance when
  the next request arrives after a deadline expires.
- **Per-player redaction** — the API returns a different response per player.
  Authors are hidden during VOTE; the real definition is hidden during WRITE.

---

## Development

Requirements: Node.js 20+, npm

`
npm install
npm test       # 27 unit tests
npm run dev    # local dev server at http://localhost:5173
npm run build  # type-check + production bundle
`

Environment variables (copy .env.example to .env):

`
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
`

The service role key is server-only. It must never appear in the browser bundle.

---

## Documentation

- docs/current-state.md — what is and is not implemented today
- docs/architecture.md — full layer diagram and design notes
- docs/roadmap.md — phased plan from engine to deploy
- docs/decisions/ — architecture decision records

---

## Project status

Engine and player views are complete with 27 passing tests. The API layer,
database schema, and UI are in progress. See docs/current-state.md for the
current phase and known gaps.
