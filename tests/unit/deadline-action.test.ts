import { describe, expect, it } from "vitest";
import { applyAction, createRoomState } from "../../src/lib/game-engine";
import type { GameState, Player, TechTerm } from "../../src/types/game";

const terms: TechTerm[] = Array.from({ length: 5 }, (_, index) => ({
  id: `term-${index + 1}`,
  term: `Technology ${index + 1}`,
  definition: `The official definition for technical concept ${index + 1}.`,
  sourceUrl: `https://example.com/terms/${index + 1}`,
}));

const host: Player = {
  id: "host",
  name: "Host",
  joinedAt: 1_000,
  lastSeen: 1_000,
  active: true,
  score: 0,
};

const guest: Player = {
  id: "guest",
  name: "Guest",
  joinedAt: 1_001,
  lastSeen: 1_001,
  active: true,
  score: 0,
};

function createStartedGame(): GameState {
  let state = createRoomState({
    roomCode: "TIME",
    host,
    terms,
    now: 1_000,
  });

  state = applyAction(state, { type: "JOIN", player: guest }, 1_001);

  return applyAction(state, { type: "START_GAME", playerId: "host" }, 2_000);
}

describe("deadline-boundary actions", () => {
  it.each([
    ["exactly at the deadline", 0],
    ["after the deadline", 1],
  ])(
    "rejects a fake submission arriving %s",
    (_description, millisecondsAfterDeadline) => {
      const state = createStartedGame();
      const deadline = state.phaseDeadline!;

      expect(state.phase).toBe("WRITE");

      expect(() =>
        applyAction(
          state,
          {
            type: "SUBMIT_FAKE",
            playerId: "host",
            roundNumber: state.roundNumber,
            text: "A fictional definition submitted too late.",
          },
          deadline + millisecondsAfterDeadline,
        ),
      ).toThrow();

      // A failed action must not mutate the caller's state.
      expect(state.phase).toBe("WRITE");
      expect(state.currentRound?.submissions.host).toBeUndefined();
    },
  );

  it("does not let an early ADVANCE request skip VOTE", () => {
    const state = createStartedGame();
    const deadline = state.phaseDeadline!;

    // A valid request at the expired WRITE deadline advances to VOTE.
    const votingState = applyAction(
      state,
      { type: "HEARTBEAT", playerId: "host" },
      deadline,
    );

    expect(votingState.phase).toBe("VOTE");

    const beforeAdvance = structuredClone(votingState);

    // No votes have been submitted and the VOTE deadline has not expired.
    expect(() =>
      applyAction(
        votingState,
        {
          type: "ADVANCE",
          playerId: "host",
          roundNumber: votingState.roundNumber,
        },
        deadline + 1,
      ),
    ).toThrow(/not ready to advance/i);

    expect(votingState).toEqual(beforeAdvance);
    expect(votingState.phase).toBe("VOTE");
  });

  it("increments the version when a heartbeat advances an expired deadline", () => {
    const state = createStartedGame();
    const deadline = state.phaseDeadline!;

    const advanced = applyAction(
      state,
      { type: "HEARTBEAT", playerId: "host" },
      deadline,
    );

    expect(advanced.phase).toBe("VOTE");
    expect(advanced.version).toBe(state.version + 1);
    expect(advanced.phaseDeadline).toBe(deadline + 30_000);

    // The original state must remain unchanged.
    expect(state.phase).toBe("WRITE");
    expect(state.version).not.toBe(advanced.version);
  });

  it("does not increment the version for a heartbeat after the deadline was already advanced", () => {
    const state = createStartedGame();
    const deadline = state.phaseDeadline!;

    const advanced = applyAction(
      state,
      { type: "HEARTBEAT", playerId: "host" },
      deadline,
    );

    const heartbeat = applyAction(
      advanced,
      { type: "HEARTBEAT", playerId: "host" },
      deadline + 1,
    );

    expect(heartbeat.phase).toBe("VOTE");
    expect(heartbeat.version).toBe(advanced.version);
    expect(heartbeat.phaseDeadline).toBe(advanced.phaseDeadline);
  });
});
