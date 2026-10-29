import { describe, expect, it, vi } from "vitest";
import type { Handler, HandlerResponse } from "@netlify/functions";
import { createRoomState } from "../../src/lib/game-engine";
import type { GameState, TechTerm } from "../../src/types/game";
import { RoomNotFoundError } from "../../netlify/functions/_shared/room-store";
import { createGameApiHandler } from "../../netlify/functions/_shared/game-api";

const terms: TechTerm[] = Array.from({ length: 5 }, (_, index) => ({
  id: `term-${index + 1}`,
  term: `Technology ${index + 1}`,
  definition: `A definition for technology ${index + 1}.`,
  sourceUrl: "https://example.com/technology",
}));

const now = 1_800_000_000_000;
const tokenSecret = "test-only-secret-with-at-least-32-characters";

function makeState(): GameState {
  return createRoomState({
    roomCode: "ABCD",
    host: {
      id: "player-host",
      name: "Host",
      joinedAt: now,
      lastSeen: now,
      active: true,
      score: 0,
    },
    terms,
    now,
  });
}

function makeHandler(overrides: Record<string, unknown> = {}) {
  const state = makeState();

  const dependencies = {
    terms,
    now: () => now,
    newPlayerId: () => "player-new",
    newRoomCode: () => "ABCD",
    tokenSecret: () => tokenSecret,
    signToken: vi.fn(
      ({ playerId }: { roomCode: string; playerId: string }) =>
        `signed-${playerId}`,
    ),
    verifyToken: vi.fn(() => null),
    createRoom: vi.fn(async (nextState: GameState) => ({
      state: nextState,
      revision: 0,
    })),
    loadRoom: vi.fn(async () => ({ state, revision: 0 })),
    saveRoomState: vi.fn(
      async (_roomCode: string, _revision: number, nextState: GameState) => ({
        status: "saved" as const,
        room: { state: nextState, revision: 1 },
      }),
    ),
    ...overrides,
  };

  return {
    handler: createGameApiHandler(dependencies as never),
    dependencies,
    state,
  };
}

async function callApi(
  handler: Handler,
  body: unknown,
  method = "POST",
): Promise<HandlerResponse> {
  const event = {
    httpMethod: method,
    body: typeof body === "string" ? body : JSON.stringify(body),
    isBase64Encoded: false,
  } as Parameters<Handler>[0];

  const response = await handler(event, {} as Parameters<Handler>[1]);

  if (!response) {
    throw new Error("API handler returned no response.");
  }

  return response;
}

