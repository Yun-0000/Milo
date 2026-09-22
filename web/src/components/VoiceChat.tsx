import { useEffect, useRef, useState, type CSSProperties } from "react";
import { connectLivePeer, formatRemoteAudioHint, type LivePeer } from "../liveWebrtc";
import { accumulateLiveCaption, captionFromLiveEvent } from "../../../shared/voiceControl";
import { Icon } from "./Icon";

export interface ChatLine {
  role: "you" | "milo";
  text: string;
}

interface Props {
  textMode?: boolean;
  preview?: boolean;
  onLivePeer?: (peer: LivePeer | null) => void;
  onEvent?: (event: unknown) => void;
  onStart: () => void;
  onEnd: () => void;
  onActive: (active: boolean) => void;
  onScreenshot: () => void;
  onText: () => void;
  onFloat?: () => void;
  openingFloat?: boolean;
  sourceCount: number;
  stopSignal: number;
  onCaption: (caption: string) => void;
}

export function voiceErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/API credits are exhausted/i.test(message)) return "OpenAI API credits are exhausted. Add credits, then retry.";
  if (/rate-limiting/i.test(message)) return "Voice is rate-limited. Wait briefly, then retry.";
  if (/OPENAI_API_KEY|not configured/i.test(message)) return "Voice isn’t configured yet. You can still use chat.";
  if (/NotAllowed|permission|denied/i.test(message) || (error instanceof Error && error.name === "NotAllowedError")) return "Microphone access is off. Allow it to start voice.";
  return "Voice couldn’t connect. Please try again.";
}

