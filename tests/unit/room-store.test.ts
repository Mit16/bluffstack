import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRoomState } from "../../src/lib/game-engine";
import type { GameState, TechTerm } from "../../src/types/game";

vi.mock("../../netlify/functions/_shared/supabase", () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { getSupabaseAdmin } from "../../netlify/functions/_shared/supabase";
import {
  createRoom,
  loadRoom,
  saveRoomState,
  RoomAlreadyExistsError,
  RoomNotFoundError,
} from "../../netlify/functions/_shared/room-store";

const now = 1_800_000_000_000;

const terms: TechTerm[] = Array.from({ length: 5 }, (_, i) => ({
  id: `term-${i + 1}`,
  term: `Technology ${i + 1}`,
  definition: `Definition for technology ${i + 1}.`,
  sourceUrl: "https://example.com/technology",
}));

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

const query: Record<string, ReturnType<typeof vi.fn>> = {
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
};

query.select.mockImplementation(() => query);
query.eq.mockImplementation(() => query);

const rpc = vi.fn();
const from = vi.fn(() => query);
const admin = { rpc, from };

const mockedGetSupabaseAdmin = vi.mocked(getSupabaseAdmin);

function asJson(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}

beforeEach(() => {
  vi.clearAllMocks();

  query.select.mockImplementation(() => query);
  query.eq.mockImplementation(() => query);

  mockedGetSupabaseAdmin.mockReturnValue(admin as never);
});

describe("room-store persistence adapter", () => {
  it("creates a room and returns its initial revision and state", async () => {
    const state = makeState();

    rpc.mockResolvedValue({
      data: [{
        created_room_code: "ABCD",
        current_revision: 0,
        current_state: asJson(state),
      }],
      error: null,
    });

    const result = await createRoom(state);

    expect(result).toEqual({ state, revision: 0 });
    expect(rpc).toHaveBeenCalledWith("create_game_room", {
      p_room_code: "ABCD",
      p_state: asJson(state),
    });
  });

  it("reports a room-code collision when creation returns no rows", async () => {
    rpc.mockResolvedValue({ data: [], error: null });

    await expect(createRoom(makeState())).rejects.toBeInstanceOf(
      RoomAlreadyExistsError,
    );
  });

  it("surfaces database errors during room creation", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "database unavailable" },
    });

    await expect(createRoom(makeState())).rejects.toThrow(
      "Failed to create room: database unavailable",
    );
  });

  it("loads a room using its code and returns the stored revision", async () => {
    const state = makeState();

    query.maybeSingle.mockResolvedValue({
      data: {
        room_code: "ABCD",
        state: asJson(state),
        revision: 7,
      },
      error: null,
    });

    const result = await loadRoom("ABCD");

    expect(result).toEqual({ state, revision: 7 });
    expect(from).toHaveBeenCalledWith("game_rooms");
    expect(query.select).toHaveBeenCalledWith(
      "room_code,state,revision",
    );
    expect(query.eq).toHaveBeenCalledWith("room_code", "ABCD");
  });

  it("throws a not-found error when the room does not exist", async () => {
    query.maybeSingle.mockResolvedValue({
      data: null,
      error: null,
    });

    await expect(loadRoom("WXYZ")).rejects.toBeInstanceOf(
      RoomNotFoundError,
    );
  });

  it("rejects a stored row whose state has a mismatched room code", async () => {
    const state = makeState();

    query.maybeSingle.mockResolvedValue({
      data: {
        room_code: "WXYZ",
        state: asJson(state),
        revision: 0,
      },
      error: null,
    });

    await expect(loadRoom("WXYZ")).rejects.toThrow(
      "Database returned a mismatched room code.",
    );
  });

  it("saves state with the expected revision and returns the new revision", async () => {
    const state = makeState();

    rpc.mockResolvedValue({
      data: [{
        saved_revision: 8,
        saved_state: asJson(state),
      }],
      error: null,
    });

    const result = await saveRoomState("ABCD", 7, state);

    expect(result).toEqual({
      status: "saved",
      room: { state, revision: 8 },
    });
    expect(rpc).toHaveBeenCalledWith("save_game_room_state", {
      p_room_code: "ABCD",
      p_expected_revision: 7,
      p_state: asJson(state),
    });
  });

  it("returns a conflict when the expected revision is stale", async () => {
    rpc.mockResolvedValue({ data: [], error: null });

    const result = await saveRoomState("ABCD", 7, makeState());

    expect(result).toEqual({ status: "conflict" });
  });

  it("rejects invalid expected revisions before calling the database", async () => {
    await expect(
      saveRoomState("ABCD", -1, makeState()),
    ).rejects.toThrow(
      "Expected revision must be a non-negative safe integer.",
    );

    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects state being saved under a different room code", async () => {
    await expect(
      saveRoomState("WXYZ", 0, makeState()),
    ).rejects.toThrow("Room code does not match the state being saved.");

    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces database errors during state updates", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "write failed" },
    });

    await expect(
      saveRoomState("ABCD", 0, makeState()),
    ).rejects.toThrow("Failed to save room: write failed");
  });
});