describe("game API: room creation and joining", () => {
  it("rejects a game action without a player token", async () => {
    const { handler, dependencies } = makeHandler();

    const response = await callApi(handler, {
      action: "game",
      command: { type: "heartbeat" },
    });

    expect(response.statusCode).toBe(400);
    expect(dependencies.loadRoom).not.toHaveBeenCalled();
    expect(dependencies.saveRoomState).not.toHaveBeenCalled();
  });

  it("rejects an invalid token without loading or changing the room", async () => {
    const { handler, dependencies } = makeHandler();

    const response = await callApi(handler, {
      action: "game",
      token: "invalid-token",
      command: { type: "heartbeat" },
    });

    expect(response.statusCode).toBe(401);
    expect(dependencies.loadRoom).not.toHaveBeenCalled();
    expect(dependencies.saveRoomState).not.toHaveBeenCalled();
  });

  it("authenticates a heartbeat and returns a safe player view", async () => {
    const { handler, dependencies, state } = makeHandler({
      verifyToken: vi.fn(() => ({
        roomCode: "ABCD",
        playerId: "player-host",
      })),
    });

    const response = await callApi(handler, {
      action: "game",
      token: "valid-test-token",
      command: { type: "heartbeat" },
    });

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body ?? "{}");

    expect(body.roomCode).toBe("ABCD");
    expect(body.view.viewerPlayerId).toBe("player-host");
    expect(body.view.terms).toBeUndefined();
    expect(dependencies.loadRoom).toHaveBeenCalledTimes(1);
    expect(dependencies.saveRoomState).not.toHaveBeenCalled();

    // A routine heartbeat updates lastSeen without a public state version bump.
    expect(body.view.version).toBe(state.version);
  });

  it("persists a heartbeat when five seconds have elapsed", async () => {
    const { handler, dependencies } = makeHandler({
      now: vi.fn(() => 1_800_000_005_000),
      verifyToken: vi.fn(() => ({
        roomCode: "ABCD",
        playerId: "player-host",
      })),
    });

    const response = await callApi(handler, {
      action: "game",
      token: "valid-test-token",
      command: { type: "heartbeat" },
    });

    expect(response.statusCode).toBe(200);
    expect(dependencies.saveRoomState).toHaveBeenCalledTimes(1);
  });

  it("persists a heartbeat when it reactivates an inactive player", async () => {
    const { handler, dependencies, state } = makeHandler({
      verifyToken: vi.fn(() => ({
        roomCode: "ABCD",
        playerId: "player-host",
      })),
    });

    const host = state.players.find((player) => player.id === "player-host");

    if (!host) {
      throw new Error("Expected host player in test state");
    }

    host.active = false;

    const response = await callApi(handler, {
      action: "game",
      token: "valid-test-token",
      command: { type: "heartbeat" },
    });

    expect(response.statusCode).toBe(200);
    expect(dependencies.saveRoomState).toHaveBeenCalledTimes(1);
  });

  it("rejects an unknown game command", async () => {
    const { handler, dependencies } = makeHandler();

    const response = await callApi(handler, {
      action: "game",
      token: "some-token",
      command: { type: "make-me-admin" },
    });

    expect(response.statusCode).toBe(400);
    expect(dependencies.loadRoom).not.toHaveBeenCalled();
  });

  it("creates a room and returns a signed host token and safe view", async () => {
    const { handler, dependencies } = makeHandler();

    const response = await callApi(handler, {
      action: "create",
      name: "Host Player",
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body ?? "{}");

    expect(body.roomCode).toBe("ABCD");
    expect(body.token).toBe("signed-player-new");
    expect(body.view.viewerPlayerId).toBe("player-new");
    expect(body.view.phase).toBe("LOBBY");
    expect(body.view.terms).toBeUndefined();
    expect(dependencies.createRoom).toHaveBeenCalledTimes(1);
  });

  it("does not create a room when the player-token secret is invalid", async () => {
    const { handler, dependencies } = makeHandler({
      tokenSecret: vi.fn(() => {
        throw new Error(
          "PLAYER_TOKEN_SECRET must contain at least 32 characters.",
        );
      }),
    });

    const response = await callApi(handler, {
      action: "create",
      name: "Host Player",
    });

    expect(response.statusCode).toBe(500);
    expect(dependencies.createRoom).not.toHaveBeenCalled();
  });

  it("rejects an invalid player name", async () => {
    const { handler, dependencies } = makeHandler();

    const response = await callApi(handler, {
      action: "create",
      name: "x",
    });

    expect(response.statusCode).toBe(400);
    expect(dependencies.createRoom).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON", async () => {
    const { handler } = makeHandler();
    const response = await callApi(handler, "{not-json");

    expect(response.statusCode).toBe(400);
  });

  it("allows only POST requests", async () => {
    const { handler } = makeHandler();
    const response = await callApi(handler, {}, "GET");

    expect(response.statusCode).toBe(405);
    expect(response.headers?.allow).toBe("POST");
  });

  it("joins an existing room and saves the new player", async () => {
    const { handler, dependencies } = makeHandler();

    const response = await callApi(handler, {
      action: "join",
      roomCode: "abcd",
      name: "New Player",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body ?? "{}");

    expect(body.roomCode).toBe("ABCD");
    expect(body.token).toBe("signed-player-new");
    expect(body.view.players).toHaveLength(2);
    expect(dependencies.saveRoomState).toHaveBeenCalledTimes(1);
  });

  it("rejects a bad token without loading or changing the room", async () => {
    const { handler, dependencies } = makeHandler();

    const response = await callApi(handler, {
      action: "join",
      roomCode: "ABCD",
      name: "Returning Player",
      token: "invalid-token",
    });

    expect(response.statusCode).toBe(401);
    expect(dependencies.loadRoom).not.toHaveBeenCalled();
    expect(dependencies.saveRoomState).not.toHaveBeenCalled();
  });

  it("returns 404 when the requested room does not exist", async () => {
    const { handler } = makeHandler({
      loadRoom: vi.fn(async () => {
        throw new RoomNotFoundError("WXYZ");
      }),
    });

    const response = await callApi(handler, {
      action: "join",
      roomCode: "WXYZ",
      name: "New Player",
    });

    expect(response.statusCode).toBe(404);
  });

  it("retries a stale database revision and returns 409 after repeated conflicts", async () => {
    const { handler, dependencies } = makeHandler({
      saveRoomState: vi.fn(async () => ({ status: "conflict" as const })),
    });

    const response = await callApi(handler, {
      action: "join",
      roomCode: "ABCD",
      name: "New Player",
    });

    expect(response.statusCode).toBe(409);
    expect(dependencies.saveRoomState).toHaveBeenCalledTimes(3);
  });
});
