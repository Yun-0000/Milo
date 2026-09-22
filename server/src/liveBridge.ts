import WebSocket from "ws";
import { openaiApiKey, openaiBaseUrl } from "./config.js";
import { cancelActiveChecks, checkSignal, createCheck, deleteCheck, emitEvent, getCheck, subscribe, updateCheck } from "./store.js";
import { runCheckPipeline } from "./pipeline.js";
import type { ImagePayload } from "./imagePayload.js";
import { appendAccepted, deliverVoiceEvidence } from "./voiceEvidence.js";
import type { CheckTask } from "../../shared/types.js";

interface VoiceSession {
  owner: string; socket: WebSocket; transcript: string; previousQuestion?: string;
  delegated: Map<string, { question: string; checkId?: string }>;
  activeCheck?: string; closed?: boolean; timer: NodeJS.Timeout; unsubscribe?: () => void;
}
const sessions = new Map<string, VoiceSession>();

export async function syncVoiceAttachment(id: string, owner: string, attached: boolean): Promise<boolean> {
  const session = sessions.get(id);
  if (!session || session.owner !== owner || session.closed) return false;
  // Metadata only: pixels stay in the browser until the user asks for a check.
  const context = attached
    ? "Current attachment state: an image is attached in Milo. It is available to your client-delegated research backend on the next request. If the user asks about this image or says 'check this', delegate now; the backend will read the image and return evidence. Do not ask them to upload again or type its contents. You have not visually inspected it yet; do not invent its contents."
    : "Current attachment state: no image is attached in Milo. This replaces any previous attachment state; an earlier image is no longer available for a new check. Spoken questions still work without an image.";
  await appendAccepted(session.socket, "session.thinking.append", [context], null, AbortSignal.timeout(15_000));
  return !session.closed;
}

export function closeVoice(id: string, owner: string): boolean {
  const session = sessions.get(id);
  if (!session || session.owner !== owner) return false;
  clearTimeout(session.timer);
  session.unsubscribe?.();
  // Ending audio does not cancel research or delete its sources.
  session.closed = true;
  sessions.delete(id);
  if (session.socket.readyState === WebSocket.OPEN) session.socket.send(JSON.stringify({ type: "session.close" }));
  session.socket.close();
  return true;
}

export async function attachVoice(id: string, owner: string): Promise<void> {
  for (const [otherId, session] of sessions) if (session.owner === owner) closeVoice(otherId, owner);
  const endpoint = `${openaiBaseUrl().replace(/^http/, "ws")}/live/sessions/${encodeURIComponent(id)}/attach`;
  const socket = new WebSocket(endpoint, { headers: { Authorization: `Bearer ${openaiApiKey()}` }, handshakeTimeout: 10_000, maxPayload: 2_000_000 });
  const session: VoiceSession = {
    owner, socket, transcript: "", delegated: new Map(),
    timer: setTimeout(() => closeVoice(id, owner), 10 * 60_000),
  };
  session.timer.unref();
  sessions.set(id, session);
  socket.on("message", (raw) => {
    try {
      const event = JSON.parse(String(raw));
      if (event.type === "session.input_transcript.delta" && typeof event.delta === "string") {
        session.transcript = (session.transcript + event.delta).slice(-6000);
      }
      if (event.type === "session.delegation.created" && event.delegation?.target === "client") {
        if (!session.delegated.has(event.delegation.id)) {
          session.delegated.set(event.delegation.id, { question: session.transcript.trim() });
          session.transcript = "";
          if (session.delegated.size > 32) session.delegated.delete(session.delegated.keys().next().value!);
        }
      }
      if (event.type === "session.closed") closeVoice(id, owner);
    } catch { /* Ignore malformed or reflected audio events. */ }
  });
  socket.on("error", () => closeVoice(id, owner));
  socket.on("close", () => closeVoice(id, owner));
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => { socket.off("open", ready); socket.off("error", failed); socket.off("close", failed); };
    const ready = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error("Live sideband unavailable")); };
    socket.once("open", ready);
    socket.once("error", failed);
    socket.once("close", failed);
  });
}

export async function delegatedCheck(id: string, owner: string, delegationId: string, image?: ImagePayload) {
  const session = sessions.get(id);
  if (!session || session.owner !== owner || session.socket.readyState !== WebSocket.OPEN) throw new Error("Voice session unavailable");
  // Both connections see the same event; permit brief transport ordering skew.
  for (let wait = 0; !session.delegated.has(delegationId) && wait < 20; wait++) await new Promise((resolve) => setTimeout(resolve, 50));
  if (!session.delegated.has(delegationId)) throw new Error("Unknown voice delegation");
  const delegation = session.delegated.get(delegationId)!;
  if (delegation.checkId) return getCheck(delegation.checkId);
  if (!delegation.question) { delegation.question = session.transcript.trim(); session.transcript = ""; }
  if (!delegation.question) throw new Error("No recognized user request yet; please repeat it");
  const question = session.previousQuestion
    ? `Earlier request (context only): ${session.previousQuestion}\nLatest request: ${delegation.question}`
    : delegation.question;
  // Explicit delegated follow-up supersedes research; ordinary speech interruption does not.
  if (session.activeCheck) deleteCheck(session.activeCheck);
  session.unsubscribe?.();
  cancelActiveChecks(owner);
  const task = createCheck({ status: "queued", question, imageAttached: Boolean(image) }, owner);
  session.activeCheck = task.id;
  delegation.checkId = task.id;
  session.previousQuestion = delegation.question;
  const send = (type: string, content: string) => {
    if (session.activeCheck !== task.id || session.socket.readyState !== WebSocket.OPEN) return;
    // Conservative character cap below 500 tokens even for Chinese text.
    session.socket.send(JSON.stringify({ type, delegation_id: delegationId, content: content.slice(0, 450) }));
  };
  session.unsubscribe = subscribe(task.id, (event) => {
    if (event.type === "completed") return;
    if (["failed", "cancelled"].includes(event.type)) send("session.commentary.append", "The check did not finish. No verified verdict is available.");
    else send("session.thinking.append", `Check ${task.id}: ${event.message ?? event.type}. No verified verdict yet.`);
  });
  emitEvent(task.id, { type: "queued", message: "Voice check accepted." });
  void runCheckPipeline(task.id, { question, image, deliverResult: async (result) => {
    if (session.activeCheck !== result.id) return;
    await deliverResult(session, result, delegationId);
  } });
  return task;
}

async function deliverResult(session: VoiceSession, task: CheckTask, delegationId: string | null) {
  if (session.closed) return getCheck(task.id);
  try {
    const sourceIds = await deliverVoiceEvidence(session.socket, task, delegationId, checkSignal(task.id));
    return updateCheck(task.id, { voiceDelivery: { status: "ready", sourceIds } });
  } catch {
    return updateCheck(task.id, { voiceDelivery: session.closed ? undefined : { status: "failed", sourceIds: [] } });
  }
}

export async function speakCheck(id: string, owner: string, checkId: string) {
  const session = sessions.get(id);
  const task = getCheck(checkId);
  if (!session || session.owner !== owner || !task || task.status !== "completed") return undefined;
  return deliverResult(session, task, null);
}
