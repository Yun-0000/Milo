import type { Claim, SourceEvidence, Verdict } from "../../shared/types.js";
import { citationIssues, type CitationIssue } from "./citation.js";

export interface ModelJudgment {
  claims?: Array<Partial<Claim> & { id?: string }>;
  spokenSummary?: string;
}

export interface FinalizedJudgment {
  claims: Claim[];
  spokenSummary: string;
  citationIssues: CitationIssue[];
}

const VERDICTS: Verdict[] = ["supported", "contradicted", "partial", "insufficient"];

export function hasVerifiedQuotes(claim: Claim, evidence: SourceEvidence[]): boolean {
  return Boolean(claim.quotes?.length) && claim.quotes!.every((quote) => {
    const source = evidence.find((item) => item.id === quote.sourceId && item.kind === "fetched");
    return source && claim.citationIds?.includes(quote.sourceId) && Boolean(quote.text?.trim()) && (source.body ?? source.excerpt).includes(quote.text);
  });
}

function asVerdict(value: unknown): Verdict | undefined {
  return typeof value === "string" && VERDICTS.includes(value as Verdict) ? (value as Verdict) : undefined;
}

function usableFetchedEvidence(evidence: SourceEvidence[]): SourceEvidence[] {
  return evidence.filter(
    (item) => item.kind === "fetched" && Boolean(item.excerpt.replace(/\s+/g, " ").trim()),
  );
}

export function summaryFromClaims(claims: Claim[]): string {
  return claims.map((claim) => `${claim.verdict ?? "insufficient"}: ${claim.text.slice(0, 55)}. ${(claim.basis ?? "").slice(0, 50)}`).join(" ");
}

function mentionedVerdicts(summary: string): Set<Verdict> {
  const mentioned = new Set<Verdict>();
  for (const verdict of VERDICTS) {
    if (new RegExp(`\\b${verdict}\\b`, "i").test(summary)) mentioned.add(verdict);
  }
  return mentioned;
}

/** Official spoken text must not name a verdict the guarded claims do not have. */
export function spokenSummaryMatchesClaims(summary: string, claims: Claim[]): boolean {
  const text = summary.trim();
  if (!text) return false;
  const claimVerdicts = new Set(claims.map((claim) => claim.verdict ?? "insufficient"));
  const mentioned = mentionedVerdicts(text);
  if (!mentioned.size) {
    return ![...claimVerdicts].every((verdict) => verdict === "insufficient");
  }
  if (mentioned.size !== claimVerdicts.size) return false;
  for (const verdict of mentioned) {
    if (!claimVerdicts.has(verdict)) return false;
  }
  return true;
}

export function alignSpokenSummary(summary: string | undefined, claims: Claim[]): string {
  const trimmed = summary?.trim() ?? "";
  return spokenSummaryMatchesClaims(trimmed, claims) ? trimmed : summaryFromClaims(claims);
}

function excerptsAreReprints(evidence: SourceEvidence[]): boolean {
  const texts = usableFetchedEvidence(evidence)
    .map((item) => item.excerpt.replace(/\s+/g, " ").trim().slice(0, 160))
    .filter(Boolean);
  if (texts.length < 2) return false;
  return texts.every((text) => text === texts[0]);
}

export function applyEvidenceGuards(claims: Claim[], evidence: SourceEvidence[]): Claim[] {
  const fetched = usableFetchedEvidence(evidence);
  const reprints = excerptsAreReprints(evidence);
  return claims.map((claim) => {
    const next = { ...claim };
    if (next.unchecked) {
      next.verdict = "insufficient";
      next.basis = "Screenshot or claim text was too unclear to check.";
      next.citationIds = [];
      next.quotes = [];
      return next;
    }
    if (!fetched.length && next.verdict && next.verdict !== "insufficient") {
      next.verdict = "insufficient";
      next.basis = "No fetched pages; search snippets are not proof.";
      next.citationIds = [];
      next.quotes = [];
      return next;
    }
    if (
      reprints &&
      next.verdict === "supported" &&
      /independently confirmed|multiple (independent )?outlets|corroborated by several/i.test(
        `${next.text} ${next.basis ?? ""}`,
      )
    ) {
      next.verdict = "insufficient";
      next.basis = "Reprint chain: identical fetched excerpts are not independent confirmation.";
      next.citationIds = [];
      next.quotes = [];
    }
    return next;
  });
}

export function applyModelJudgment(
  claims: Claim[],
  evidence: SourceEvidence[],
  judged: ModelJudgment,
): FinalizedJudgment {
  const merged = claims.map((claim) => {
    const update = (Array.isArray(judged.claims) ? judged.claims : []).find((item) => item?.id === claim.id) ?? {};
    const verdict = asVerdict(update.verdict) ?? "insufficient";
    return {
      ...claim,
      basis: typeof update.basis === "string" ? update.basis.slice(0, 3000) : "No usable model judgment was returned.",
      citationIds: Array.isArray(update.citationIds) ? update.citationIds.filter((id) => typeof id === "string").slice(0, 8) : [],
      quotes: Array.isArray(update.quotes) ? update.quotes.filter((quote) => quote && typeof quote.sourceId === "string" && typeof quote.text === "string").slice(0, 8) : [],
      id: claim.id,
      text: claim.text,
      verdict,
    };
  });
  const guarded = applyEvidenceGuards(merged, evidence);
  const issues = citationIssues(guarded, evidence);
  if (issues.length) {
    for (const issue of issues) {
      const claim = guarded.find((item) => item.id === issue.claimId);
      if (claim) {
        claim.verdict = "insufficient";
        claim.basis = `Citation check: ${issue.reason}`;
        claim.citationIds = [];
        claim.quotes = [];
      }
    }
  }
  return {
    claims: guarded,
    spokenSummary: alignSpokenSummary(judged.spokenSummary, guarded),
    citationIssues: issues,
  };
}

export function matchReferenceVerdicts(
  finalized: Claim[],
  reference: Array<{ id: string; verdict: Verdict }>,
): { matched: boolean; matches: number; mismatches: string[] } {
  const mismatches: string[] = [];
  let matches = 0;
  for (const expected of reference) {
    const actual = finalized.find((claim) => claim.id === expected.id);
    if (actual?.verdict === expected.verdict) {
      matches += 1;
    } else {
      mismatches.push(`${expected.id}: expected ${expected.verdict}, got ${actual?.verdict ?? "none"}`);
    }
  }
  return { matched: mismatches.length === 0, matches, mismatches };
}
