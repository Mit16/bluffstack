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

  it("increments the version once when host timeout transfers ownership", () => {
    let state = createLobby();

    // Keep the guest active while the original host times out.
    state = applyAction(
      state,
      { type: "HEARTBEAT", playerId: "guest" },
      15_000,
    );

    const advanced = advanceGameState(state, 17_000);

    expect(advanced.players.find((item) => item.id === "host")?.active).toBe(
      false,
    );
    expect(advanced.players.find((item) => item.id === "guest")?.active).toBe(
      true,
    );
    expect(advanced.hostPlayerId).toBe("guest");
    expect(advanced.version).toBe(state.version + 1);
  });

  it("clears host ownership when the last active player times out", () => {
    const terms = Array.from({ length: 5 }, (_, index) => ({
      id: `term-${index + 1}`,
      term: `Technology ${index + 1}`,
      definition: `A specialized mechanism for coordinating distributed software components and internal processing workflows, number ${index + 1}.`,
      sourceUrl: `https://example.com/terms/${index + 1}`,
    }));

    const state = createRoomState({
      roomCode: "TEST",
      host: {
        id: "host",
        name: "Host",
        joinedAt: 1_000,
        lastSeen: 1_000,
        active: true,
        score: 0,
      },
      terms,
      now: 1_000,
    });

    const nextState = advanceGameState(state, 16_001);

    expect(nextState.players[0]?.active).toBe(false);
    expect(nextState.hostPlayerId).toBeNull();

    // Advancing state must not mutate the original.
    expect(state.players[0]?.active).toBe(true);
    expect(state.hostPlayerId).toBe("host");
  });

  it("does not replace an existing host when another player reconnects", () => {
    let state = createLobby();

    // Time out the original host while keeping the guest active.
    state = applyAction(
      state,
      { type: "HEARTBEAT", playerId: "guest" },
      15_000,
    );
    state = advanceGameState(state, 17_000);

    expect(state.hostPlayerId).toBe("guest");

    // The original host returns.
    const reconnected = applyAction(
      state,
      { type: "HEARTBEAT", playerId: "host" },
      17_001,
    );

    expect(reconnected.hostPlayerId).toBe("guest");
    expect(
      reconnected.players.find((player) => player.id === "host")?.active,
    ).toBe(true);
  });

  it("increments the version when a heartbeat restores host ownership", () => {
    const state = createRoomState({
      roomCode: "TEST",
      host: player("host", 1_000),
      terms,
      now: 1_000,
    });

    const timedOut = advanceGameState(state, 16_001);

    expect(timedOut.hostPlayerId).toBeNull();

    const reconnected = applyAction(
      timedOut,
      { type: "HEARTBEAT", playerId: "host" },
      17_000,
    );

    expect(reconnected.hostPlayerId).toBe("host");
    expect(reconnected.version).toBe(timedOut.version + 1);
  });

  it("assigns a host when a player returns to a room with no host", () => {
    const state = createRoomState({
      roomCode: "TEST",
      host: player("host"),
      terms,
      now: 1_000,
    });

    const timedOut = advanceGameState(state, 16_001);

    expect(timedOut.hostPlayerId).toBeNull();
    const reconnected = applyAction(
      timedOut,
      { type: "HEARTBEAT", playerId: "host" },
      17_000,
    );

    expect(
      reconnected.players.find((player) => player.id === "host")?.active,
    ).toBe(true);
    expect(reconnected.hostPlayerId).toBe("host");
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

  it("does not increment the version when an active player's heartbeat only refreshes lastSeen", () => {
    const state = createLobby();
    const guestBefore = state.players.find((item) => item.id === "guest");

    const heartbeat = applyAction(
      state,
      { type: "HEARTBEAT", playerId: "guest" },
      1_200,
    );

    expect(
      heartbeat.players.find((item) => item.id === "guest")?.lastSeen,
    ).toBe(1_200);
    expect(heartbeat.version).toBe(state.version);
    expect(guestBefore?.active).toBe(true);
    expect(heartbeat.hostPlayerId).toBe(state.hostPlayerId);
  });

  it("increments the version when a heartbeat reactivates an inactive player", () => {
    let state = createLobby();

    state = {
      ...state,
      players: state.players.map((item) =>
        item.id === "guest" ? { ...item, active: false } : item,
      ),
    };

    const reconnected = applyAction(
      state,
      { type: "HEARTBEAT", playerId: "guest" },
      1_200,
    );

    expect(
      reconnected.players.find((item) => item.id === "guest")?.active,
    ).toBe(true);
    expect(reconnected.version).toBe(state.version + 1);
  });
});
