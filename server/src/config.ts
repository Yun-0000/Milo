export const LIVE_MODEL = "gpt-live-1";
export const EVIDENCE_MODEL = "gpt-5.6-terra";
export const DEFAULT_PORT = 3000;
export const SESSION_TTL_MS = 15 * 60 * 1000;
export const MAX_CLAIMS = 3;
export const MAX_SEARCHES = 6;
export const MAX_FETCHES = 8;
export const PIPELINE_BUDGET_MS = 180_000;
export const FETCH_BYTE_LIMIT = 2_000_000;
export const MAX_REDIRECTS = 3;

export function openaiApiKey(): string | undefined {
  const key = process.env.OPENAI_API_KEY?.trim();
  return key || undefined;
}

export function openaiBaseUrl(): string {
  return (process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/$/, "");
}

export function listenPort(): number {
  const parsed = Number(process.env.PORT);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PORT;
}

export function listenHost(): string {
  return process.env.HOST?.trim() || "0.0.0.0";
}
