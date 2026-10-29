export interface ViewPlayer {
  id: string;
  name: string;
  joinedAt: number;
  active: boolean;
  score: number;
}

export interface ViewOption {
  id: string;
  text: string;
  authorPlayerId?: string | null;
  isReal?: boolean;
}

export interface ViewRound {
  term: string;
  hasSubmitted: boolean;
  ownSubmission?: string;
  sourceUrl?: string;
  realDefinition?: string;
  options?: ViewOption[];
  ownVoteOptionId?: string;
  votes?: Record<string, string>;
  scored?: boolean;
}

export interface RoundResult {
  roundNumber: number;
  term: string;
  realDefinition: string;
  options: ViewOption[];
  votes: Record<string, string>;
  scoreChanges: Record<string, number>;
}

export interface PlayerGameView {
  roomCode: string;
  version: number;
  phase: "LOBBY" | "WRITE" | "VOTE" | "REVEAL" | "FINISHED";
  hostPlayerId: string | null;
  viewerPlayerId: string;
  players: ViewPlayer[];
  roundNumber: number;
  phaseDeadline: number | null;
  currentRound: ViewRound | null;
  history: RoundResult[];
}

export interface ApiEnvelope {
  roomCode: string;
  token?: string;
  view: PlayerGameView;
  serverTime: number;
}

export type GameCommand =
  | { type: "heartbeat" }
  | { type: "leave" }
  | { type: "start" }
  | { type: "submitFake"; roundNumber: number; text: string }
  | { type: "submitVote"; roundNumber: number; optionId: string }
  | { type: "advance"; roundNumber: number }
  | { type: "playAgain" };

async function request<T>(body: unknown): Promise<T> {
  const response = await fetch("/.netlify/functions/game", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
  } & T;

  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status})`);
  }

  return payload;
}

export function createRoom(name: string) {
  return request<ApiEnvelope>({ action: "create", name });
}

export function joinRoom(roomCode: string, name: string, token?: string) {
  return request<ApiEnvelope>({
    action: "join",
    roomCode: roomCode.trim().toUpperCase(),
    name,
    ...(token ? { token } : {}),
  });
}

export function sendCommand(token: string, command: GameCommand) {
  return request<ApiEnvelope>({ action: "game", token, command });
}
