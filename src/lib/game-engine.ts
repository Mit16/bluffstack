import {
  GameRuleError,
  type CreateRoomInput,
  type GameAction,
  type GameState,
  type GamePhase,
  type Player,
  type RoundResult,
  type RoundState,
  type VoteOption,
} from "../types/game";

const WRITE_MS = 45_000;
const VOTE_MS = 30_000;
const REVEAL_MS = 10_000;
const MAX_PLAYERS = 8;
const MAX_ROUNDS = 5;
const HEARTBEAT_TIMEOUT_MS = 15_000;

function cloneState(state: GameState): GameState {
  return structuredClone(state);
}

function activePlayers(state: GameState): Player[] {
  return state.players.filter((player) => player.active);
}

function requirePlayer(state: GameState, playerId: string): Player {
  const player = state.players.find((item) => item.id === playerId);

  if (!player || !player.active) {
    throw new GameRuleError("Player is not active in this room.");
  }

  return player;
}

function requirePhase(state: GameState, phase: GamePhase): void {
  if (state.phase != phase) {
    throw new GameRuleError(
      `Action requires ${phase}, but the room is in ${state.phase}.`,
    );
  }
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function similarity(a: string, b: string): number {
  const left = new Set(normalize(a).split(/\s+/).filter(Boolean));
  const right = new Set(normalize(b).split(/\s+/).filter(Boolean));

  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  const intersection = [...left].filter((word) => right.has(word)).length;
  const union = new Set([...left, ...right]).size;

  return intersection / union;
}

function validateFake(text: string, realDefinition: string): string {
  const clean = text.trim();

  if (clean.length < 20 || clean.length > 500) {
    throw new GameRuleError(
      "A fake definition must contain 20-500 characters.",
    );
  }

  if (
    normalize(clean) === normalize(realDefinition) ||
    similarity(clean, realDefinition) >= 0.85
  ) {
    throw new GameRuleError(
      "Your definition is too similar to the real one. Rewrite it.",
    );
  }

  return clean;
}

function stableOrder(options: VoteOption[], seed: string): VoteOption[] {
  // Deterministic ordering: the same round always produces the same order.
  // This is for stable presentation, not cryptographic randomness.
  const hash = (value: string): number => {
    let result = 2166136261;

    for (let i = 0; i < value.length; i += 1) {
      result ^= value.charCodeAt(i);
      result = Math.imul(result, 16777619);
    }

    return result >>> 0;
  };

  return [...options].sort(
    (a, b) =>
      hash(`${seed}:${a.id}`) - hash(`${seed}:${b.id}`) ||
      a.id.localeCompare(b.id),
  );
}

export function createRoomState(input: CreateRoomInput): GameState {
  if (!/^[A-Z0-9]{4}$/.test(input.roomCode)) {
    throw new GameRuleError(
      "Room code must contain four uppercase letters or digits.",
    );
  }

  if (input.terms.length < MAX_ROUNDS) {
    throw new GameRuleError("At least five tech terms are required.");
  }

  if (!input.host.id.trim() || !input.host.name.trim()) {
    throw new GameRuleError("Host ID and name are required.");
  }

  return {
    roomCode: input.roomCode,
    version: 0,
    phase: "LOBBY",
    hostPlayerId: input.host.id,
    players: [
      {
        ...input.host,
        joinedAt: input.now,
        lastSeen: input.now,
        active: true,
        score: 0,
      },
    ],
    terms: [...input.terms],
    roundNumber: 0,
    phaseDeadline: null,
    currentRound: null,
    history: [],
  };
}

function beginRound(state: GameState, roundNumber: number, now: number): void {
  const term = state.terms[roundNumber - 1];

  if (!term) {
    state.phase = "FINISHED";
    state.phaseDeadline = null;
    state.currentRound = null;
    return;
  }

  state.roundNumber = roundNumber;
  state.phase = "WRITE";
  state.phaseDeadline = now + WRITE_MS;
  state.currentRound = {
    term,
    submissions: {},
    options: [],
    votes: {},
    scored: false,
  };
}

function enterVote(state: GameState, now: number): void {
  const round = state.currentRound;

  if (!round) {
    throw new GameRuleError("Cannot vote without an active round.");
  }

  const fakeOptions: VoteOption[] = Object.entries(round.submissions)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, text], index) => ({
      id: `fake-${state.roundNumber}-${index + 1}`,
      text,
      authorPlayerId: Object.keys(round.submissions).sort((a, b) =>
        a.localeCompare(b),
      )[index],
      isReal: false,
    }));

  const options: VoteOption[] = [
    {
      id: `real-${state.roundNumber}`,
      text: round.term.definition,
      authorPlayerId: null,
      isReal: true,
    },
    ...fakeOptions,
  ];

  round.options = stableOrder(
    options,
    `${state.roomCode}:${state.roundNumber}`,
  );

  round.votes = {};
  state.phase = "VOTE";
  state.phaseDeadline = now + VOTE_MS;
}

