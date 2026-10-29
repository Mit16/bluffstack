import type { Handler, HandlerResponse } from "@netlify/functions";
import { randomInt, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  advanceGameState,
  applyAction,
  createRoomState,
} from "../../../src/lib/game-engine";
import { getPlayerGameView } from "../../../src/lib/game-view";
import {
  GameRuleError,
  type GameAction,
  type GameState,
  type Player,
  type TechTerm,
} from "../../../src/types/game";
import {
  RoomAlreadyExistsError,
  RoomNotFoundError,
  type StoredRoom,
  type SaveRoomResult,
} from "./room-store";
import { secureOrderOptions } from "./secure-shuffle";
import { signPlayerToken, verifyPlayerToken } from "./player-token";

const roomCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_ROOM_CREATE_ATTEMPTS = 8;
const MAX_SAVE_ATTEMPTS = 3;

const nameSchema = z
  .string()
  .trim()
  .min(2, "Name must contain at least 2 characters.")
  .max(24, "Name must contain at most 24 characters.")
  .refine((name) => !/[\u0000-\u001f\u007f]/.test(name), {
    message: "Name contains invalid characters.",
  });

const createRequestSchema = z.object({
  action: z.literal("create"),
  name: nameSchema,
});

const joinRequestSchema = z.object({
  action: z.literal("join"),
  roomCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/, {
      message: "Room code must contain four valid letters or digits.",
    }),
  name: nameSchema,
  token: z.string().min(1).max(2048).optional(),
});

const gameCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("heartbeat"),
  }),
  z.object({
    type: z.literal("leave"),
  }),
  z.object({
    type: z.literal("start"),
  }),
  z.object({
    type: z.literal("submitFake"),
    roundNumber: z.number().int().positive(),
    text: z.string().min(1).max(1000),
  }),
  z.object({
    type: z.literal("submitVote"),
    roundNumber: z.number().int().positive(),
    optionId: z.string().min(1).max(128),
  }),
  z.object({
    type: z.literal("advance"),
    roundNumber: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("playAgain"),
  }),
]);

const gameRequestSchema = z.object({
  action: z.literal("game"),
  token: z.string().min(1).max(2048),
  command: gameCommandSchema,
});

const requestSchema = z.discriminatedUnion("action", [
  createRequestSchema,
  joinRequestSchema,
  gameRequestSchema,
]);

type ApiRequest = z.infer<typeof requestSchema>;

interface ApiDependencies {
  createRoom: (state: GameState) => Promise<StoredRoom>;
  loadRoom: (roomCode: string) => Promise<StoredRoom>;
  saveRoomState: (
    roomCode: string,
    expectedRevision: number,
    state: GameState,
  ) => Promise<SaveRoomResult>;
  terms: TechTerm[];
  tokenSecret: () => string;
  now: () => number;
  newPlayerId: () => string;
  newRoomCode: () => string;
  signToken: (
    identity: { roomCode: string; playerId: string },
    secret: string,
    nowSeconds?: number,
  ) => string;
  verifyToken: (
    token: string,
    secret: string,
    nowSeconds?: number,
  ) => { roomCode: string; playerId: string } | null;
}

function defaultRoomCode(): string {
  let code = "";

  for (let index = 0; index < 4; index += 1) {
    code += roomCodeAlphabet[randomInt(roomCodeAlphabet.length)];
  }

  return code;
}

function jsonResponse(
  statusCode: number,
  payload: Record<string, unknown>,
): HandlerResponse {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
    body: JSON.stringify(payload),
  };
}

function parseBody(event: Parameters<Handler>[0]): unknown {
  if (!event.body) {
    throw new GameRuleError("Request body is required.");
  }

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;

  if (Buffer.byteLength(rawBody, "utf8") > 16_384) {
    throw new GameRuleError("Request body is too large.");
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    throw new GameRuleError("Request body must be valid JSON.");
  }
}

function makePlayer(id: string, name: string, now: number): Player {
  return {
    id,
    name,
    joinedAt: now,
    lastSeen: now,
    active: true,
    score: 0,
  };
}

type GameCommand = Extract<ApiRequest, { action: "game" }>["command"];

