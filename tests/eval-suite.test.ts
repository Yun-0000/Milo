import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { Claim, SourceEvidence, Verdict } from "../shared/types.ts";
import { applyModelJudgment, matchReferenceVerdicts } from "../server/src/judgment.ts";

interface EvalCase {
  id: string;
  title: string;
  category: string;
  mode: "fixture" | "live-key";
  requiresLiveKey: boolean;
  fixture?: {
    claims: Claim[];
    evidence: SourceEvidence[];
    modelJudgment: { claims?: Array<Partial<Claim> & { id?: string }>; spokenSummary?: string };
  };
  reference?: { claims: Array<{ id: string; verdict: Verdict }> };
}

const catalog = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../eval/cases.json"), "utf8"),
) as { fixtureTargetMatches: number; cases: EvalCase[] };

const REQUIRED_CATEGORIES = [
  "mixed_true_false",
  "omitted_conditions",
  "stale_news",
  "missing_sources",
  "blurry_screenshot",
  "reprint_chain",
  "insufficient_evidence",
];

describe("eval suite (fixture mode, no live key)", () => {
  it("records at least 12 cases and marks live-key cases clearly", () => {
    assert.ok(catalog.cases.length >= 12, `expected >=12 cases, got ${catalog.cases.length}`);
    const live = catalog.cases.filter((item) => item.requiresLiveKey || item.mode === "live-key");
    assert.ok(live.length >= 1, "live-key cases must be present and marked");
    assert.ok(live.every((item) => item.requiresLiveKey && item.mode === "live-key"));
    const categories = new Set(catalog.cases.map((item) => item.category));
    for (const category of REQUIRED_CATEGORIES) {
      assert.ok(categories.has(category), `missing category ${category}`);
    }
  });

  it("matches at least 10 reference judgments without calling OpenAI", () => {
    const fixtureCases = catalog.cases.filter((item) => !item.requiresLiveKey && item.mode === "fixture");
    let matchedCases = 0;
    let matchedClaims = 0;
    for (const item of fixtureCases) {
      assert.ok(item.fixture && item.reference, `${item.id} needs fixture + reference`);
      const finalized = applyModelJudgment(item.fixture.claims, item.fixture.evidence, item.fixture.modelJudgment);
      const score = matchReferenceVerdicts(finalized.claims, item.reference.claims);
      if (score.matched) matchedCases += 1;
      matchedClaims += score.matches;
      assert.equal(score.mismatches.join("; "), "", item.id);
      const claimVerdicts = new Set(finalized.claims.map((claim) => claim.verdict ?? "insufficient"));
      for (const verdict of ["supported", "contradicted", "partial", "insufficient"] as const) {
        if (new RegExp(`\\b${verdict}\\b`, "i").test(finalized.spokenSummary)) {
          assert.ok(
            claimVerdicts.has(verdict),
            `${item.id} spokenSummary says ${verdict} but no claim has that verdict`,
          );
        }
      }
    }
    assert.ok(matchedCases >= catalog.fixtureTargetMatches, `matched ${matchedCases} cases`);
    assert.ok(matchedClaims >= 10, `matched ${matchedClaims} claim judgments`);
  });
});
