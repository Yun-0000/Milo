import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyModelJudgment, hasVerifiedQuotes, summaryFromClaims } from "../server/src/judgment.ts";
import type { Claim, SourceEvidence } from "../shared/types.ts";

function evidence(partial: Partial<SourceEvidence> & Pick<SourceEvidence, "id" | "kind">): SourceEvidence {
  return {
    url: "https://science.nasa.gov/sky",
    finalUrl: "https://science.nasa.gov/sky",
    title: "NASA",
    fetchedAt: "2026-09-20T00:00:00Z",
    excerpt: "",
    claimIds: ["c1"],
    ...partial,
  };
}

describe("judgment spokenSummary alignment", () => {
  it("accepts only exact quotes from cited fetched bodies, including after a repair", () => {
    const source = evidence({ id: "f1", kind: "fetched", excerpt: "Publication", body: "Date Published: August 13, 2024" });
    const claim: Claim = { id: "c1", text: "Publication date", priority: 1, citationIds: ["f1"], quotes: [{ sourceId: "f1", text: "Published on August 13, 2024" }] };
    assert.equal(hasVerifiedQuotes(claim, [source]), false);
    claim.quotes![0].text = "Date Published: August 13, 2024";
    assert.equal(hasVerifiedQuotes(claim, [source]), true);
    assert.equal(hasVerifiedQuotes(claim, [{ ...source, kind: "search_only" }]), false);
    assert.equal(hasVerifiedQuotes({ ...claim, citationIds: [] }, [source]), false);
  });
  it("never speaks a rejected basis and places bounded verdicts before long claims", () => {
    const result = applyModelJudgment([{ id: "c1", text: "A".repeat(1000), priority: 1 }], [], {
      claims: [{ id: "c1", verdict: "supported", basis: "Definitely authentic and safe to act on.", citationIds: [] }],
    });
    assert.doesNotMatch(result.claims[0].basis!, /safe to act/);
    assert.match(summaryFromClaims(result.claims), /^insufficient:/);
    assert.ok(summaryFromClaims(result.claims).length < 150);
  });
  it("does not keep Supported when NASA sky-is-blue evidence is only search/blocked", () => {
    const claims: Claim[] = [{ id: "c1", text: "The sky is blue.", priority: 1 }];
    const finalized = applyModelJudgment(claims, [
      evidence({
        id: "s1",
        kind: "search_only",
        excerpt: "Why is the sky blue? Rayleigh scattering…",
      }),
      evidence({ id: "b1", kind: "blocked", excerpt: "" }),
    ], {
      claims: [
        {
          id: "c1",
          verdict: "supported",
          basis: "NASA science page.",
          citationIds: ["s1", "b1"],
        },
      ],
      spokenSummary: "Supported. NASA says the sky is blue.",
    });
    assert.equal(finalized.claims[0]?.verdict, "insufficient");
    assert.match(finalized.spokenSummary, /insufficient/i);
    assert.doesNotMatch(finalized.spokenSummary, /\bsupported\b/i);
  });

  it("does not treat an empty fetched excerpt as proof", () => {
    const claims: Claim[] = [{ id: "c1", text: "The sky is blue.", priority: 1 }];
    const finalized = applyModelJudgment(claims, [
      evidence({ id: "f1", kind: "fetched", excerpt: "   " }),
    ], {
      claims: [{ id: "c1", verdict: "supported", basis: "Fetched NASA URL.", citationIds: ["f1"] }],
      spokenSummary: "Supported",
    });
    assert.equal(finalized.claims[0]?.verdict, "insufficient");
    assert.doesNotMatch(finalized.spokenSummary, /\bsupported\b/i);
  });

  it("keeps a spokenSummary that matches guarded verdicts", () => {
    const claims: Claim[] = [
      { id: "c1", text: "WHO declared a pandemic in March 2020.", priority: 1 },
      { id: "c2", text: "WHO first declared a pandemic in 2022.", priority: 2 },
    ];
    const page = evidence({
      id: "f1",
      kind: "fetched",
      excerpt: "11 March 2020: WHO makes the assessment that COVID-19 can be characterized as a pandemic.",
    });
    const finalized = applyModelJudgment(claims, [page], {
      claims: [
        { id: "c1", verdict: "supported", basis: "WHO timeline.", citationIds: ["f1"] },
        { id: "c2", verdict: "contradicted", basis: "It was 2020.", citationIds: ["f1"] },
      ],
      spokenSummary: "March 2020 is supported; 2022 is contradicted.",
    });
    assert.equal(finalized.claims[0]?.verdict, "supported");
    assert.equal(finalized.claims[1]?.verdict, "contradicted");
    assert.equal(finalized.spokenSummary, "March 2020 is supported; 2022 is contradicted.");
  });
});
