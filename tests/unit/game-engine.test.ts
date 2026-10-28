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
  it("rejects an identical fake submitted by another player", () => {
    const started = createStartedGame();
    const firstFake =
      "A distributed compiler protocol that coordinates independent execution nodes.";

    const submitted = applyAction(
      started,
      {
        type: "SUBMIT_FAKE",
        playerId: "p1",
        roundNumber: 1,
        text: firstFake,
      },
      2_100,
    );

    const stateBeforeRetry = structuredClone(submitted);

    expect(() =>
      applyAction(
        submitted,
        {
          type: "SUBMIT_FAKE",
          playerId: "p2",
          roundNumber: 1,
          text: firstFake,
        },
        2_200,
      ),
    ).toThrow(/too similar|duplicate/i);

    expect(submitted.currentRound?.submissions.p1).toBe(firstFake);
    expect(submitted.currentRound?.submissions.p2).toBeUndefined();
    expect(submitted).toEqual(stateBeforeRetry);
    expect(started.currentRound?.submissions).toEqual({});
  });

  it("rejects a near-identical fake submitted by another player", () => {
    const started = createStartedGame();

    const originalFake =
      "A distributed compiler protocol coordinates independent execution nodes.";

    const submitted = applyAction(
      started,
      {
        type: "SUBMIT_FAKE",
        playerId: "p1",
        roundNumber: 1,
        text: originalFake,
      },
      2_100,
    );

    expect(() =>
      applyAction(
        submitted,
        {
          type: "SUBMIT_FAKE",
          playerId: "p2",
          roundNumber: 1,
          text: "A distributed compiler protocol coordinates independent execution node.",
        },
        2_200,
      ),
    ).toThrow(/too similar|duplicate/i);
  });

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

  it("rejects a second fake submission from the same player", () => {
    const started = createStartedGame();
    const originalFake =
      "A distributed compiler protocol that coordinates independent execution nodes.";

    const submitted = applyAction(
      started,
      {
        type: "SUBMIT_FAKE",
        playerId: "p1",
        roundNumber: 1,
        text: originalFake,
      },
      2_100,
    );

    const stateBeforeRetry = structuredClone(submitted);

    expect(() =>
      applyAction(
        submitted,
        {
          type: "SUBMIT_FAKE",
          playerId: "p1",
          roundNumber: 1,
          text: "A different scheduling protocol for distributed software execution.",
        },
        2_200,
      ),
    ).toThrow(/already submitted/i);

    // A rejected retry must not overwrite the original submission.
    expect(submitted.currentRound?.submissions.p1).toBe(originalFake);

    // Neither the first state nor the submitted state may be mutated.
    expect(started.currentRound?.submissions).toEqual({});
    expect(submitted).toEqual(stateBeforeRetry);
  });

  it("allows different players to submit their own fakes", () => {
    const state = submitBothFakes(createStartedGame());

    expect(state.phase).toBe("VOTE");
    expect(state.currentRound?.submissions.p1).toBe(
      "A distributed compiler protocol that coordinates independent execution nodes.",
    );
    expect(state.currentRound?.submissions.p2).toBe(
      "A memory allocation technique for asynchronously scheduled computation graphs.",
    );
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
    const state = createStartedGame();

    state.phase = "FINISHED";
    state.currentRound = null;
    state.phaseDeadline = null;

    state.players[0].score = 12;
    state.players[1].score = 12;

    expect(getWinners(state).map((player) => player.id)).toEqual(["p1", "p2"]);
  });
});
