import { describe, expect, it } from "vitest";
import {
  advanceGameState,
  applyAction,
  createRoomState,
} from "../../src/lib/game-engine";
import type { Player, TechTerm } from "../../src/types/game";

const terms: TechTerm[] = Array.from({ length: 5 }, (_, index) => ({
  id: `term-${index + 1}`,
  term: `Technology ${index + 1}`,
  definition: `A specialized mechanism for coordinating distributed software components and internal processing workflows, number ${index + 1}.`,
  sourceUrl: `https://example.com/terms/${index + 1}`,
}));

function player(id: string): Player {
  return {
    id,
    name: id,
    joinedAt: 0,
    lastSeen: 0,
    active: true,
    score: 0,
  };
}

function startRoom() {
  let state = createRoomState({
    roomCode: "TIME",
    host: player("host"),
    terms,
    now: 1_000,
  });

  state = applyAction(state, { type: "JOIN", player: player("guest") }, 1_100);

  return applyAction(state, { type: "START_GAME", playerId: "host" }, 2_000);
}

describe("deadline transitions", () => {
  it("persists the phase transition when WRITE expires", () => {
    const state = startRoom();
    const deadline = state.phaseDeadline!;

    const advanced = advanceGameState(state, deadline);

    expect(advanced.phase).toBe("VOTE");
    expect(advanced.phaseDeadline).toBe(deadline + 30_000);
    expect(advanced.version).toBe(state.version + 1);

    // The original state remains unchanged.
    expect(state.phase).toBe("WRITE");
  });

  it("does not increment the version when no transition is due", () => {
    const state = startRoom();
    const checkTime = state.phaseDeadline! - 1;

    // Keep the players' heartbeats fresh for this deadline-only test.
    const freshState = {
      ...state,
      players: state.players.map((item) => ({
        ...item,
        lastSeen: checkTime,
      })),
    };

    const unchanged = advanceGameState(freshState, checkTime);

    expect(unchanged.phase).toBe("WRITE");
    expect(unchanged.version).toBe(freshState.version);
  });

  it("does not advance the same deadline twice", () => {
    const state = startRoom();
    const deadline = state.phaseDeadline!;

    const once = advanceGameState(state, deadline);
    const twice = advanceGameState(once, deadline);

    expect(once.phase).toBe("VOTE");
    expect(twice.phase).toBe("VOTE");
    expect(twice.version).toBe(once.version);
  });
});
