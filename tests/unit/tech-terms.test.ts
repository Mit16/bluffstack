import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const catalogPath = new URL("../../data/techTerms.json", import.meta.url);

function loadCatalog(): unknown {
  const raw = readFileSync(catalogPath, "utf8");

  if (!raw.trim()) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const catalog = loadCatalog();

describe("technology term catalog", () => {
  it("contains a valid JSON array", () => {
    expect(Array.isArray(catalog)).toBe(true);
  });

  it("contains exactly 25 terms", () => {
    expect(Array.isArray(catalog) ? catalog.length : 0).toBe(25);
  });

  it("has unique IDs and complete term fields", () => {
    const terms = Array.isArray(catalog) ? catalog : [];

    const ids = terms.map((term) => term?.id);

    expect(ids.every((id) => typeof id === "string" && id.trim())).toBe(true);
    expect(new Set(ids).size).toBe(25);

    for (const term of terms) {
      expect(typeof term.term).toBe("string");
      expect(term.term.trim().length).toBeGreaterThan(0);

      expect(typeof term.definition).toBe("string");
      expect(term.definition.trim().length).toBeGreaterThanOrEqual(20);

      expect(typeof term.sourceUrl).toBe("string");
      expect(() => new URL(term.sourceUrl)).not.toThrow();
      expect(new URL(term.sourceUrl).protocol).toBe("https:");
    }
  });

  it("does not contain duplicate term names", () => {
    const terms = Array.isArray(catalog) ? catalog : [];
    const names = terms.map((term) =>
      typeof term.term === "string" ? term.term.trim().toLowerCase() : "",
    );

    expect(new Set(names).size).toBe(25);
  });
});
