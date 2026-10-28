import { describe, expect, it } from "vitest";
import {
  secureOrderOptions,
  secureShuffle,
} from "../../netlify/functions/_shared/secure-shuffle";
import type { VoteOption } from "../../src/types/game";

describe("secure shuffle", () => {
  it("returns every input item exactly once", () => {
    const input = ["alpha", "bravo", "charlie", "delta"];

    const result = secureShuffle(input);

    expect(result).toHaveLength(input.length);
    expect([...result].sort()).toEqual([...input].sort());
    expect(new Set(result).size).toBe(input.length);
  });

  it("does not mutate the input array", () => {
    const input = [1, 2, 3, 4, 5];
    const original = [...input];

    secureShuffle(input);

    expect(input).toEqual(original);
  });

  it("supports the engine's option-order callback", () => {
    const options: VoteOption[] = [
      {
        id: "real-1",
        text: "The real definition",
        authorPlayerId: null,
        isReal: true,
      },
      {
        id: "fake-1-1",
        text: "A fake definition",
        authorPlayerId: "p1",
        isReal: false,
      },
    ];

    const result = secureOrderOptions(options, "AB12:1");

    expect(result).toHaveLength(2);
    expect(result.map((option) => option.id).sort()).toEqual([
      "fake-1-1",
      "real-1",
    ]);
    expect(options[0]?.id).toBe("real-1");
  });

  it("handles an empty or single-item array", () => {
    expect(secureShuffle([])).toEqual([]);
    expect(secureShuffle(["only"])).toEqual(["only"]);
  });
});
