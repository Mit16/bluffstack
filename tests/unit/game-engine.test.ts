import { describe, expect, it } from "vitest";
import {
  applyAction,
  createRoomState,
  getWinners,
  advanceGameState,
} from "../../src/lib/game-engine";
import type {
  GameState,
  Player,
  TechTerm,
  VoteOption,
} from "../../src/types/game";

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

  it("uses the injected option order when a player timeout starts voting", () => {
    let state = createStartedGame();

    state = applyAction(state, { type: "HEARTBEAT", playerId: "p1" }, 5_000);

    state = applyAction(
      state,
      {
        type: "SUBMIT_FAKE",
        playerId: "p1",
        roundNumber: 1,
        text: "A distributed compiler protocol that coordinates independent execution nodes.",
      },
      5_100,
    );

    // Keep p1 active while p2 times out.
    state = applyAction(state, { type: "HEARTBEAT", playerId: "p1" }, 20_900);

    let orderCalls = 0;

    const reverseOptions = (options: VoteOption[]): VoteOption[] => {
      orderCalls += 1;
      return [...options].reverse();
    };

    const nextState = advanceGameState(state, 21_000, reverseOptions);

    expect(nextState.phase).toBe("VOTE");
    expect(orderCalls).toBe(1);
    expect(nextState.players.find((player) => player.id === "p2")?.active).toBe(
      false,
    );
    expect(nextState.currentRound!.options.map((option) => option.id)).toEqual([
      "fake-1-1",
      "real-1",
    ]);
  });

  it("uses the injected option order when a player leaves during WRITE", () => {
    let state = createStartedGame();

    state = applyAction(
      state,
      {
        type: "SUBMIT_FAKE",
        playerId: "p1",
        roundNumber: 1,
        text: "A distributed compiler protocol that coordinates independent execution nodes.",
      },
      2_100,
    );

    let orderCalls = 0;

    const reverseOptions = (options: VoteOption[]): VoteOption[] => {
      orderCalls += 1;
      return [...options].reverse();
    };

    const nextState = applyAction(
      state,
      { type: "LEAVE", playerId: "p2" },
      2_200,
      reverseOptions,
    );

    expect(nextState.phase).toBe("VOTE");
    expect(orderCalls).toBe(1);
    expect(nextState.currentRound!.options.map((option) => option.id)).toEqual([
      "fake-1-1",
      "real-1",
    ]);
  });

  it("uses the injected option order when WRITE expires", () => {
    let state = createStartedGame();

    state = applyAction(
      state,
      {
        type: "SUBMIT_FAKE",
        playerId: "p1",
        roundNumber: 1,
        text: "A distributed compiler protocol that coordinates independent execution nodes.",
      },
      2_100,
    );

    // Keep both players active until the WRITE deadline.
    state = applyAction(state, { type: "HEARTBEAT", playerId: "p1" }, 45_990);
    state = applyAction(state, { type: "HEARTBEAT", playerId: "p2" }, 45_990);

    let orderCalls = 0;

    const reverseOptions = (options: VoteOption[]): VoteOption[] => {
      orderCalls += 1;
      return [...options].reverse();
    };

    const votingState = advanceGameState(state, 47_000, reverseOptions);

    expect(votingState.phase).toBe("VOTE");
    expect(orderCalls).toBe(1);
    expect(
      votingState.currentRound!.options.map((option) => option.id),
    ).toEqual(["fake-1-1", "real-1"]);
  });

  it("uses the injected option order exactly once per round", () => {
    const started = createStartedGame();

    const afterFirstSubmission = applyAction(
      started,
      {
        type: "SUBMIT_FAKE",
        playerId: "p1",
        roundNumber: 1,
        text: "A distributed compiler protocol that coordinates independent execution nodes.",
      },
      2_100,
    );

    let shuffleCalls = 0;

    const reverseOptions = (options: VoteOption[]): VoteOption[] => {
      shuffleCalls += 1;
      return [...options].reverse();
    };

    const votingState = applyAction(
      afterFirstSubmission,
      {
        type: "SUBMIT_FAKE",
        playerId: "p2",
        roundNumber: 1,
        text: "A memory allocation technique for asynchronously scheduled computation graphs.",
      },
      2_200,
      reverseOptions,
    );

    expect(votingState.phase).toBe("VOTE");
    expect(shuffleCalls).toBe(1);

    const optionIds = votingState.currentRound!.options.map(
      (option) => option.id,
    );

    expect(optionIds).toEqual(["fake-1-2", "fake-1-1", "real-1"]);
    expect(new Set(optionIds).size).toBe(3);

    const savedOrder = [...optionIds];

    const afterHeartbeat = applyAction(
      votingState,
      { type: "HEARTBEAT", playerId: "p1" },
      2_300,
      reverseOptions,
    );

    expect(
      afterHeartbeat.currentRound!.options.map((option) => option.id),
    ).toEqual(savedOrder);
    expect(shuffleCalls).toBe(1);
  });

  it("reactivates a timed-out player on heartbeat and rejoin", () => {
    let state = createStartedGame();
    state = applyAction(state, { type: "HEARTBEAT", playerId: "p1" }, 5_000);

    // p2 has been silent since 1001, so they expire at 20_000.
    const expired = advanceGameState(state, 20_000);
    expect(expired.players.find((p) => p.id === "p2")?.active).toBe(false);
    expect(expired.players.find((p) => p.id === "p1")?.active).toBe(true);
    expect(expired.hostPlayerId).toBe("p1");

    // A returning heartbeat reactivates the known player.
    const back = applyAction(
      expired,
      { type: "HEARTBEAT", playerId: "p2" },
      21_000,
    );
    expect(back.players.find((p) => p.id === "p2")?.active).toBe(true);
    expect(back.players.find((p) => p.id === "p2")?.lastSeen).toBe(21_000);
    expect(back.players).toHaveLength(2);

    // A refresh-style JOIN with the same ID rejoins instead of throwing.
    const expiredAgain = advanceGameState(back, 40_000);
    const rejoined = applyAction(
      expiredAgain,
      { type: "JOIN", player: guest },
      41_000,
    );
    expect(rejoined.players).toHaveLength(2);
    expect(rejoined.players.find((p) => p.id === "p2")?.active).toBe(true);
  });

  it("advances WRITE early when a non-submitter times out", () => {
    let state = createStartedGame();
    state = applyAction(state, { type: "HEARTBEAT", playerId: "p1" }, 5_000);
    state = applyAction(
      state,
      {
        type: "SUBMIT_FAKE",
        playerId: "p1",
        roundNumber: 1,
        text: "A distributed compiler protocol that coordinates independent execution nodes.",
      },
      5_100,
    );
    expect(state.phase).toBe("WRITE");

    // Keep p1 fresh, let p2 (silent since 1001) expire; the phase must not
    // wait for the 47s WRITE deadline.
    state = applyAction(state, { type: "HEARTBEAT", playerId: "p1" }, 20_900);
    const advanced = advanceGameState(state, 21_000);

    expect(advanced.phase).toBe("VOTE");
    expect(advanced.phaseDeadline).toBe(51_000);
    expect(advanced.players.find((p) => p.id === "p2")?.active).toBe(false);
    expect(advanced.currentRound?.options).toHaveLength(2);
    expect(advanced.hostPlayerId).toBe("p1");
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
