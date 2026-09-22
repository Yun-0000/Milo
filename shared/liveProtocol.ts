export const REJECTED_PLACEHOLDER_SDP =
  "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n";

export const LIVE_DATA_CHANNEL = "oai-events";

export function normalizeSdp(sdp: string): string {
  return sdp.replace(/\r\n/g, "\n").trim();
}

/** OpenAI live.create fails to unmarshal SDP that does not end with a newline. */
export function ensureSdpEndsWithNewline(sdp: string): string {
  if (!sdp || /(?:\r\n|\n|\r)$/.test(sdp)) return sdp;
  return `${sdp}\r\n`;
}

/**
 * Prepare a browser offer for Live. Strip only a leading BOM / leading whitespace.
 * Do not trim trailing newlines — that produced `failed to unmarshal SDP: EOF`.
 */
export function prepareOfferSdp(sdp: string): string {
  return ensureSdpEndsWithNewline(sdp.replace(/^(?:\uFEFF|\s)+/, ""));
}

export function isPlaceholderSdp(sdp: string): boolean {
  const normalized = normalizeSdp(sdp);
  if (!normalized) return true;
  const known = normalizeSdp(REJECTED_PLACEHOLDER_SDP);
  if (normalized === known) return true;
  const noMedia = !/^m=/im.test(normalized);
  return noMedia && /o=- 0 0 IN IP4 127\.0\.0\.1/.test(normalized);
}

export function isBrowserWebRtcOffer(sdp: string): boolean {
  const normalized = normalizeSdp(sdp);
  return /m=audio/i.test(normalized) && /a=fingerprint/i.test(normalized);
}

export function assertBrowserOfferSdp(sdp: string): void {
  if (!sdp?.trim()) {
    throw new Error("An SDP offer is required");
  }
  if (isPlaceholderSdp(sdp) || !isBrowserWebRtcOffer(sdp)) {
    throw new Error(
      "Placeholder SDP is rejected. Send a real RTCPeerConnection offer with m=audio and a fingerprint.",
    );
  }
}

export function liveAnswerSdp(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as { transport?: { sdp?: unknown }; sdp?: unknown };
  if (typeof record.transport?.sdp === "string" && record.transport.sdp.trim()) {
    return record.transport.sdp;
  }
  if (typeof record.sdp === "string" && record.sdp.trim()) return record.sdp;
  return undefined;
}

export function liveSessionId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const id = (payload as { session?: { id?: unknown } }).session?.id;
  return typeof id === "string" && id.trim() ? id : undefined;
}

export function isLiveUnavailable(status: number, payload: unknown): boolean {
  if (status !== 503) return false;
  if (!payload || typeof payload !== "object") return false;
  return (payload as { error?: unknown }).error === "LIVE_UNAVAILABLE";
}
