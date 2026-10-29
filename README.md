# Bluffstack

A Balderdash-style bluffing game for developers. Players compete to write convincing fake definitions for real, obscure tech terms. Join any game with a 4-letter room code — no account needed.

---

## How to play

1. One player creates a room and shares the 4-letter code.
2. Up to 7 more players join in the lobby.
3. The host starts the game.

Each of 5 rounds:

| Phase | What happens | Time |
|---|---|---|
| WRITE | An obscure real tech term appears. Every player secretly writes a fake definition. | 45 s |
| VOTE | All fakes plus the real definition appear shuffled and anonymous. Pick the real one. | 30 s |
| REVEAL | The real definition is highlighted. Scores update. Host advances to the next round. | 10 s |

**Scoring**

- Pick the real definition: **+3 pts**
- Someone votes for your fake: **+2 pts** per vote
- Submit nothing: no penalty

Highest score after 5 rounds wins. Ties are shared.

---

## Engineering highlights

| Concern | Solution |
|---|---|
| Server authority | Server owns clock, identity, phases, votes and scores. Client is a read-only view. |
| Concurrency | Optimistic locking on a ersion column prevents two concurrent writes from overwriting each other. |
| Lazy deadlines | No background scheduler. Phases advance when the next HTTP request arrives after a deadline. |
| Per-player redaction | API returns a different response per player — authors hidden in VOTE, real definition hidden in WRITE. |
| Presence detection | lastSeen updated on every poll. Players unseen for 15 s are marked inactive; host auto-transfers. |

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 8, TypeScript 5 |
| Backend | Netlify Functions (single serverless function) |
| Database | Supabase PostgreSQL |
| Validation | Zod |
| Tests | Vitest — 86 unit tests |

---

## Development

**Requirements:** Node.js 20+

```bash
npm install

# Run all tests
npm test

# Local dev server (requires Netlify CLI for functions)
npm run dev

# Production build + type-check
npm run build
```

Copy .env.example to .env and fill in your values:

```
SUPABASE_URL=https://your-project.supabase.co 
SUPABASE_SECRET_KEY=your-service-role-key 
PLAYER_TOKEN_SECRET=a-random-string-of-at-least-32-chars 
```

The service role key is server-only. It is never sent to the browser.

---

## Deployment (Netlify)

1. Push this repo to GitHub.
2. Connect the repo in the Netlify dashboard.
3. Set the three environment variables above in **Site settings > Environment variables**.
4. Deploy. Netlify reads 
etlify.toml for build command and function directory automatically.

---

## Documentation

| File | Purpose |
|---|---|
| [docs/current-state.md](docs/current-state.md) | What is and is not implemented right now |
| [docs/architecture.md](docs/architecture.md) | Layer diagram, state machine, privacy rules |
| [docs/roadmap.md](docs/roadmap.md) | Phased plan from engine to deploy |
| [docs/decisions/ADR-001-database.md](docs/decisions/ADR-001-database.md) | Why Supabase over Netlify Blobs |
| [docs/decisions/ADR-002-game-state.md](docs/decisions/ADR-002-game-state.md) | Pure-function engine design |
