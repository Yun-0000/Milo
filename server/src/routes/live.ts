import { Router } from "express";
import {
  assertBrowserOfferSdp,
  isPlaceholderSdp,
  prepareOfferSdp,
} from "../../../shared/liveProtocol.js";
import { createLiveSession } from "../openai.js";
import { publicApiFailure } from "../errors.js";
import { attachVoice, closeVoice, delegatedCheck, speakCheck, syncVoiceAttachment } from "../liveBridge.js";
import { ownsCheck } from "../store.js";
import { validImageInput } from "../imageInput.js";

export { prepareOfferSdp };

export const liveRouter = Router();

liveRouter.post("/sessions", async (request, response) => {
  const sdp = typeof request.body?.sdp === "string" ? prepareOfferSdp(request.body.sdp) : "";
  if (!sdp) {
    response.status(400).json({ error: "An SDP offer is required" });
    return;
  }
  try {
    assertBrowserOfferSdp(sdp);
  } catch (error) {
    response.status(400).json({
      error: isPlaceholderSdp(sdp) ? "PLACEHOLDER_SDP_REJECTED" : "INVALID_SDP_OFFER",
      message: error instanceof Error ? error.message : "Placeholder SDP is rejected",
    });
    return;
  }
  try {
    const result = await createLiveSession(sdp) as { session?: { id?: string } };
    if (!result.session?.id) throw new Error("Missing voice session ID");
    await attachVoice(result.session.id, response.locals.owner);
    response.status(201).json(result);
  } catch (error) {
    const failure = publicApiFailure(error);
    response.status(failure.status).json({ error: failure.code, message: failure.message });
  }
});

liveRouter.post("/sessions/:id/attachment", async (request, response) => {
  if (typeof request.body?.attached !== "boolean") {
    response.status(400).json({ error: "Invalid attachment state" }); return;
  }
  try {
    const accepted = await syncVoiceAttachment(String(request.params.id), response.locals.owner, request.body.attached);
    if (!accepted) { response.status(404).json({ error: "Voice session unavailable" }); return; }
    response.json({ ok: true });
  } catch { response.status(502).json({ error: "Voice did not accept the attachment state. Reconnect voice to retry." }); }
});

liveRouter.post("/sessions/:id/delegations", async (request, response) => {
  const { delegationId, imageBase64, imageMediaType } = request.body ?? {};
  if (typeof delegationId !== "string" || !delegationId || delegationId.length > 200 || !validImageInput(imageBase64, imageMediaType)) {
    response.status(400).json({ error: "Invalid delegation" }); return;
  }
  try {
    const task = await delegatedCheck(String(request.params.id), response.locals.owner, delegationId, imageBase64 ? { data: imageBase64, mediaType: imageMediaType } : undefined);
    if (!task) { response.status(409).json({ error: "Voice check is no longer available" }); return; }
    response.status(202).json(task);
  } catch { response.status(409).json({ error: "Could not start voice check; retry or use the check button." }); }
});

liveRouter.post("/sessions/:id/speak", async (request, response) => {
  const checkId = request.body?.checkId;
  if (typeof checkId !== "string" || !ownsCheck(checkId, response.locals.owner)) {
    response.status(404).json({ error: "Completed check or voice session not found" }); return;
  }
  const task = await speakCheck(String(request.params.id), response.locals.owner, checkId);
  if (!task) { response.status(404).json({ error: "Completed check or voice session not found" }); return; }
  response.status(task.voiceDelivery?.status === "ready" ? 200 : 502).json(task);
});

liveRouter.delete("/sessions/:id", (request, response) => {
  closeVoice(String(request.params.id), response.locals.owner);
  response.sendStatus(204);
});