export function VoiceChat({ preview = false, textMode = false, onLivePeer, onEvent, onStart, onEnd, onActive, onScreenshot, onText, onFloat, openingFloat = false, sourceCount, stopSignal, onCaption }: Props) {
  const [liveError, setLiveError] = useState("");
  const [liveReady, setLiveReady] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const generation = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const [muted, setMuted] = useState(false);
  const [liveCaption, setLiveCaption] = useState("");
  const [remoteAudioHint, setRemoteAudioHint] = useState(formatRemoteAudioHint());
  const peerRef = useRef<LivePeer | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const meterRef = useRef<HTMLDivElement | null>(null);
  const meterCleanup = useRef<(() => void) | undefined>(undefined);
  const onLivePeerRef = useRef(onLivePeer);
  const onEventRef = useRef(onEvent);
  const onCaptionRef = useRef(onCaption);
  onCaptionRef.current = onCaption;
  onEventRef.current = onEvent;
  onLivePeerRef.current = onLivePeer;

  const teardown = () => {
    generation.current++;
    meterCleanup.current?.(); meterCleanup.current = undefined;
    abortRef.current?.abort();
    setConnecting(false);
    peerRef.current?.close();
    peerRef.current = null;
    onLivePeerRef.current?.(null);
    if (audioRef.current) {
      audioRef.current.srcObject = null;
    }
    setLiveReady(false);
    setMuted(false);
    setLiveCaption("");
    onCaptionRef.current("");
    setRemoteAudioHint(formatRemoteAudioHint());
  };

  useEffect(() => {
    const onLeave = () => teardown();
    window.addEventListener("pagehide", onLeave);
    return () => { window.removeEventListener("pagehide", onLeave); teardown(); };
  }, []);
  useEffect(() => { if (stopSignal) teardown(); }, [stopSignal]);
  useEffect(() => { onActive(connecting || liveReady || preview); }, [connecting, liveReady, preview, onActive]);

  useEffect(() => {
    if (!liveReady || !peerRef.current) return;
    let context: AudioContext | undefined;
    let interval: ReturnType<typeof setInterval> | undefined;
    const nodes: MediaStreamAudioSourceNode[] = [];
    const cleanup = () => {
      clearInterval(interval);
      nodes.forEach((node) => node.disconnect());
      if (context && context.state !== "closed") void context.close().catch(() => {});
      meterRef.current?.style.setProperty("--voice-level", "0");
    };
    meterCleanup.current = cleanup;
    try {
      context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      const streams = [peerRef.current.microphone, audioRef.current?.srcObject as MediaStream | null].filter(Boolean) as MediaStream[];
      for (const stream of streams) {
        const source = context.createMediaStreamSource(stream);
        source.connect(analyser); nodes.push(source);
      }
      void context.resume().catch(() => {});
      const samples = new Uint8Array(analyser.fftSize);
      interval = setInterval(() => {
        analyser.getByteTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, sample) => sum + ((sample - 128) / 128) ** 2, 0) / samples.length);
        meterRef.current?.style.setProperty("--voice-level", String(Math.min(1, rms * 8)));
      }, 80);
    } catch { cleanup(); /* A static meter is preferable to invented audio activity. */ }
    return cleanup;
  }, [liveReady]);

  useEffect(() => {
    if (!liveReady) return;
    let cancelled = false;
    const poll = async () => {
      const bytes = await peerRef.current?.getInboundAudioBytes();
      if (!cancelled) setRemoteAudioHint(formatRemoteAudioHint(bytes));
    };
    void poll();
    const interval = setInterval(() => void poll(), 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [liveReady]);

  const startVoice = async () => {
    if (connecting) return;
    setLiveError("");
    teardown();
    const token = generation.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setConnecting(true);
    onStart();
    try {
      const peer = await connectLivePeer(
        (stream) => {
          if (token !== generation.current) return;
          const audio = audioRef.current;
          if (!audio) return;
          audio.srcObject = stream;
          void audio.play().catch(() => {
            setLiveError("Allow audio playback to hear gpt-live-1.");
          });
        },
        (event) => {
          if (token !== generation.current) return;
          onEventRef.current?.(event);
          const caption = captionFromLiveEvent(event);
          if (caption) {
            setLiveCaption((previous) => accumulateLiveCaption(previous, caption));
          }
        },
        { signal: controller.signal },
      );
      if (token !== generation.current) { peer.close(); return; }
      peerRef.current = peer;
      onLivePeerRef.current?.(peer);
      setLiveReady(true);
      setConnecting(false);
      peer.peer.addEventListener("connectionstatechange", () => {
        if (token !== generation.current) return;
        if (["failed", "closed", "disconnected"].includes(peer.peer.connectionState)) {
          teardown();
          setLiveError("Voice disconnected. Start voice to reconnect.");
        }
      });
    } catch (caught) {
      if (token !== generation.current) return;
      teardown();
      setLiveError(voiceErrorMessage(caught));
    }
  };

  useEffect(() => { onCaptionRef.current(liveCaption); }, [liveCaption]);

  const toggleMute = () => {
    if (preview) { setMuted((value) => !value); return; }
    if (!peerRef.current) return;
    const next = !muted;
    peerRef.current.setMuted(next);
    setMuted(next);
  };

  return (
    <section className="voice-transport" aria-label="Voice and check controls">
      <audio ref={audioRef} autoPlay hidden />
      {connecting || liveReady || preview ? <>
        <div className="voice-capsule" title={preview ? "Voice layout preview" : liveReady ? remoteAudioHint : "Connecting voice"}>
          <div className="voice-identity"><strong>Milo</strong><span role="status">{preview ? "Voice preview" : connecting ? "Connecting…" : muted ? "Microphone muted" : "Voice on"}</span></div>
          <div className="voice-meter" ref={meterRef} aria-hidden="true">{Array.from({ length: 13 }, (_, index) => <i key={index} style={{ "--bar-weight": 1 - Math.abs(6 - index) / 9 } as CSSProperties} />)}</div>
        </div>
        <div className="call-controls">
          <button type="button" aria-label="Screenshot" title="Screenshot" onClick={onScreenshot}><Icon name="camera" /></button>
          <button type="button" aria-label="Conversation" aria-pressed={textMode} title={textMode ? "Hide text input" : "Show text input"} onClick={onText}><Icon name="chat" />{sourceCount > 0 ? <span className="notification-dot" /> : null}</button>
          <button type="button" aria-label={muted ? "Unmute" : "Mute"} title={muted ? "Unmute" : "Mute"} aria-pressed={muted} disabled={!liveReady && !preview} onClick={toggleMute}><Icon name={muted ? "mute" : "mic"} /></button>
          {onFloat ? <button type="button" aria-label="Float Milo" title="Float Milo above other windows" disabled={openingFloat} onClick={onFloat}><Icon name="float" /></button> : null}
          <button type="button" className="end-call" aria-label="End call" title="End call" onClick={() => { teardown(); onEnd(); }}><Icon name="close" /></button>
        </div>
        {preview ? <p className="call-state">Layout preview · microphone off</p> : null}
      </> : <div className="rest-controls">
        <button type="button" className="voice-start" onClick={() => void startVoice()}><Icon name="mic" />Talk to Milo</button>
        <button type="button" aria-label="Conversation" aria-pressed={textMode} title={textMode ? "Hide text input" : "Show text input"} onClick={onText}><Icon name="chat" />{sourceCount > 0 ? <span className="notification-dot" /> : null}</button>
        <button type="button" aria-label="Screenshot" title="Screenshot" onClick={onScreenshot}><Icon name="camera" /></button>
        {onFloat ? <button type="button" aria-label="Float Milo" title="Float Milo above other windows" disabled={openingFloat} onClick={onFloat}><Icon name="float" /></button> : null}
      </div>}
      {liveError ? <p className="error voice-error" role="alert">{liveError}</p> : null}
      <span className="sr-only" role="status">{liveReady ? muted ? "Microphone muted" : "Microphone on" : connecting ? "Connecting voice" : "Microphone off"}</span>
    </section>
  );
}
