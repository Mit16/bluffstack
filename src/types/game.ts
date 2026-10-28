export type GamePhase = "LOBBY" | "WRITE" | "VOTE" | "REVEAL" | "FINISHED";

export interface TechTerm {
  id: string;
  term: string;
  definition: string;
  sourceUrl: string;
}

export interface Player {
  id: string;
  name: string;
  joinedAt: number;
  lastSeen: number;
  active: boolean;
  score: number;
}

export interface VoteOption {
  id: string;
  text: string;
  authorPlayerId: string | null;
  isReal: boolean;
}

export interface RoundState {
  term: TechTerm;
  submissions: Record<string, string>;
  options: VoteOption[];
  votes: Record<string, string>;
  scored: boolean;
}

export interface RoundResult {
  roundNumber: number;
  term: string;
  realDefinition: string;
  options: VoteOption[];
  votes: Record<string, string>;
  scoreChanges: Record<string, number>;
}

export interface GameState {
  roomCode: string;
  version: number;
  phase: GamePhase;
  hostPlayerId: string | null;
  players: Player[];
  terms: TechTerm[];
  roundNumber: number;
  phaseDeadline: number | null;
  currentRound: RoundState | null;
  history: RoundResult[];
}

export type GameAction =
  | { type: "JOIN"; player: Player }
  | { type: "HEARTBEAT"; playerId: string }
  | { type: "LEAVE"; playerId: string }
  | { type: "START_GAME"; playerId: string }
  | {
      type: "SUBMIT_FAKE";
      playerId: string;
      roundNumber: number;
      text: string;
    }
  | {
      type: "SUBMIT_VOTE";
      playerId: string;
      roundNumber: number;
      optionId: string;
    }
  | {
      type: "ADVANCE";
      playerId: string;
      roundNumber: number;
    }
  | {
      type: "PLAY_AGAIN";
      playerId: string;
    };

export interface CreateRoomInput {
  roomCode: string;
  host: Player;
  terms: TechTerm[];
  now: number;
}

export class GameRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GameRuleError";
  }
}
