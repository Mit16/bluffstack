import techTerms from "../../data/techTerms.json";
import type { TechTerm } from "../../src/types/game";
import { createGameApiHandler } from "./_shared/game-api";

export const handler = createGameApiHandler({
  terms: techTerms as TechTerm[],
});
