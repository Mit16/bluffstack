import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createRoomState } from "../../src/lib/game-engine";
import type { GameState, TechTerm } from "../../src/types/game";
import {
  createRoom,
  loadRoom,
  saveRoomState,
  RoomAlreadyExistsError,
} from "../../netlify/functions/_shared/room-store";
import { getSupabaseAdmin } from "../../netlify/functions/_shared/supabase";

const enabled = process.env.RUN_SUPABASE_INTEGRATION === "true";
const terms: TechTerm[] = Array.from({ length: 5 }, (_, i) => ({
  id: `integration-term-${i + 1}`,
  term: `Integration Technology ${i + 1}`,
  definition: `Test definition ${i + 1}.`,
  sourceUrl: "https://example.com/integration-test",
}));

let ownedRoomCode: string | undefined;

async function createDisposableRoom() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const roomCode =
      `T${randomBytes(3).toString("hex").slice(0, 3).toUpperCase()}`;

    const now = Date.now();
    const state = createRoomState({
      roomCode,
      host: {
        id: "integration-host",
        name: "Integration Host",
        joinedAt: now,
        lastSeen: now,
        active: true,
        score: 0,
      },
      terms,
      now,
    });

    try {
      const room = await createRoom(state);
      // Record ownership only after creation succeeds. Never clean up
      // a room that existed before this test.
      ownedRoomCode = roomCode;
      return room;
    } catch (error) {
      if (error instanceof RoomAlreadyExistsError) {
        continue;
      }
      throw error;
    }
  }

  throw new Error("Could not allocate a disposable integration room.");
}

function competingState(
  original: GameState,
  marker: "A" | "B",
): GameState {
  const state = structuredClone(original);
  const host = state.players[0];

  if (!host) {
    throw new Error("Integration room has no host.");
  }

  host.name = `Integration Winner ${marker}`;
  host.lastSeen += marker === "A" ? 1 : 2;

  return state;
}

afterEach(async () => {
  if (!ownedRoomCode) return;

  const roomCode = ownedRoomCode;
  ownedRoomCode = undefined;

  const { error } = await getSupabaseAdmin()
    .from("game_rooms")
    .delete()
    .eq("room_code", roomCode);

  if (error) {
    throw new Error(
      `Failed to clean up integration room ${roomCode}: ${error.message}`,
    );
  }
});

describe.skipIf(!enabled)("Supabase concurrency integration", () => {
  it("allows exactly one competing write for the same revision", async () => {
    const initial = await createDisposableRoom();
    const stateA = competingState(initial.state, "A");
    const stateB = competingState(initial.state, "B");

    const results = await Promise.all([
      saveRoomState(initial.state.roomCode, initial.revision, stateA),
      saveRoomState(initial.state.roomCode, initial.revision, stateB),
    ]);

    expect(results.filter((result) => result.status === "saved")).toHaveLength(1);
    expect(results.filter((result) => result.status === "conflict")).toHaveLength(1);

    const winner = results.find((result) => result.status === "saved");

    if (!winner || winner.status !== "saved") {
      throw new Error("Expected exactly one successful database write.");
    }

    const persisted = await loadRoom(initial.state.roomCode);

    expect(persisted.revision).toBe(initial.revision + 1);
    expect(persisted.state).toEqual(winner.room.state);
    expect(["Integration Winner A", "Integration Winner B"]).toContain(
      persisted.state.players[0]?.name,
    );
  });
});