function enterReveal(state: GameState, now: number): void {
  const round = state.currentRound;

  if (!round || round.scored) {
    return;
  }

  const scoreChanges: Record<string, number> = {};

  for (const player of state.players) {
    scoreChanges[player.id] = 0;
  }

  const realOption = round.options.find((option) => option.isReal);

  if (!realOption) {
    throw new GameRuleError("The real definition is missing.");
  }

  for (const [voterId, optionId] of Object.entries(round.votes)) {
    const option = round.options.find((item) => item.id === optionId);

    if (!option) {
      continue;
    }

    if (option.isReal) {
      scoreChanges[voterId] = (scoreChanges[voterId] ?? 0) + 3;
    } else if (option.authorPlayerId) {
      scoreChanges[option.authorPlayerId] =
        (scoreChanges[option.authorPlayerId] ?? 0) + 2;
    }
  }

  for (const player of state.players) {
    player.score += scoreChanges[player.id] ?? 0;
  }

  round.scored = true;

  const result: RoundResult = {
    roundNumber: state.roundNumber,
    term: round.term.term,
    realDefinition: round.term.definition,
    options: structuredClone(round.options),
    votes: { ...round.votes },
    scoreChanges,
  };

  state.history.push(result);
  state.phase = "REVEAL";
  state.phaseDeadline = now + REVEAL_MS;
}

function allActivePlayersSubmitted(state: GameState): boolean {
  const active = activePlayers(state);
  const round = state.currentRound;

  return (
    active.length > 0 &&
    active.every((player) => player.id in (round?.submissions ?? {}))
  );
}

function allActivePlayersVoted(state: GameState): boolean {
  const active = activePlayers(state);
  const round = state.currentRound;

  return (
    active.length > 0 &&
    active.every((player) => player.id in (round?.votes ?? {}))
  );
}

function advanceDeadline(state: GameState, now: number): void {
  // Bounded loop also handles requests arriving after multiple deadlines.
  for (let i = 0; i < MAX_ROUNDS * 3 + 3; i += 1) {
    if (
      state.phaseDeadline === null ||
      now < state.phaseDeadline ||
      state.phase === "LOBBY" ||
      state.phase === "FINISHED"
    ) {
      return;
    }

    const deadline = state.phaseDeadline;

    switch (state.phase) {
      case "WRITE":
        enterVote(state, deadline);
        break;

      case "VOTE":
        enterReveal(state, deadline);
        break;

      case "REVEAL":
        if (state.roundNumber >= MAX_ROUNDS) {
          state.phase = "FINISHED";
          state.phaseDeadline = null;
          state.currentRound = null;
        } else {
          beginRound(state, state.roundNumber + 1, deadline);
        }
        break;

      default:
        return;
    }
  }
}

/**
 * Advances expired phases and marks players inactive when their
 * heartbeat is older than the allowed timeout.
 */
export function advanceGameState(current: GameState, now: number): GameState {
  if (!Number.isFinite(now)) {
    throw new GameRuleError("Invalid server timestamp.");
  }

  const state = cloneState(current);
  let changed = false;

  // Expire players only when they have been unseen for MORE than 15 seconds.
  for (const player of state.players) {
    if (player.active && now - player.lastSeen > HEARTBEAT_TIMEOUT_MS) {
      player.active = false;
      changed = true;
    }
  }

  // Transfer host ownership if the current host is no longer active.
  const currentHost = state.players.find(
    (player) => player.id === state.hostPlayerId,
  );

  if (currentHost && !currentHost.active) {
    const previousHostId = state.hostPlayerId;
    electHost(state);

    if (state.hostPlayerId !== previousHostId) {
      changed = true;
    }
  }

  const previousPhase = state.phase;
  const previousRoundNumber = state.roundNumber;
  const previousDeadline = state.phaseDeadline;
  const previousHistoryLength = state.history.length;

  advanceDeadline(state, now);

  if (
    state.phase !== previousPhase ||
    state.roundNumber !== previousRoundNumber ||
    state.phaseDeadline !== previousDeadline ||
    state.history.length !== previousHistoryLength
  ) {
    changed = true;
  }

  if (changed) {
    state.version = current.version + 1;
  }

  return state;
}

function electHost(state: GameState): void {
  const nextHost = activePlayers(state).sort(
    (a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id),
  )[0];

  if (nextHost) {
    state.hostPlayerId = nextHost.id;
  }
}

