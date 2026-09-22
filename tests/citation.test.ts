import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { citationIssues } from "../server/src/citation.ts";

describe("citation check", () => {
  it("rejects search snippets as proof", () => {
    const issues = citationIssues(
      [{ id: "c1", text: "claim", priority: 1, verdict: "supported", citationIds: ["s1"] }],
      [
        {
          id: "s1",
          url: "https://example.com",
          finalUrl: "https://example.com",
          title: "Example",
          fetchedAt: "2026-09-19T00:00:00Z",
          excerpt: "snippet",
          kind: "search_only",
          claimIds: ["c1"],
        },
      ],
    );
    assert.equal(issues.length, 1);
  });

  it("accepts fetched evidence and allows insufficient without citations", () => {
    const issues = citationIssues(
      [
        { id: "c1", text: "claim", priority: 1, verdict: "contradicted", citationIds: ["f1"] },
        { id: "c2", text: "other", priority: 2, verdict: "insufficient" },
      ],
      [
        {
          id: "f1",
          url: "https://example.com/notice",
          finalUrl: "https://example.com/notice",
          title: "Notice",
          fetchedAt: "2026-09-19T00:00:00Z",
          excerpt: "denied",
          kind: "fetched",
          claimIds: ["c1"],
        },
      ],
    );
    assert.equal(issues.length, 0);
  });

  it("rejects fetched citations with no usable excerpt", () => {
    const issues = citationIssues(
      [{ id: "c1", text: "claim", priority: 1, verdict: "supported", citationIds: ["f1"] }],
      [
        {
          id: "f1",
          url: "https://science.nasa.gov/sky",
          finalUrl: "https://science.nasa.gov/sky",
          title: "NASA",
          fetchedAt: "2026-09-20T00:00:00Z",
          excerpt: "  ",
          kind: "fetched",
          claimIds: ["c1"],
        },
      ],
    );
    assert.equal(issues.length, 1);
  });
});
