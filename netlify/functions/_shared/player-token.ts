import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
const MAX_TOKEN_LENGTH = 2048;

export interface PlayerTokenPayload {
  roomCode: string;
  playerId: string;
}

interface StoredTokenPayload extends PlayerTokenPayload {
  expiresAt: number;
}

function signature(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payload).digest();
}

export function signPlayerToken(
  identity: PlayerTokenPayload,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  if (secret.length < 32) {
    throw new Error("Player token secret must contain at least 32 characters.");
  }

  if (!/^[A-Z0-9]{4}$/.test(identity.roomCode)) {
    throw new Error("Invalid room code.");
  }

  if (
    typeof identity.playerId !== "string" ||
    identity.playerId.trim().length === 0 ||
    identity.playerId.length > 128
  ) {
    throw new Error("Invalid player ID.");
  }

  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) {
    throw new Error("Invalid token timestamp.");
  }

  const payload: StoredTokenPayload = {
    roomCode: identity.roomCode,
    playerId: identity.playerId,
    expiresAt: nowSeconds + TOKEN_LIFETIME_SECONDS,
  };

  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );

  const encodedSignature = signature(encodedPayload, secret).toString(
    "base64url",
  );

  return `${encodedPayload}.${encodedSignature}`;
}

export function verifyPlayerToken(
  token: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): PlayerTokenPayload | null {
  try {
    if (
      secret.length < 32 ||
      !Number.isSafeInteger(nowSeconds) ||
      nowSeconds < 0 ||
      typeof token !== "string" ||
      token.length === 0 ||
      token.length > MAX_TOKEN_LENGTH
    ) {
      return null;
    }

    const parts = token.split(".");

    if (
      parts.length !== 2 ||
      !/^[A-Za-z0-9_-]+$/.test(parts[0]!) ||
      !/^[A-Za-z0-9_-]+$/.test(parts[1]!)
    ) {
      return null;
    }

    const [encodedPayload, encodedSignature] = parts;
    const suppliedSignature = Buffer.from(encodedSignature!, "base64url");
    const expectedSignature = signature(encodedPayload!, secret);

    if (
      suppliedSignature.length !== expectedSignature.length ||
      !timingSafeEqual(suppliedSignature, expectedSignature)
    ) {
      return null;
    }

    const payload: unknown = JSON.parse(
      Buffer.from(encodedPayload!, "base64url").toString("utf8"),
    );

    if (
      typeof payload !== "object" ||
      payload === null ||
      !("roomCode" in payload) ||
      !("playerId" in payload) ||
      !("expiresAt" in payload)
    ) {
      return null;
    }

    const candidate = payload as Record<string, unknown>;

    if (
      typeof candidate.roomCode !== "string" ||
      !/^[A-Z0-9]{4}$/.test(candidate.roomCode) ||
      typeof candidate.playerId !== "string" ||
      candidate.playerId.trim().length === 0 ||
      candidate.playerId.length > 128 ||
      typeof candidate.expiresAt !== "number" ||
      !Number.isSafeInteger(candidate.expiresAt) ||
      candidate.expiresAt <= nowSeconds
    ) {
      return null;
    }

    return {
      roomCode: candidate.roomCode,
      playerId: candidate.playerId,
    };
  } catch {
    return null;
  }
}
