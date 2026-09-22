export function muteLiveEvent(eventId: string) {
  return { type: "session.input_audio.mute", event_id: eventId };
}

export function unmuteLiveEvent(eventId: string) {
  return { type: "session.input_audio.unmute", event_id: eventId };
}

export function closeLiveEvent(eventId: string) {
  return { type: "session.close", event_id: eventId };
}

export function captionFromLiveEvent(event: unknown): { speaker: "user" | "assistant"; text: string } | undefined {
  if (!event || typeof event !== "object") return undefined;
  const type = (event as { type?: unknown }).type;
  const delta = (event as { delta?: unknown }).delta;
  if (typeof type !== "string" || typeof delta !== "string" || !delta) return undefined;
  if (type === "session.input_transcript.delta") return { speaker: "user", text: delta };
  if (type === "session.output_transcript.delta") return { speaker: "assistant", text: delta };
  return undefined;
}

/** Accumulate both speakers' fragments; a speaker change starts a new line. */
export function accumulateLiveCaption(
  previous: string,
  incoming: { speaker: "user" | "assistant"; text: string },
): string {
  const prefix = incoming.speaker === "user" ? "You: " : "Milo: ";
  const prior = previous.startsWith(prefix) ? previous.slice(prefix.length) : "";
  return `${prefix}${prior}${incoming.text}`;
}

export function maySpeakOfficialVerdict(status?: string, spokenSummary?: string): boolean {
  return status === "completed" && Boolean(spokenSummary?.trim());
}
