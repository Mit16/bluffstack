import type { VoteOption } from "../../../src/types/game";
import type { OrderOptions } from "../../../src/lib/game-engine";

const UINT32_RANGE = 0x1_0000_0000;

/**
 * Returns an unbiased random integer in [0, maxExclusive).
 */
function secureRandomInt(maxExclusive: number): number {
  if (
    !Number.isSafeInteger(maxExclusive) ||
    maxExclusive < 1 ||
    maxExclusive > UINT32_RANGE
  ) {
    throw new RangeError("Invalid random integer range.");
  }

  const limit = Math.floor(UINT32_RANGE / maxExclusive) * maxExclusive;

  const buffer = new Uint32Array(1);

  while (true) {
    globalThis.crypto.getRandomValues(buffer);
    const value = buffer[0]!;

    if (value < limit) {
      return value % maxExclusive;
    }
  }
}

/**
 * Secure Fisher-Yates shuffle.
 * Returns a new array and never mutates the input.
 */
export function secureShuffle<T>(items: readonly T[]): T[] {
  const shuffled = [...items];

  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = secureRandomInt(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }

  return shuffled;
}

/**
 * Compatible with the game engine's injected ordering callback.
 * The seed is intentionally ignored because each round gets a fresh
 * cryptographically secure shuffle.
 */
export const secureOrderOptions: OrderOptions = (
  options: VoteOption[],
  _seed: string,
): VoteOption[] => secureShuffle(options);
