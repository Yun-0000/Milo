export type Verdict = "supported" | "contradicted" | "partial" | "insufficient";

export type CheckStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type EvidenceKind = "fetched" | "search_only" | "blocked";

export interface Claim {
  id: string;
  text: string;
  priority: number;
  time?: string;
  place?: string;
  actor?: string;
  conditions?: string[];
  unchecked?: boolean;
  verdict?: Verdict;
  basis?: string;
  citationIds?: string[];
  quotes?: Array<{ sourceId: string; text: string }>;
}

export interface SourceEvidence {
  id: string;
  url: string;
  finalUrl: string;
  title: string;
  publishedAt?: string;
  fetchedAt: string;
  excerpt: string;
  body?: string;
  reason?: string;
  kind: EvidenceKind;
  claimIds: string[];
}

export interface CheckTask {
  id: string;
  status: CheckStatus;
  question: string;
  imageAttached: boolean;
  sourceUrl?: string;
  claims: Claim[];
  evidence: SourceEvidence[];
  createdAt: string;
  updatedAt: string;
  error?: string;
  spokenSummary?: string;
  voiceDelivery?: { status: "ready" | "failed"; sourceIds: string[] };
}

export interface CheckEvent {
  type: string;
  at: string;
  checkId: string;
  message?: string;
  claim?: Claim;
  evidence?: SourceEvidence;
  task?: CheckTask;
}

export interface CreateCheckRequest {
  question?: string;
  imageBase64?: string;
  imageMediaType?: string;
  url?: string;
  sessionId?: string;
}

export interface CheckMessageRequest {
  text: string;
}

export interface LiveSessionRequest {
  sdp?: string;
}

export interface LiveUnavailable {
  error: "LIVE_UNAVAILABLE";
  message: string;
}
