import { Router } from "express";
import { FailClosedError } from "../errors.js";
import { validImageInput } from "../imageInput.js";
import { runCheckPipeline } from "../pipeline.js";
import { addMessage, createCheck, deleteCheck, emitEvent, getCheck, listEvents, ownsCheck, subscribe } from "../store.js";

export const checksRouter = Router();
checksRouter.use("/:id", (request, response, next) => {
  if (!ownsCheck(String(request.params.id), response.locals.owner)) { response.status(404).json({ error: "Check not found" }); return; }
  next();
});

checksRouter.post("/", (request, response) => {
  const question = typeof request.body?.question === "string" ? request.body.question.trim() : "";
  const imageBase64 = typeof request.body?.imageBase64 === "string" ? request.body.imageBase64 : undefined;
  const imageMediaType = typeof request.body?.imageMediaType === "string" ? request.body.imageMediaType : "image/png";
  const url = typeof request.body?.url === "string" ? request.body.url.trim() : undefined;
  if (!question && !imageBase64) {
    response.status(400).json({ error: "A question or screenshot is required" });
    return;
  }
  if (question.length > 6000 || (url?.length ?? 0) > 2000 || !validImageInput(request.body?.imageBase64, imageMediaType)) {
    response.status(400).json({ error: "Invalid or oversized check input" }); return;
  }
  try {
  const task = createCheck({
    status: "queued",
    question: question || "Check the on-screen claim.",
    imageAttached: Boolean(imageBase64),
    sourceUrl: url,
  }, response.locals.owner);
  emitEvent(task.id, { type: "queued", message: "Check accepted." });
  void runCheckPipeline(task.id, {
    question: task.question,
    image: imageBase64 ? { data: imageBase64, mediaType: imageMediaType } : undefined,
    url,
  });
  response.status(202).json(task);
  } catch { response.status(409).json({ error: "A check is already running; cancel it first." }); }
});

checksRouter.get("/:id/events", (request, response) => {
  const task = getCheck(request.params.id);
  if (!task) {
    response.status(404).json({ error: "Check not found" });
    return;
  }
  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Cache-Control", "no-cache");
  response.setHeader("Connection", "keep-alive");
  response.setHeader("X-Accel-Buffering", "no");
  response.flushHeaders?.();
  let closed = false;
  const write = (event: { type: string }) => {
    if (closed) return;
    response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    if (event.type === "completed" || event.type === "failed" || event.type === "cancelled") {
      closed = true;
      response.end();
    }
  };
  for (const event of listEvents(task.id)) write(event);
  const unsubscribe = closed ? undefined : subscribe(task.id, write);
  const latest = getCheck(task.id);
  if (!closed && latest && ["completed", "failed", "cancelled"].includes(latest.status)) {
    for (const event of listEvents(task.id)) write(event);
  }
  const heartbeat = closed ? undefined : setInterval(() => { if (!closed) response.write(": keepalive\n\n"); }, 15_000);
  request.on("close", () => { clearInterval(heartbeat); unsubscribe?.(); });
});

checksRouter.post("/:id/messages", (request, response) => {
  const text = typeof request.body?.text === "string" ? request.body.text.trim() : "";
  if (!text) {
    response.status(400).json({ error: "Message text is required" });
    return;
  }
  if (text.length > 6000) { response.status(400).json({ error: "Message too long" }); return; }
  const task = addMessage(request.params.id, text);
  if (!task) {
    response.status(404).json({ error: "Check not found" });
    return;
  }
  emitEvent(task.id, { type: "message", message: text });
  response.json(task);
});

checksRouter.delete("/:id", (request, response) => {
  if (!deleteCheck(request.params.id)) {
    response.status(404).json({ error: "Check not found" });
    return;
  }
  response.status(204).end();
});

checksRouter.get("/:id", (request, response) => {
  const task = getCheck(request.params.id);
  if (!task) {
    response.status(404).json({ error: "Check not found" });
    return;
  }
  response.json(task);
});

export function failClosedPayload(error: unknown) {
  if (error instanceof FailClosedError) {
    return { status: error.status, body: { error: error.code, message: error.message } };
  }
  return undefined;
}
