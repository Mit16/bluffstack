# ADR-001: Database — Supabase PostgreSQL

**Status:** Accepted
**Date:** 2026-10-27

---

## Context

Bluffstack needs shared, persistent game state that survives across serverless
function invocations. Multiple clients can trigger writes concurrently (up to 8
players polling every 2 seconds, any of whom can submit an action). The storage
solution must prevent two concurrent writes from silently overwriting each other.

The brief specifies Netlify as the deployment platform. Netlify Blobs was the
first candidate, but its local development story is unreliable: the ChatGPT
sandbox and the Netlify Dev CLI both mock Blobs silently, making it impossible
to know during development whether real persistence is in use. Discovering this
on deploy day was identified as a high-risk failure mode.

---

## Decision

Use **Supabase PostgreSQL** as the single source of truth for game state.

- One table: rooms
- Columns: room_code (PK), state (JSONB), version (INTEGER), created_at (TIMESTAMPTZ)
- Concurrency control: optimistic locking on the version column
  - Read the row, record the version
  - Apply the action in memory
  - UPDATE WHERE room_code = ? AND version = ?
  - If 0 rows updated, a concurrent write won the race; retry with a fresh read

---

## Consequences

**Good**

- PostgreSQL is a real database. Writes are durable. There is no silent
  in-memory fallback in production.
- Optimistic locking is well-understood and easy to test.
- The Supabase JS client works identically in local tests and production once
  environment variables are set.
- Supabase provides a SQL editor and table viewer, which helps debugging.

**Acceptable trade-offs**

- One extra hosted service to configure. This is a one-time step.
- JSONB means the entire game state is one opaque blob. Querying inside it is
  possible but not needed for this game.
- The version column must be incremented atomically. This is enforced by the
  UPDATE WHERE clause, not by application logic alone.

**Rejected alternatives**

- Netlify Blobs: silent local mock creates a deploy-day trap.
- In-memory storage only: violates the no-silent-substitution constraint.
- Redis: unnecessary infrastructure for a 4-day project.

---

## Storage interface

A StorageAdapter interface is defined so tests can use InMemoryStorage without
a real database connection, and production uses SupabaseStorage. The running
implementation must log which adapter is active at startup so the engineer
always knows which one is in use.

---

## Schema migration

All schema changes are applied via Supabase migrations in supabase/migrations/.
Manual edits to the database are not allowed. The migration for the rooms table
is the first migration to be written in Phase 4.