export function applyAction(
  current: GameState,
  action: GameAction,
  now: number,
): GameState {
  if (!Number.isFinite(now)) {
    throw new GameRuleError("Invalid server timestamp.");
  }

  // Work on a copy: failed actions never mutate the caller's state.
  const state = cloneState(current);

  advanceDeadline(state, now);

  switch (action.type) {
    case "JOIN": {
      if (state.phase !== "LOBBY" && state.phase !== "FINISHED") {
        throw new GameRuleError("Game in progress. Joining is disabled.");
      }

      if (state.players.some((p) => p.id === action.player.id)) {
        throw new GameRuleError("This player ID already exists.");
      }

      if (activePlayers(state).length >= MAX_PLAYERS) {
        throw new GameRuleError("Room is full.");
      }

      if (!action.player.id.trim() || !action.player.name.trim()) {
        throw new GameRuleError("Player ID and name are required.");
      }

      state.players.push({
        ...action.player,
        joinedAt: now,
        lastSeen: now,
        active: true,
        score: 0,
      });

      if (state.phase === "FINISHED") {
        state.phase = "LOBBY";
        state.phaseDeadline = null;
        state.currentRound = null;
        state.roundNumber = 0;
        state.history = [];
        for (const player of state.players) {
          player.score = 0;
        }
      }

      break;
    }

    case "HEARTBEAT": {
      const player = requirePlayer(state, action.playerId);
      player.lastSeen = now;
      break;
    }

    case "LEAVE": {
      const player = requirePlayer(state, action.playerId);
      player.active = false;

      if (state.hostPlayerId === player.id) {
        electHost(state);
      }

      if (state.phase === "WRITE" && allActivePlayersSubmitted(state)) {
        enterVote(state, now);
      } else if (state.phase === "VOTE" && allActivePlayersVoted(state)) {
        enterReveal(state, now);
      }

      break;
    }

    case "START_GAME": {
      requirePhase(state, "LOBBY");
      requirePlayer(state, action.playerId);

      if (state.hostPlayerId !== action.playerId) {
        throw new GameRuleError("Only the host can start the game.");
      }

      if (activePlayers(state).length < 2) {
        throw new GameRuleError("At least two active players are required.");
      }

      state.history = [];
      for (const player of state.players) {
        player.score = 0;
      }

      beginRound(state, 1, now);
      break;
    }

    case "SUBMIT_FAKE": {
      requirePhase(state, "WRITE");
      requirePlayer(state, action.playerId);

      if (action.roundNumber !== state.roundNumber) {
        throw new GameRuleError("Submission belongs to a different round.");
      }

      const round = state.currentRound;

      if (!round) {
        throw new GameRuleError("No active round.");
      }

      if (action.playerId in round.submissions) {
        throw new GameRuleError("You have already submitted this round.");
      }

      round.submissions[action.playerId] = validateFake(
        action.text,
        round.term.definition,
      );

      if (allActivePlayersSubmitted(state)) {
        enterVote(state, now);
      }

      break;
    }

    case "SUBMIT_VOTE": {
      requirePhase(state, "VOTE");
      requirePlayer(state, action.playerId);

      if (action.roundNumber !== state.roundNumber) {
        throw new GameRuleError("Vote belongs to a different round.");
      }

      const round = state.currentRound;

      if (!round) {
        throw new GameRuleError("No active round.");
      }

      if (action.playerId in round.votes) {
        throw new GameRuleError("You have already voted this round.");
      }

      const option = round.options.find((item) => item.id === action.optionId);

      if (!option) {
        throw new GameRuleError("Invalid vote option.");
      }

      if (option.authorPlayerId === action.playerId) {
        throw new GameRuleError("You cannot vote for your own fake.");
      }

      round.votes[action.playerId] = option.id;

      if (allActivePlayersVoted(state)) {
        enterReveal(state, now);
      }

      break;
    }

    case "ADVANCE": {
      requirePlayer(state, action.playerId);

      if (action.roundNumber !== state.roundNumber) {
        throw new GameRuleError("Advance request belongs to another round.");
      }

      if (state.phase === "WRITE") {
        if (allActivePlayersSubmitted(state)) {
          enterVote(state, now);
        } else if (state.phaseDeadline !== null && now >= state.phaseDeadline) {
          enterVote(state, state.phaseDeadline);
        } else {
          throw new GameRuleError("The WRITE phase is not ready to advance.");
        }
      } else if (state.phase === "VOTE") {
        if (allActivePlayersVoted(state)) {
          enterReveal(state, now);
        } else if (state.phaseDeadline !== null && now >= state.phaseDeadline) {
          enterReveal(state, state.phaseDeadline);
        } else {
          throw new GameRuleError("The VOTE phase is not ready to advance.");
        }
      } else {
        throw new GameRuleError("This phase cannot be advanced manually.");
      }

      break;
    }

    case "PLAY_AGAIN": {
      requirePhase(state, "FINISHED");
      requirePlayer(state, action.playerId);

      if (state.hostPlayerId !== action.playerId) {
        throw new GameRuleError("Only the host can start a rematch.");
      }

      state.history = [];
      for (const player of state.players) {
        player.score = 0;
      }

      beginRound(state, 1, now);
      break;
    }
  }

  state.version = current.version + 1;
  return state;
}

export function getLeaderboard(state: GameState): Player[] {
  return [...state.players].sort(
    (a, b) => b.score - a.score || a.joinedAt - b.joinedAt,
  );
}

export function getWinners(state: GameState): Player[] {
  if (state.phase !== "FINISHED") {
    return [];
  }

  const leaderboard = getLeaderboard(state);

  if (leaderboard.length === 0) {
    return [];
  }

  const highestScore = leaderboard[0].score;

  return leaderboard.filter((player) => player.score === highestScore);
}
