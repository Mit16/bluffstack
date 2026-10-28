import {
  GameRuleError,
  type GamePhase,
  type GameState,
  type Player,
  type RoundResult,
} from "../types/game";

export interface GameViewPlayer {
  id: string;
  name: string;
  joinedAt: number;
  active: boolean;
  score: number;
}

export interface GameViewOption {
  id: string;
  text: string;
  // These fields are deliberately absent during VOTE.
  authorPlayerId?: string | null;
  isReal?: boolean;
}

export interface GameViewRound {
  term: string;
  hasSubmitted: boolean;
  ownSubmission?: string;
  sourceUrl?: string;
  realDefinition?: string;
  options?: GameViewOption[];
  ownVoteOptionId?: string;
  votes?: Record<string, string>;
  scored?: boolean;
}

export interface PlayerGameView {
  roomCode: string;
  version: number;
  phase: GamePhase;
  hostPlayerId: string;
  viewerPlayerId: string;
  players: GameViewPlayer[];
  roundNumber: number;
  phaseDeadline: number | null;
  currentRound: GameViewRound | null;
  history: RoundResult[];
}

function toViewPlayer(player: Player): GameViewPlayer {
  return {
    id: player.id,
    name: player.name,
    joinedAt: player.joinedAt,
    active: player.active,
    score: player.score,
  };
}

/**
 * Produces a player-specific response.
 *
 * Never return the full internal GameState directly from an API.
 */
export function getPlayerGameView(
  state: GameState,
  playerId: string,
): PlayerGameView {
  const viewer = state.players.find((player) => player.id === playerId);

  if (!viewer) {
    throw new GameRuleError("Player is not a member of this room.");
  }

  const base: PlayerGameView = {
    roomCode: state.roomCode,
    version: state.version,
    phase: state.phase,
    hostPlayerId: state.hostPlayerId,
    viewerPlayerId: viewer.id,
    players: state.players.map(toViewPlayer),
    roundNumber: state.roundNumber,
    phaseDeadline: state.phaseDeadline,
    currentRound: null,
    // History only contains rounds that have already been revealed.
    history: structuredClone(state.history),
  };

  const round = state.currentRound;

  if (!round || state.phase === "LOBBY" || state.phase === "FINISHED") {
    return base;
  }

  const ownSubmission = round.submissions[playerId];
  const ownVoteOptionId = round.votes[playerId];

  const safeRound: GameViewRound = {
    term: round.term.term,
    hasSubmitted: ownSubmission !== undefined,
  };

  if (ownSubmission !== undefined) {
    safeRound.ownSubmission = ownSubmission;
  }

  if (state.phase === "WRITE") {
    // Do not expose the real definition, other submissions, or vote options.
    base.currentRound = safeRound;
    return base;
  }

  if (state.phase === "VOTE") {
    // Only the option ID and text are public. Author and real/fake metadata
    // must not be sent to the browser during voting.
    safeRound.options = round.options.map((option) => ({
      id: option.id,
      text: option.text,
    }));

    if (ownVoteOptionId !== undefined) {
      safeRound.ownVoteOptionId = ownVoteOptionId;
    }

    // Do not expose other players' votes or the real definition.
    base.currentRound = safeRound;
    return base;
  }

  if (state.phase === "REVEAL") {
    safeRound.sourceUrl = round.term.sourceUrl;
    safeRound.realDefinition = round.term.definition;
    safeRound.options = structuredClone(round.options);
    safeRound.votes = { ...round.votes };
    safeRound.scored = round.scored;

    if (ownVoteOptionId !== undefined) {
      safeRound.ownVoteOptionId = ownVoteOptionId;
    }

    base.currentRound = safeRound;
    return base;
  }

  return base;
}