function toGameAction(playerId: string, command: GameCommand): GameAction {
  switch (command.type) {
    case "heartbeat":
      return { type: "HEARTBEAT", playerId };

    case "leave":
      return { type: "LEAVE", playerId };

    case "start":
      return { type: "START_GAME", playerId };

    case "submitFake":
      return {
        type: "SUBMIT_FAKE",
        playerId,
        roundNumber: command.roundNumber,
        text: command.text,
      };

    case "submitVote":
      return {
        type: "SUBMIT_VOTE",
        playerId,
        roundNumber: command.roundNumber,
        optionId: command.optionId,
      };

    case "advance":
      return {
        type: "ADVANCE",
        playerId,
        roundNumber: command.roundNumber,
      };

    case "playAgain":
      return { type: "PLAY_AGAIN", playerId };
  }
}

export function createGameApiHandler(
  dependencies: Partial<ApiDependencies> = {},
): Handler {
  const deps: ApiDependencies = {
    createRoom: async (state) => {
      const { createRoom } = await import("./room-store");
      return createRoom(state);
    },
    loadRoom: async (roomCode) => {
      const { loadRoom } = await import("./room-store");
      return loadRoom(roomCode);
    },
    saveRoomState: async (roomCode, revision, state) => {
      const { saveRoomState } = await import("./room-store");
      return saveRoomState(roomCode, revision, state);
    },
    terms: [],
    tokenSecret: () => {
      const secret = process.env.PLAYER_TOKEN_SECRET?.trim();

      if (!secret || secret.length < 32) {
        throw new Error(
          "PLAYER_TOKEN_SECRET must contain at least 32 characters.",
        );
      }

      return secret;
    },
    now: () => Date.now(),
    newPlayerId: randomUUID,
    newRoomCode: defaultRoomCode,
    signToken: signPlayerToken,
    verifyToken: verifyPlayerToken,
    ...dependencies,
  };

  async function createRoomForPlayer(name: string) {
    // Validate configuration before creating any persistent room.
    const tokenSecret = deps.tokenSecret();
    const now = deps.now();
    const host = makePlayer(deps.newPlayerId(), name, now);

    for (let attempt = 0; attempt < MAX_ROOM_CREATE_ATTEMPTS; attempt += 1) {
      const roomCode = deps.newRoomCode();

      const state = createRoomState({
        roomCode,
        host,
        terms: deps.terms,
        now,
      });

      try {
        const stored = await deps.createRoom(state);
        const token = deps.signToken(
          { roomCode, playerId: host.id },
          tokenSecret,
          Math.floor(now / 1000),
        );

        return jsonResponse(201, {
          roomCode,
          token,
          view: getPlayerGameView(stored.state, host.id),
          serverTime: now,
        });
      } catch (error) {
        if (error instanceof RoomAlreadyExistsError) {
          continue;
        }

        throw error;
      }
    }

    throw new Error("Unable to allocate a unique room code.");
  }

  async function joinRoom(request: Extract<ApiRequest, { action: "join" }>) {
    const tokenSecret = deps.tokenSecret();
    let playerId: string;

    if (request.token) {
      const identity = deps.verifyToken(
        request.token,
        tokenSecret,
        Math.floor(deps.now() / 1000),
      );

      if (!identity || identity.roomCode !== request.roomCode) {
        return jsonResponse(401, { error: "Invalid or expired player token." });
      }

      playerId = identity.playerId;
    } else {
      playerId = deps.newPlayerId();
    }

    for (let attempt = 0; attempt < MAX_SAVE_ATTEMPTS; attempt += 1) {
      const stored = await deps.loadRoom(request.roomCode);

      if (
        request.token &&
        !stored.state.players.some((player) => player.id === playerId)
      ) {
        return jsonResponse(401, {
          error: "Player is not a member of this room.",
        });
      }

      const now = deps.now();
      const player = makePlayer(playerId, request.name, now);

      // Resolve expired deadlines before applying the join (ADR-002).
      const advanced = advanceGameState(stored.state, now, secureOrderOptions);

      let nextState: GameState;

      try {
        nextState = applyAction(
          advanced,
          { type: "JOIN", player },
          now,
          secureOrderOptions,
        );
      } catch (error) {
        if (
          !(error instanceof GameRuleError) ||
          advanced.version === stored.state.version
        ) {
          throw error;
        }

        // The join failed, but a deadline transition must not be discarded.
        const deadlineSave = await deps.saveRoomState(
          request.roomCode,
          stored.revision,
          advanced,
        );

        if (deadlineSave.status === "conflict") {
          continue;
        }

        return jsonResponse(400, {
          error: error.message,
          serverTime: now,
        });
      }

      const saved = await deps.saveRoomState(
        request.roomCode,
        stored.revision,
        nextState,
      );

      if (saved.status === "conflict") {
        continue;
      }

      const token = deps.signToken(
        { roomCode: request.roomCode, playerId },
        tokenSecret,
        Math.floor(now / 1000),
      );

      return jsonResponse(200, {
        roomCode: request.roomCode,
        token,
        view: getPlayerGameView(saved.room.state, playerId),
        serverTime: now,
      });
    }

    return jsonResponse(409, {
      error: "Room changed repeatedly. Please retry the request.",
    });
  }

  async function processGameAction(
    identity: { roomCode: string; playerId: string },
    command: GameCommand,
  ) {
    for (let attempt = 0; attempt < MAX_SAVE_ATTEMPTS; attempt += 1) {
      const stored = await deps.loadRoom(identity.roomCode);

      if (
        !stored.state.players.some((player) => player.id === identity.playerId)
      ) {
        return jsonResponse(401, {
          error: "Player is not a member of this room.",
        });
      }

      const now = deps.now();

      // Persist deadline-driven changes even if the requested action fails.
      const advanced = advanceGameState(stored.state, now, secureOrderOptions);

      let nextState: GameState;

      try {
        nextState = applyAction(
          advanced,
          toGameAction(identity.playerId, command),
          now,
          secureOrderOptions,
        );
      } catch (error) {
        if (
          !(error instanceof GameRuleError) ||
          advanced.version === stored.state.version
        ) {
          throw error;
        }

        const deadlineSave = await deps.saveRoomState(
          identity.roomCode,
          stored.revision,
          advanced,
        );

        if (deadlineSave.status === "conflict") {
          continue;
        }

        return jsonResponse(400, {
          error: error.message,
          view: getPlayerGameView(deadlineSave.room.state, identity.playerId),
          serverTime: now,
        });
      }

      // A routine heartbeat within 5 seconds of the persisted lastSeen
      // needs no database write: nothing else changed.
      const persistedPlayer = stored.state.players.find(
        (player) => player.id === identity.playerId,
      );

      const isRoutineHeartbeat =
        command.type === "heartbeat" &&
        persistedPlayer?.active === true &&
        now >= persistedPlayer.lastSeen &&
        now - persistedPlayer.lastSeen < 5_000 &&
        advanced.version === stored.state.version;

      if (isRoutineHeartbeat) {
        return jsonResponse(200, {
          roomCode: identity.roomCode,
          view: getPlayerGameView(nextState, identity.playerId),
          serverTime: now,
        });
      }

      const saved = await deps.saveRoomState(
        identity.roomCode,
        stored.revision,
        nextState,
      );

      if (saved.status === "conflict") {
        continue;
      }

      return jsonResponse(200, {
        roomCode: identity.roomCode,
        view: getPlayerGameView(saved.room.state, identity.playerId),
        serverTime: now,
      });
    }

    return jsonResponse(409, {
      error: "Room changed repeatedly. Please retry the request.",
    });
  }

  return async (event) => {
    if (event.httpMethod !== "POST") {
      return {
        ...jsonResponse(405, { error: "Use POST for this endpoint." }),
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          allow: "POST",
          "x-content-type-options": "nosniff",
        },
      };
    }

    try {
      const parsed = requestSchema.safeParse(parseBody(event));

      if (!parsed.success) {
        return jsonResponse(400, {
          error: parsed.error.issues[0]?.message ?? "Invalid request.",
        });
      }

      if (parsed.data.action === "create") {
        return await createRoomForPlayer(parsed.data.name);
      }

      if (parsed.data.action === "join") {
        return await joinRoom(parsed.data);
      }

      // Authenticate before reading or modifying the room.
      const tokenSecret = deps.tokenSecret();
      const identity = deps.verifyToken(
        parsed.data.token,
        tokenSecret,
        Math.floor(deps.now() / 1000),
      );

      if (!identity) {
        return jsonResponse(401, {
          error: "Invalid or expired player token.",
        });
      }

      // Process the authenticated action using the server-authoritative game state.
      return await processGameAction(identity, parsed.data.command);
    } catch (error) {
      if (error instanceof GameRuleError) {
        return jsonResponse(400, { error: error.message });
      }

      if (error instanceof RoomNotFoundError) {
        return jsonResponse(404, { error: "Room not found." });
      }

      // Do not send database errors, secrets, or stack traces to clients.
      console.error("Bluffstack API request failed.", error);

      return jsonResponse(500, {
        error: "An internal error occurred. Please retry.",
      });
    }
  };
}
