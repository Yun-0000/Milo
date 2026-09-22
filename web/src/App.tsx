import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CheckEvent, CheckTask, SourceEvidence } from "../../shared/types";
import { maySpeakOfficialVerdict } from "../../shared/voiceControl";
import { cancelCheck, createCheck, subscribeCheckEvents, syncLiveAttachment } from "./api";
import { ScreenshotCheck } from "./components/ScreenshotCheck";
import { CheckResult } from "./components/CheckResult";
import { VoiceChat } from "./components/VoiceChat";
import { readImageFile } from "./capture";
import type { LivePeer } from "./liveWebrtc";
import { Icon } from "./components/Icon";
import { openFloatingAssistant } from "./floating";

export function App() {
  const [question, setQuestion] = useState("");
  const [image, setImage] = useState<{ imageBase64: string; imageMediaType: string }>();
  const [task, setTask] = useState<CheckTask>();
  const [evidence, setEvidence] = useState<SourceEvidence[]>([]);
  const [readingImage, setReadingImage] = useState(false);
  const imageRevision = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sourceRef = useRef<EventSource | null>(null);
  const livePeerRef = useRef<LivePeer | null>(null);
  const [voiceSessionId, setVoiceSessionId] = useState<string>();
  const [attachmentSync, setAttachmentSync] = useState<"syncing" | "ready" | "failed">();
  const attachmentQueue = useRef(Promise.resolve());
  const spokenVerdictKeyRef = useRef("");
  const activeIdRef = useRef("");
  const requestRevision = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const voiceCheckIds = useRef(new Set<string>());
  const [accessNeeded, setAccessNeeded] = useState(false);
  const [accessCode, setAccessCode] = useState("");
  const [panel, setPanel] = useState<"ask" | "screenshot" | null>(null);
  const [textMode, setTextMode] = useState(false);
  const [stopSignal, setStopSignal] = useState(0);
  const [isFloating, setIsFloating] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  const [voicePreview, setVoicePreview] = useState(() => new URLSearchParams(window.location.search).get("preview") === "voice");
  const [opening, setOpening] = useState(false);
  const [host] = useState(() => document.createElement("div"));
  const homeRef = useRef<HTMLDivElement>(null);
  const floatRef = useRef<Window | null>(null);
  useEffect(() => { void fetch("/api/session").then((response) => setAccessNeeded(response.status === 401)).catch(() => setError("Could not connect. Refresh to retry.")); }, []);
  useEffect(() => { host.className = "assistant-host"; homeRef.current?.append(host); return () => { floatRef.current?.close(); host.remove(); }; }, [host]);
  useEffect(() => {
    let stale = false;
    setAttachmentSync(voiceSessionId && image ? "syncing" : undefined);
    if (!voiceSessionId) return;
    // Serialize changes so a slow attach acknowledgment cannot overwrite a removal.
    attachmentQueue.current = attachmentQueue.current.then(async () => {
      if (stale) return;
      await syncLiveAttachment(voiceSessionId, Boolean(image));
      if (!stale) setAttachmentSync(image ? "ready" : undefined);
    }).catch(() => {
      if (!stale) { setAttachmentSync("failed"); setError("Image state could not reach voice. Reconnect voice to retry."); }
    });
    return () => { stale = true; };
  }, [image, voiceSessionId]);
  const openFloat = async () => {
    if (floatRef.current && !floatRef.current.closed) { floatRef.current.focus(); return; }
    if (!homeRef.current || opening) return;
    setOpening(true); setError("");
    try {
      const requestedAt = Date.now();
      const floating = await openFloatingAssistant(host, homeRef.current, () => {
        setIsFloating(false); floatRef.current = null;
        // An embedded browser rejecting PiP must not also cancel the voice request.
        if (Date.now() - requestedAt < 1500) { setError("This browser closed the floating window. Open Milo in desktop Chrome or Edge to keep it above other windows."); return; }
        livePeerRef.current?.close(); livePeerRef.current = null;
        setStopSignal((value) => value + 1);
      });
      if (!floating.closed) { floatRef.current = floating; setIsFloating(true); }
    } catch { setError("Floating isn’t available in this browser. Open Milo in desktop Chrome or Edge; your conversation is still here."); }
    finally { setOpening(false); }
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setPanel((current) => current === "screenshot" ? "ask" : current); };
    const owner = host.ownerDocument;
    owner.addEventListener("keydown", onKey);
    return () => owner.removeEventListener("keydown", onKey);
  }, [host, isFloating]);
  useEffect(() => {
    if (!isFloating || !floatRef.current) return;
    try { floatRef.current.resizeTo(384, panel ? 680 : error ? 300 : 240); } catch { /* Browser-managed windows can still be resized manually. */ }
  }, [isFloating, panel, busy, error, task?.status]);

  useEffect(() => () => { requestRevision.current++; clearTimeout(reconnectTimer.current); sourceRef.current?.close(); }, []);

  const attachEvents = (id: string) => {
    activeIdRef.current = id;
    clearTimeout(reconnectTimer.current); reconnectTimer.current = undefined;
    sourceRef.current?.close();
    const source = subscribeCheckEvents(id, (event) => {
      if (activeIdRef.current !== id) return;
      let payload: CheckEvent | undefined;
      try {
        payload = JSON.parse(String(event.data)) as CheckEvent;
      } catch {
        return;
      }
      if (payload.evidence) {
        setEvidence((items) => [...items.filter((item) => item.id !== payload!.evidence!.id), payload!.evidence!]);
      }
      if (payload.task) {
        setTask(payload.task);
        setEvidence(payload.task.evidence);
        if (payload.task.status === "failed") {
          setError(payload.task.error ?? "Check failed. Please retry.");
        }
        if (payload.task.status === "completed") {
          setPanel((current) => current ?? "ask");
          if (payload.task.voiceDelivery?.status === "failed" && livePeerRef.current) setError("The evidence could not reach voice. Please retry; no spoken result is verified.");
          if (maySpeakOfficialVerdict(payload.task.status, payload.task.spokenSummary)) {
            const spoken = payload.task.spokenSummary!.trim();
            const key = `${payload.task.id}:${spoken}`;
            if (spokenVerdictKeyRef.current !== key) {
              spokenVerdictKeyRef.current = key;
              const sessionId = livePeerRef.current?.sessionId;
              if (sessionId && !voiceCheckIds.current.has(payload.task.id)) {
                void fetch(`/api/live/sessions/${encodeURIComponent(sessionId)}/speak`, {
                  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ checkId: payload.task.id }),
                }).then(async (response) => {
                  const delivered = await response.json() as CheckTask;
                  if (activeIdRef.current !== id) return;
                  if (delivered.id === id) setTask(delivered);
                  if (!response.ok && livePeerRef.current?.sessionId === sessionId) setError("The evidence could not reach voice. Please retry.");
                }).catch(() => { if (activeIdRef.current === id && livePeerRef.current?.sessionId === sessionId) setError("The evidence could not reach voice. Please retry."); });
              }
            }
          }
        }
      }
    });
    for (const terminal of ["completed", "failed", "cancelled"]) source.addEventListener(terminal, () => { source.close(); clearTimeout(reconnectTimer.current); if (activeIdRef.current === id) setBusy(false); });
    source.onopen = () => { clearTimeout(reconnectTimer.current); reconnectTimer.current = undefined; };
    source.onerror = () => {
      if (activeIdRef.current !== id) return;
      // EventSource retries repeatedly; do not restart this deadline on every failed retry.
      if (reconnectTimer.current) return;
      reconnectTimer.current = setTimeout(() => {
        reconnectTimer.current = undefined;
        if (activeIdRef.current !== id) return;
        source.close(); setBusy(false); setError("Lost the check connection. Retry to start a new check.");
        void cancelCheck(id).catch(() => {});
      }, source.readyState === EventSource.CLOSED ? 0 : 10_000);
    };
    sourceRef.current = source;
  };

  const runCheck = async (nextQuestion = question.trim() || "Is the claim in this screenshot true?") => {
    const revision = ++requestRevision.current;
    const previousId = activeIdRef.current;
    activeIdRef.current = ""; sourceRef.current?.close(); clearTimeout(reconnectTimer.current);
    setError("");
    setBusy(true);
    setTask(undefined); setEvidence([]);
    try {
      if (previousId) await cancelCheck(previousId);
      if (revision !== requestRevision.current) return;
      const created = await createCheck({
        question: nextQuestion,
        url: nextQuestion.match(/https?:\/\/[^\s<>]+/)?.[0],
        imageBase64: image?.imageBase64,
        imageMediaType: image?.imageMediaType,
      });
      if (revision !== requestRevision.current) { void cancelCheck(created.id).catch(() => {}); return; }
      setTask(created);
      setPanel("ask");
      setEvidence(created.evidence);
      setQuestion("");
      spokenVerdictKeyRef.current = "";
      attachEvents(created.id);
    } catch (caught) {
      if (revision !== requestRevision.current) return;
      setError(caught instanceof Error ? caught.message : "Check failed");
      setBusy(false);
    }
  };

  const attachImage = async (file?: File) => {
    if (!file) return;
    const revision = ++imageRevision.current;
    setReadingImage(true); setError(""); setPanel("ask");
    try {
      const payload = await readImageFile(file);
      if (revision === imageRevision.current) setImage(payload);
    } catch (caught) { if (revision === imageRevision.current) setError(caught instanceof Error ? caught.message : "Could not attach image."); }
    finally { if (revision === imageRevision.current) setReadingImage(false); }
  };

  const sendQuestion = () => {
    const text = question.trim();
    if (!text && !image) return;
    const next = task && text ? `${task.question}\nFollow-up: ${text}` : text || "Check the claim in the attached image.";
    if (next.length > 6000) { setError("Start a shorter question to continue."); return; }
    void runCheck(next);
  };

  useEffect(() => {
    const owner = host.ownerDocument;
    const onDrag = (event: DragEvent) => { if (event.dataTransfer?.types.includes("Files")) event.preventDefault(); };
    const onDrop = (event: DragEvent) => {
      if (!event.dataTransfer?.files.length) return;
      event.preventDefault(); void attachImage(event.dataTransfer.files[0]);
    };
    const onPaste = (event: ClipboardEvent) => {
      const file = [...(event.clipboardData?.items ?? [])].find((item) => item.type.startsWith("image/"))?.getAsFile();
      if (file) { event.preventDefault(); void attachImage(file); }
    };
    owner.addEventListener("dragover", onDrag);
    owner.addEventListener("drop", onDrop);
    owner.addEventListener("paste", onPaste);
    return () => { owner.removeEventListener("dragover", onDrag); owner.removeEventListener("drop", onDrop); owner.removeEventListener("paste", onPaste); };
  }, [host, isFloating]);

  const sourceCount = evidence.filter((item) => item.kind === "fetched").length;
  const assistant = <div className={`assistant compact-assistant${voiceActive ? " in-call" : ""}${panel ? " expanded" : ""}`} aria-label="Milo assistant">
    {accessNeeded ? <form className="detail-body" onSubmit={(event) => {
      event.preventDefault();
      void fetch("/api/session", { headers: { "x-milo-access-code": accessCode } }).then((response) => { setAccessNeeded(!response.ok); setAccessCode(""); if (!response.ok) setError("Access code not accepted. Try again."); }).catch(() => setError("Could not connect. Try again."));
    }}><h2>Private preview</h2><label htmlFor="access">Access code</label><input id="access" type="password" value={accessCode} onChange={(event) => setAccessCode(event.target.value)} /><button>Unlock preview</button></form> : null}
      <VoiceChat
        preview={voicePreview}
        onActive={setVoiceActive}
        textMode={textMode}
        onStart={() => { setError(""); }}
        onEnd={() => { setVoicePreview(false); }}
        onFloat={isFloating ? undefined : () => void openFloat()}
        openingFloat={opening}
        onCaption={() => {}} stopSignal={stopSignal} sourceCount={sourceCount}
        onScreenshot={() => setPanel((current) => current === "screenshot" ? "ask" : "screenshot")}
        onText={() => { const next = !textMode; setTextMode(next); setPanel(next || task?.status === "completed" || image ? "ask" : null); }}
        onEvent={(raw) => {
          const event = raw as { type?: string; delegation?: { id?: string } };
          const sessionId = livePeerRef.current?.sessionId;
          if (event.type !== "session.delegation.created" || !sessionId || !event.delegation?.id) return;
          const revision = ++requestRevision.current;
          clearTimeout(reconnectTimer.current);
          setBusy(true);
          setTask(undefined); setEvidence([]); setError(""); activeIdRef.current = ""; sourceRef.current?.close();
          void fetch(`/api/live/sessions/${encodeURIComponent(sessionId)}/delegations`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ delegationId: event.delegation.id, ...image }), signal: AbortSignal.timeout(15_000),
          }).then(async (response) => {
            const result = await response.json();
            if (!response.ok) throw new Error(result.error);
            if (revision !== requestRevision.current) { void cancelCheck(result.id).catch(() => {}); return; }
            voiceCheckIds.current.add(result.id); setTask(result); setEvidence([]); setPanel("ask"); setError(""); attachEvents(result.id);
          }).catch((caught) => { if (revision === requestRevision.current) { setError(String(caught.message)); setBusy(false); } });
        }}
        onLivePeer={(peer) => {
          livePeerRef.current = peer;
          setVoiceSessionId(peer?.sessionId);
        }}
      />
    {error ? <p className="error" role="alert">{error}</p> : null}
    {busy ? <div className="research-status" role="status"><span>Checking sources…</span></div> : null}
    {panel === "screenshot" ? <div className="detail-body image-options"><ScreenshotCheck onClose={() => setPanel("ask")} onConfirm={(payload) => { imageRevision.current++; setReadingImage(false); setImage(payload); if (payload) setPanel("ask"); }} disabled={busy} /></div> : null}
    {panel === "ask" && (textMode || task?.status === "completed" || image || readingImage) ? <section className="result-panel" aria-label="Answer and sources">
      {task ? <CheckResult task={task} voice={voiceActive || task.voiceDelivery?.status === "ready"} /> : null}
        {readingImage ? <p className="hint" role="status">Attaching image…</p> : null}
        {image ? <div className="attached-image"><img src={`data:${image.imageMediaType};base64,${image.imageBase64}`} alt="Attached image" /><span role="status">{attachmentSync === "syncing" ? "Syncing with voice…" : attachmentSync === "ready" ? "Image ready for voice" : attachmentSync === "failed" ? "Image attached · voice sync failed" : "Image attached"}</span><button type="button" aria-label="Remove attached image" onClick={() => { imageRevision.current++; setReadingImage(false); setImage(undefined); }}><Icon name="close" /></button></div> : null}
      {textMode ? <form className="concise-compose" onSubmit={(event) => { event.preventDefault(); if (!busy && !readingImage) sendQuestion(); }}>
        <div className="compose-row"><label htmlFor="question" className="sr-only">Ask Milo</label><textarea id="question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder={task ? "Ask a follow-up…" : "Ask anything, or drop an image…"} rows={1} maxLength={4000} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!busy && !readingImage) sendQuestion(); } }} /><button type="submit" className="primary" aria-label="Send question" disabled={busy || readingImage || (!question.trim() && !image)}><Icon name="arrow" /></button></div>
      </form> : null}
    </section> : null}
  </div>;
  return <main className={`launch-page compact-page${voiceActive ? " is-voice" : ""}${panel ? " with-details" : ""}`}>
    {isFloating ? <div className="floating-placeholder"><Icon name="float" /><h1>Milo is with you.</h1><p>Keep this tab open while you use the floating window.</p><button onClick={() => floatRef.current?.close()}>Bring Milo back</button></div> : null}
    <div ref={homeRef} className="assistant-home" />
    {createPortal(assistant, host)}
  </main>;
}
