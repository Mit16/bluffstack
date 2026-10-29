import { z } from "zod";
import type { GameState } from "../../../src/types/game";
import { getSupabaseAdmin } from "./supabase";
import type { Json } from "./database.types";

const roomCodeSchema = z.string().regex(/^[A-Z0-9]{4}$/);

const techTermSchema = z.object({
  id: z.string(),
  term: z.string(),
  definition: z.string(),
  sourceUrl: z.string(),
});

const playerSchema = z.object({
  id: z.string(),
  name: z.string(),
  joinedAt: z.number(),
  lastSeen: z.number(),
  active: z.boolean(),
  score: z.number(),
});

const voteOptionSchema = z.object({
  id: z.string(),
  text: z.string(),
  authorPlayerId: z.string().nullable(),
  isReal: z.boolean(),
});

const roundStateSchema = z.object({
  term: techTermSchema,
  submissions: z.record(z.string(), z.string()),
  options: z.array(voteOptionSchema),
  votes: z.record(z.string(), z.string()),
  scored: z.boolean(),
});

const roundResultSchema = z.object({
  roundNumber: z.number().int(),
  term: z.string(),
  realDefinition: z.string(),
  options: z.array(voteOptionSchema),
  votes: z.record(z.string(), z.string()),
  scoreChanges: z.record(z.string(), z.number()),
});

const gameStateSchema = z.object({
  roomCode: roomCodeSchema,
  version: z.number().int().nonnegative(),
  phase: z.enum(["LOBBY", "WRITE", "VOTE", "REVEAL", "FINISHED"]),
  hostPlayerId: z.string().nullable(),
  players: z.array(playerSchema),
  terms: z.array(techTermSchema),
  roundNumber: z.number().int().nonnegative(),
  phaseDeadline: z.number().nullable(),
  currentRound: roundStateSchema.nullable(),
  history: z.array(roundResultSchema),
});

const storedRoomSchema = z.object({
  room_code: roomCodeSchema,
  state: gameStateSchema,
  revision: z.number().int().nonnegative(),
});

export interface StoredRoom {
  state: GameState;
  revision: number;
}

export class RoomAlreadyExistsError extends Error {
  constructor(roomCode: string) {
    super(`Room ${roomCode} already exists.`);
    this.name = "RoomAlreadyExistsError";
  }
}

export class RoomNotFoundError extends Error {
  constructor(roomCode: string) {
    super(`Room ${roomCode} was not found.`);
    this.name = "RoomNotFoundError";
  }
}

export class RoomRevisionConflictError extends Error {
  constructor(roomCode: string) {
    super(`Room ${roomCode} changed during this operation.`);
    this.name = "RoomRevisionConflictError";
  }
}

function parseStoredRoom(value: unknown, expectedCode: string): StoredRoom {
  const row = storedRoomSchema.parse(value);

  if (row.room_code !== expectedCode || row.state.roomCode !== expectedCode) {
    throw new Error("Database returned a mismatched room code.");
  }

  return {
    state: row.state as GameState,
    revision: row.revision,
  };
}

export async function createRoom(state: GameState): Promise<StoredRoom> {
  const validatedState = gameStateSchema.parse(state);

  const { data, error } = await getSupabaseAdmin().rpc("create_game_room", {
    p_room_code: validatedState.roomCode,
    p_state: JSON.parse(JSON.stringify(validatedState)) as Json,
  });

  if (error) {
    throw new Error(`Failed to create room: ${error.message}`);
  }

  const rows = z
    .array(
      z.object({
        created_room_code: roomCodeSchema,
        current_revision: z.number().int().nonnegative(),
        current_state: gameStateSchema,
      }),
    )
    .parse(data);

  if (rows.length === 0) {
    throw new RoomAlreadyExistsError(validatedState.roomCode);
  }

  if (rows.length !== 1) {
    throw new Error("Unexpected response while creating room.");
  }

  const row = rows[0];

  return parseStoredRoom(
    {
      room_code: row.created_room_code,
      revision: row.current_revision,
      state: row.current_state,
    },
    validatedState.roomCode,
  );
}

export async function loadRoom(roomCode: string): Promise<StoredRoom> {
  const validatedCode = roomCodeSchema.parse(roomCode);

  const { data, error } = await getSupabaseAdmin()
    .from("game_rooms")
    .select("room_code,state,revision")
    .eq("room_code", validatedCode)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load room: ${error.message}`);
  }

  if (data === null) {
    throw new RoomNotFoundError(validatedCode);
  }

  return parseStoredRoom(data, validatedCode);
}

export type SaveRoomResult =
  | { status: "saved"; room: StoredRoom }
  | { status: "conflict" };

export async function saveRoomState(
  roomCode: string,
  expectedRevision: number,
  state: GameState,
): Promise<SaveRoomResult> {
  const validatedCode = roomCodeSchema.parse(roomCode);
  const validatedState = gameStateSchema.parse(state);

  if (validatedState.roomCode !== validatedCode) {
    throw new Error("Room code does not match the state being saved.");
  }

  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new Error("Expected revision must be a non-negative safe integer.");
  }

  const { data, error } = await getSupabaseAdmin().rpc("save_game_room_state", {
    p_room_code: validatedCode,
    p_expected_revision: expectedRevision,
    p_state: JSON.parse(JSON.stringify(validatedState)) as Json,
  });

  if (error) {
    throw new Error(`Failed to save room: ${error.message}`);
  }

  const rows = z
    .array(
      z.object({
        saved_revision: z.number().int().nonnegative(),
        saved_state: gameStateSchema,
      }),
    )
    .parse(data);

  if (rows.length === 0) {
    return { status: "conflict" };
  }

  if (rows.length !== 1) {
    throw new Error("Unexpected response while saving room.");
  }

  const saved = rows[0];

  return {
    status: "saved",
    room: {
      state: saved.saved_state as GameState,
      revision: saved.saved_revision,
    },
  };
}
