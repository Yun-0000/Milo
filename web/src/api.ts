import type { CheckTask } from "../../shared/types";
import { assertBrowserOfferSdp } from "../../shared/liveProtocol";

export async function createCheck(body: {
  question: string;
  imageBase64?: string;
  imageMediaType?: string;
  url?: string;
}): Promise<CheckTask> {
  const response = await fetch("/api/checks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message || payload.error || "Check failed");
  return payload as CheckTask;
}

export async function cancelCheck(id: string): Promise<void> {
  const response = await fetch(`/api/checks/${id}`, { method: "DELETE", signal: AbortSignal.timeout(10_000) });
  if (!response.ok && response.status !== 404) throw new Error("Could not cancel check");
}

export function subscribeCheckEvents(id: string, onEvent: (event: MessageEvent) => void): EventSource {
  const source = new EventSource(`/api/checks/${id}/events`);
  for (const type of ["queued", "started", "claims", "searching", "fetching", "evidence", "reasoning", "completed", "failed", "cancelled", "message"]) {
    source.addEventListener(type, onEvent);
  }
  return source;
}

export async function startLiveSession(sdp: string): Promise<Response> {
  assertBrowserOfferSdp(sdp);
  return fetch("/api/live/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sdp }),
    signal: AbortSignal.timeout(45_000),
  });
}

export async function syncLiveAttachment(sessionId: string, attached: boolean): Promise<void> {
  const response = await fetch(`/api/live/sessions/${encodeURIComponent(sessionId)}/attachment`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ attached }), signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error("Image state could not reach voice. Reconnect voice to retry.");
}
