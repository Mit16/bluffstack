import { describe, expect, it } from "vitest";
import { applyAction, createRoomState } from "../../src/lib/game-engine";
import type { Player, TechTerm } from "../../src/types/game";

const terms: TechTerm[] = Array.from({ length: 5 }, (_, index) => ({
  id: `term-${index + 1}`,
  term: `Technology ${index + 1}`,
  definition: `A specialized mechanism for coordinating distributed software components and their internal processing workflows, number ${index + 1}.`,
  sourceUrl: `https://example.com/terms/${index + 1}`,
}));

function makePlayer(id: string, name = id): Player {
  return {
    id,
    name,
    joinedAt: 0,
    lastSeen: 0,
    active: true,
    score: 0,
  };
}

function makeRoom() {
  return createRoomState({
    roomCode: "TEST",
    host: makePlayer("host", "Host"),
    terms,
    now: 1_000,
  });
}

function joinPlayer(
  state: ReturnType<typeof makeRoom>,
  id: string,
  now: number,
) {
  return applyAction(state, { type: "JOIN", player: makePlayer(id) }, now);
}

describe("game engine edge cases", () => {
  it("rejects a ninth player", () => {
    let state = makeRoom();

    // The host plus seven more players fills all eight slots.
    for (let number = 2; number <= 8; number += 1) {
      state = joinPlayer(state, `player-${number}`, 1_000 + number);
    }

    expect(state.players.filter((player) => player.active)).toHaveLength(8);

    expect(() =>
      applyAction(
        state,
        { type: "JOIN", player: makePlayer("player-9") },
        2_000,
      ),
    ).toThrow("Room is full.");
  });

  it("elects the next eligible player when the host leaves", () => {
    let state = makeRoom();
    state = joinPlayer(state, "player-2", 1_100);
    state = joinPlayer(state, "player-3", 1_200);

    state = applyAction(state, { type: "LEAVE", playerId: "host" }, 1_300);

    expect(state.players.find((player) => player.id === "host")?.active).toBe(
      false,
    );
    expect(state.hostPlayerId).toBe("player-2");
  });

  it("clears host ownership when the last active player leaves", () => {
    const state = makeRoom();

    const nextState = applyAction(
      state,
      { type: "LEAVE", playerId: "host" },
      1_300,
    );

    expect(nextState.players.every((player) => !player.active)).toBe(true);
    expect(nextState.hostPlayerId).toBeNull();

    // The original state must remain unchanged.
    expect(state.hostPlayerId).toBe("host");
    expect(state.players[0]?.active).toBe(true);
  });

  it("advances WRITE to VOTE when a valid request arrives at the deadline", () => {
    let state = makeRoom();
    state = joinPlayer(state, "player-2", 1_100);
    state = applyAction(state, { type: "START_GAME", playerId: "host" }, 2_000);

    expect(state.phase).toBe("WRITE");
    expect(state.phaseDeadline).not.toBeNull();

    state = applyAction(
      state,
      { type: "HEARTBEAT", playerId: "host" },
      state.phaseDeadline!,
    );

    expect(state.phase).toBe("VOTE");
  });

  it("does not mutate the original state when an action is rejected", () => {
    const state = makeRoom();
    const originalState = structuredClone(state);

    expect(() =>
      applyAction(
        state,
        { type: "START_GAME", playerId: "not-a-player" },
        2_000,
      ),
    ).toThrow();

    expect(state).toEqual(originalState);
  });
});
