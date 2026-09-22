export class FailClosedError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(code: string, message: string, status = 503) {
    super(message);
    this.name = "FailClosedError";
    this.code = code;
    this.status = status;
  }
}

export const LIVE_UNAVAILABLE_MESSAGE =
  "Set OPENAI_API_KEY. Milo requires GPT-Live gpt-live-1 and will not fall back to Realtime or fake a voice path.";

export const EVIDENCE_UNAVAILABLE_MESSAGE =
  "Set OPENAI_API_KEY. The evidence pipeline will not invent sources or treat model memory as evidence.";

// Only expose fixed messages, never an SDK error containing request data or credentials.
export function publicApiFailure(error: unknown): { status: number; code: string; message: string } {
  if (error instanceof FailClosedError) return { status: error.status, code: error.code, message: error.message };
  const upstream = error as { status?: number; code?: string } | null;
  if (["credit_balance_exhausted", "insufficient_quota"].includes(upstream?.code ?? "")) {
    return { status: 429, code: "API_CREDITS_EXHAUSTED", message: "OpenAI API credits are exhausted. Add credits in OpenAI billing, then retry." };
  }
  if (upstream?.status === 429) return { status: 429, code: "API_RATE_LIMITED", message: "OpenAI is rate-limiting requests. Wait briefly, then retry." };
  if (upstream?.status === 401) return { status: 503, code: "API_AUTH_FAILED", message: "OpenAI rejected the server API key. Update the server configuration." };
  if (upstream?.status === 403 || upstream?.code === "model_not_found") return { status: 503, code: "API_ACCESS_DENIED", message: "The server API key cannot access the configured model. Check its project permissions." };
  return { status: 502, code: "API_UNAVAILABLE", message: "The AI service could not complete this request. Please retry." };
}
