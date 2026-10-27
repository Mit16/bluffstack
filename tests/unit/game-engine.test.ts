import { describe, expect, it } from "vitest";
import {
  applyAction,
  createRoomState,
  getWinners,
} from "../../src/lib/game-engine";
import type { GameState, Player, TechTerm } from "../../src/types/game";

const terms: TechTerm[] = Array.from({ length: 5 }, (_, index) => ({
  id: `term-${index + 1}`,
  term: `Tech term ${index + 1}`,
  definition: `The official definition for this technical concept number ${index + 1}.`,
  sourceUrl: `https://example.com/terms/${index + 1}`,
}));

const host: Player = {
  id: "p1",
  name: "Alice",
  joinedAt: 1000,
  lastSeen: 1000,
  active: true,
  score: 0,
};

const guest: Player = {
  id: "p2",
  name: "Bob",
  joinedAt: 1001,
  lastSeen: 1001,
  active: true,
  score: 0,
};

function createStartedGame(): GameState {
  let state = createRoomState({
    roomCode: "ABCD",
    host,
    terms,
    now: 1000,
  });

  state = applyAction(state, { type: "JOIN", player: guest }, 1001);
  state = applyAction(state, { type: "START_GAME", playerId: "p1" }, 2000);

  return state;
}

function submitBothFakes(state: GameState): GameState {
  let next = applyAction(
    state,
    {
      type: "SUBMIT_FAKE",
      playerId: "p1",
      roundNumber: 1,
      text: "A distributed compiler protocol that coordinates independent execution nodes.",
    },
    2100,
  );

  next = applyAction(
    next,
    {
      type: "SUBMIT_FAKE",
      playerId: "p2",
      roundNumber: 1,
      text: "A memory allocation technique for asynchronously scheduled computation graphs.",
    },
    2200,
  );

  return next;
}

describe("Bluffstack game engine", () => {
  it("creates a lobby and requires two players to start", () => {
    const state = createRoomState({
      roomCode: "ABCD",
      host,
      terms,
      now: 1000,
    });

    expect(state.phase).toBe("LOBBY");

    expect(() =>
      applyAction(state, { type: "START_GAME", playerId: "p1" }, 2000),
    ).toThrow(/at least two/i);
  });

  it("starts WRITE and advances when every active player submits", () => {
    const started = createStartedGame();

    expect(started.phase).toBe("WRITE");
    expect(started.phaseDeadline).toBe(47_000);

    const state = submitBothFakes(started);

    expect(state.phase).toBe("VOTE");
    expect(state.currentRound?.options).toHaveLength(3);
  });

  it("rejects a player's attempt to vote for their own fake", () => {
    const state = submitBothFakes(createStartedGame());
    const ownFake = state.currentRound!.options.find(
      (option) => option.authorPlayerId === "p1",
    )!;

    expect(() =>
      applyAction(
        state,
        {
          type: "SUBMIT_VOTE",
          playerId: "p1",
          roundNumber: 1,
          optionId: ownFake.id,
        },
        2300,
      ),
    ).toThrow(/own fake/i);
  });

  it("scores correct guesses and successful fakes exactly once", () => {
    let state = submitBothFakes(createStartedGame());

    const realOption = state.currentRound!.options.find(
      (option) => option.isReal,
    )!;

    const aliceFake = state.currentRound!.options.find(
      (option) => option.authorPlayerId === "p1",
    )!;

    state = applyAction(
      state,
      {
        type: "SUBMIT_VOTE",
        playerId: "p1",
        roundNumber: 1,
        optionId: realOption.id,
      },
      2300,
    );

    state = applyAction(
      state,
      {
        type: "SUBMIT_VOTE",
        playerId: "p2",
        roundNumber: 1,
        optionId: aliceFake.id,
      },
      2400,
    );

    expect(state.phase).toBe("REVEAL");
    expect(state.players.find((p) => p.id === "p1")?.score).toBe(5);
    expect(state.players.find((p) => p.id === "p2")?.score).toBe(0);
    expect(state.history).toHaveLength(1);
  });

  it("rejects duplicate votes", () => {
    let state = submitBothFakes(createStartedGame());

    const realOption = state.currentRound!.options.find(
      (option) => option.isReal,
    )!;

    state = applyAction(
      state,
      {
        type: "SUBMIT_VOTE",
        playerId: "p1",
        roundNumber: 1,
        optionId: realOption.id,
      },
      2300,
    );

    expect(() =>
      applyAction(
        state,
        {
          type: "SUBMIT_VOTE",
          playerId: "p1",
          roundNumber: 1,
          optionId: realOption.id,
        },
        2350,
      ),
    ).toThrow(/already voted/i);
  });

  it("advances a phase when its deadline expires", () => {
    const started = createStartedGame();

    const state = applyAction(
      started,
      { type: "HEARTBEAT", playerId: "p1" },
      47_000,
    );

    expect(state.phase).toBe("VOTE");
    expect(state.phaseDeadline).toBe(77_000);
  });

  it("returns all players with the highest score as shared winners", () => {
    let state = submitBothFakes(createStartedGame());

    const realOption = state.currentRound!.options.find(
      (option) => option.isReal,
    )!;

    state = applyAction(
      state,
      {
        type: "SUBMIT_VOTE",
        playerId: "p1",
        roundNumber: 1,
        optionId: realOption.id,
      },
      2300,
    );

    state = applyAction(
      state,
      {
        type: "SUBMIT_VOTE",
        playerId: "p2",
        roundNumber: 1,
        optionId: realOption.id,
      },
      2400,
    );

    for (let round = 1; round <= 5; round += 1) {
      if (round > 1) {
        expect(state.phase).toBe("WRITE");
      }

      if (round < 5) {
        state = applyAction(
          state,
          { type: "HEARTBEAT", playerId: "p1" },
          state.phaseDeadline!,
        );

        expect(state.phase).toBe("VOTE");

        // No fake entries are required for the remaining deadline test.
        state = applyAction(
          state,
          { type: "HEARTBEAT", playerId: "p1" },
          state.phaseDeadline!,
        );

        expect(state.phase).toBe("REVEAL");

        state = applyAction(
          state,
          { type: "HEARTBEAT", playerId: "p1" },
          state.phaseDeadline!,
        );
      } else {
        state = applyAction(
          state,
          { type: "HEARTBEAT", playerId: "p1" },
          state.phaseDeadline!,
        );
      }
    }

    expect(state.phase).toBe("FINISHED");
    expect(getWinners(state).map((player) => player.id)).toEqual(["p1", "p2"]);
  });
});
