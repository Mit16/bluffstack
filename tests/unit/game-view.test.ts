import { describe, expect, it } from "vitest";
import { applyAction, createRoomState } from "../../src/lib/game-engine";
import { getPlayerGameView } from "../../src/lib/game-view";
import type { GameState, Player, TechTerm } from "../../src/types/game";

const realDefinition =
  "An official mechanism for coordinating distributed software components.";

const terms: TechTerm[] = Array.from({ length: 5 }, (_, index) => ({
  id: `term-${index + 1}`,
  term: `Technology ${index + 1}`,
  definition:
    index === 0
      ? realDefinition
      : `An official technical definition for concept number ${index + 1}.`,
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

const hostFake =
  "A virtual machine instruction scheduling mechanism for parallel workloads.";
const guestFake =
  "A storage indexing technique that accelerates searches across large datasets.";

function createStartedGame(): GameState {
  let state = createRoomState({
    roomCode: "SAFE",
    host,
    terms,
    now: 1_000,
  });

  state = applyAction(state, { type: "JOIN", player: guest }, 1_001);

  return applyAction(state, { type: "START_GAME", playerId: "host" }, 2_000);
}

function enterVote(): GameState {
  let state = createStartedGame();

  state = applyAction(
    state,
    {
      type: "SUBMIT_FAKE",
      playerId: "host",
      roundNumber: 1,
      text: hostFake,
    },
    2_100,
  );

  return applyAction(
    state,
    {
      type: "SUBMIT_FAKE",
      playerId: "guest",
      roundNumber: 1,
      text: guestFake,
    },
    2_200,
  );
}

function enterReveal(): GameState {
  let state = enterVote();
  const realOption = state.currentRound!.options.find(
    (option) => option.isReal,
  )!;

  state = applyAction(
    state,
    {
      type: "SUBMIT_VOTE",
      playerId: "host",
      roundNumber: 1,
      optionId: realOption.id,
    },
    2_300,
  );

  return applyAction(
    state,
    {
      type: "SUBMIT_VOTE",
      playerId: "guest",
      roundNumber: 1,
      optionId: realOption.id,
    },
    2_400,
  );
}

describe("player-specific game views", () => {
  it("does not expose definitions in the lobby", () => {
    const state = createStartedGame();
    state.phase = "LOBBY";
    state.currentRound = null;
    state.roundNumber = 0;
    state.phaseDeadline = null;

    const view = getPlayerGameView(state, "host");
    const serialized = JSON.stringify(view);

    expect(view.phase).toBe("LOBBY");
    expect(serialized).not.toContain(realDefinition);
    expect(serialized).not.toContain(hostFake);
    expect(serialized).not.toContain(guestFake);
  });

  it("exposes only the current term and the viewer's own fake during WRITE", () => {
    const state = applyAction(
      createStartedGame(),
      {
        type: "SUBMIT_FAKE",
        playerId: "host",
        roundNumber: 1,
        text: hostFake,
      },
      2_100,
    );

    const view = getPlayerGameView(state, "host");
    const serialized = JSON.stringify(view);

    expect(view.currentRound?.term).toBe("Technology 1");
    expect(view.currentRound?.ownSubmission).toBe(hostFake);
    expect(serialized).not.toContain(realDefinition);
    expect(serialized).not.toContain(guestFake);
    expect(view.currentRound?.options).toBeUndefined();
  });

  it("hides authors and real/fake markers during VOTE", () => {
    const state = enterVote();
    const view = getPlayerGameView(state, "host");

    expect(view.phase).toBe("VOTE");

    // Players must see every definition so they can vote.
    expect(view.currentRound?.options).toHaveLength(3);
    expect(view.currentRound?.options?.map((option) => option.text)).toContain(
      realDefinition,
    );

    // But they must not learn which definition is real or who wrote a fake.
    for (const option of view.currentRound!.options!) {
      expect(Object.keys(option).sort()).toEqual(["id", "text"]);
      expect(option).not.toHaveProperty("authorPlayerId");
      expect(option).not.toHaveProperty("isReal");
    }

    // Other players' votes are private until reveal.
    expect(view.currentRound).not.toHaveProperty("votes");
  });

  it("reveals the definition, authors, and votes during REVEAL", () => {
    const state = enterReveal();
    const view = getPlayerGameView(state, "host");

    expect(view.phase).toBe("REVEAL");
    expect(view.currentRound?.realDefinition).toBe(realDefinition);
    expect(view.currentRound?.options).toEqual(state.currentRound?.options);
    expect(view.currentRound?.votes).toEqual(state.currentRound?.votes);

    expect(
      view.currentRound?.options?.some(
        (option) => option.authorPlayerId === "host",
      ),
    ).toBe(true);

    expect(view.history).toHaveLength(1);
  });

  it("rejects requests from IDs that are not room members", () => {
    const state = createStartedGame();

    expect(() => getPlayerGameView(state, "stranger")).toThrow(/not a member/i);
  });
});
