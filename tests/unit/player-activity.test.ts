import { describe, expect, it } from "vitest";
import {
  advanceGameState,
  applyAction,
  createRoomState,
} from "../../src/lib/game-engine";
import type { Player, TechTerm } from "../../src/types/game";

const HEARTBEAT_TIMEOUT_MS = 15_000;

const terms: TechTerm[] = Array.from({ length: 5 }, (_, index) => ({
  id: `term-${index + 1}`,
  term: `Technology ${index + 1}`,
  definition: `A technical mechanism for coordinating distributed software components and internal processing workflows, number ${index + 1}.`,
  sourceUrl: `https://example.com/terms/${index + 1}`,
}));

function player(id: string, joinedAt = 0): Player {
  return {
    id,
    name: id,
    joinedAt,
    lastSeen: joinedAt,
    active: true,
    score: 0,
  };
}

function createLobby() {
  let state = createRoomState({
    roomCode: "LIVE",
    host: player("host", 1_000),
    terms,
    now: 1_000,
  });

  state = applyAction(
    state,
    { type: "JOIN", player: player("guest", 1_100) },
    1_100,
  );

  return state;
}

describe("player activity", () => {
  it("marks a player inactive after the heartbeat timeout", () => {
    const state = createLobby();
    const now = 20_000;

    const advanced = advanceGameState(state, now);

    expect(advanced.players.find((item) => item.id === "host")?.active).toBe(
      false,
    );
    expect(advanced.players.find((item) => item.id === "guest")?.active).toBe(
      false,
    );
  });

  it("keeps a player active at the exact timeout boundary", () => {
    const state = createLobby();
    const now = 1_000 + HEARTBEAT_TIMEOUT_MS;

    const advanced = advanceGameState(state, now);

    expect(advanced.players.find((item) => item.id === "host")?.active).toBe(
      true,
    );
  });

  it("elects an active player when the host times out", () => {
    let state = createLobby();

    state = applyAction(
      state,
      { type: "HEARTBEAT", playerId: "guest" },
      15_000,
    );

    const advanced = advanceGameState(state, 17_000);

    expect(advanced.players.find((item) => item.id === "host")?.active).toBe(
      false,
    );
    expect(advanced.hostPlayerId).toBe("guest");
  });

  it("does not allow an inactive player to submit a fake definition", () => {
    let state = createLobby();

    state = applyAction(state, { type: "HEARTBEAT", playerId: "host" }, 15_000);

    state = applyAction(
      state,
      { type: "START_GAME", playerId: "host" },
      15_001,
    );

    state = {
      ...state,
      players: state.players.map((item) =>
        item.id === "guest" ? { ...item, active: false } : item,
      ),
    };

    expect(() =>
      applyAction(
        state,
        {
          type: "SUBMIT_FAKE",
          playerId: "guest",
          roundNumber: state.roundNumber,
          text: "A deliberately fabricated technical definition.",
        },
        15_002,
      ),
    ).toThrow();
  });
});
