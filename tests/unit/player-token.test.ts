import { describe, expect, it } from "vitest";
import {
  signPlayerToken,
  verifyPlayerToken,
} from "../../netlify/functions/_shared/player-token";

const SECRET = "test-secret-that-is-long-enough-for-unit-tests-123456";
const NOW = 1_798_000_000;

describe("signed player tokens", () => {
  it("signs and verifies a player's identity", () => {
    const token = signPlayerToken(
      { roomCode: "AB12", playerId: "player-1" },
      SECRET,
      NOW,
    );

    expect(verifyPlayerToken(token, SECRET, NOW)).toEqual({
      roomCode: "AB12",
      playerId: "player-1",
    });
  });

  it("rejects a token with a modified payload", () => {
    const token = signPlayerToken(
      { roomCode: "AB12", playerId: "player-1" },
      SECRET,
      NOW,
    );

    const [payload, signature] = token.split(".");
    const modified = `${payload!.slice(0, -1)}X.${signature}`;

    expect(verifyPlayerToken(modified, SECRET, NOW)).toBeNull();
  });

  it("rejects a token signed with another secret", () => {
    const token = signPlayerToken(
      { roomCode: "AB12", playerId: "player-1" },
      SECRET,
      NOW,
    );

    expect(
      verifyPlayerToken(token, "a-different-secret-value", NOW),
    ).toBeNull();
  });

  it("rejects expired tokens", () => {
    const token = signPlayerToken(
      { roomCode: "AB12", playerId: "player-1" },
      SECRET,
      NOW,
    );

    expect(
      verifyPlayerToken(token, SECRET, NOW + 31 * 24 * 60 * 60),
    ).toBeNull();
  });

  it("rejects malformed tokens", () => {
    expect(verifyPlayerToken("not-a-token", SECRET, NOW)).toBeNull();
    expect(verifyPlayerToken("", SECRET, NOW)).toBeNull();
  });
});
