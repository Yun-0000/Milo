import type { Claim, SourceEvidence } from "../../shared/types.js";

export interface CitationIssue {
  claimId: string;
  reason: string;
}

export function citationIssues(claims: Claim[], evidence: SourceEvidence[]): CitationIssue[] {
  const fetched = new Map(
    evidence
      .filter((item) => item.kind === "fetched" && Boolean(item.excerpt.replace(/\s+/g, " ").trim()))
      .map((item) => [item.id, item]),
  );
  const issues: CitationIssue[] = [];
  for (const claim of claims) {
    if (!claim.verdict || claim.verdict === "insufficient" || claim.unchecked) continue;
    const ids = claim.citationIds ?? [];
    if (!ids.length) {
      issues.push({ claimId: claim.id, reason: "supported/contradicted/partial claims need fetched citations" });
      continue;
    }
    for (const id of ids) {
      const source = fetched.get(id);
      if (!source) {
        issues.push({ claimId: claim.id, reason: `citation ${id} is not fetched evidence` });
      }
    }
  }
  return issues;
}
