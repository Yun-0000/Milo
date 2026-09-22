import { startLiveSession } from "./api";
import {
  assertBrowserOfferSdp,
  isLiveUnavailable,
  LIVE_DATA_CHANNEL,
  liveAnswerSdp,
  liveSessionId,
} from "../../shared/liveProtocol";
import {
  closeLiveEvent,
  muteLiveEvent,
  unmuteLiveEvent,
} from "../../shared/voiceControl";

export interface LivePeerDeps {
  signal?: AbortSignal;
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  PeerConnection?: typeof RTCPeerConnection;
  postOffer?: (sdp: string) => Promise<Response>;
  iceTimeoutMs?: number;
}

export interface LivePeer {
  sessionId?: string;
  peer: RTCPeerConnection;
  microphone: MediaStream;
  getInboundAudioBytes(): Promise<number | undefined>;
  setMuted(muted: boolean): void;
  close(): void;
}

export function inboundAudioBytesReceived(stats: { values(): IterableIterator<unknown> }): number | undefined {
  for (const entry of stats.values()) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as { type?: unknown; kind?: unknown; bytesReceived?: unknown };
    if (row.type === "inbound-rtp" && row.kind === "audio" && typeof row.bytesReceived === "number") {
      return row.bytesReceived;
    }
  }
  return undefined;
}

export function formatRemoteAudioHint(bytesReceived?: number): string {
  if (typeof bytesReceived !== "number") return "Remote audio: waiting";
  return `Remote audio: receiving (${bytesReceived} bytes)`;
}

export async function waitForIceGathering(peer: RTCPeerConnection, timeoutMs = 10_000): Promise<void> {
  if (peer.iceGatheringState === "complete") return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      peer.removeEventListener("icegatheringstatechange", onState);
      reject(new Error("Timed out while gathering ICE candidates"));
    }, timeoutMs);
    function onState() {
      if (peer.iceGatheringState !== "complete") return;
      clearTimeout(timeout);
      peer.removeEventListener("icegatheringstatechange", onState);
      resolve();
    }
    peer.addEventListener("icegatheringstatechange", onState);
    onState();
  });
}

export async function connectLivePeer(
  onRemoteStream: (stream: MediaStream) => void,
  onEvent: ((event: unknown) => void) | undefined,
  deps: LivePeerDeps = {},
): Promise<LivePeer> {
  const getUserMedia =
    deps.getUserMedia ?? ((constraints) => navigator.mediaDevices.getUserMedia(constraints));
  const PeerConnection = deps.PeerConnection ?? RTCPeerConnection;
  const postOffer = deps.postOffer ?? startLiveSession;
  const microphone = await getUserMedia({ audio: true, video: false });
  if (deps.signal?.aborted) {
    for (const track of microphone.getTracks()) track.stop();
    deps.signal.throwIfAborted();
  }
  const peer = new PeerConnection();
  let serverSessionId: string | undefined;
  let mediaClosed = false;
  const cleanupMedia = () => {
    if (mediaClosed) return;
    mediaClosed = true;
    for (const track of microphone.getTracks()) track.stop();
    peer.close();
  };
  const closeServer = () => {
    if (serverSessionId) void fetch(`/api/live/sessions/${encodeURIComponent(serverSessionId)}`, { method: "DELETE", keepalive: true }).catch(() => {});
    serverSessionId = undefined;
  };
  const onAbort = () => { cleanupMedia(); closeServer(); };
  deps.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    peer.addEventListener("track", (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      onRemoteStream(stream);
    });
    for (const track of microphone.getAudioTracks()) {
      peer.addTrack(track, microphone);
    }

    const events = peer.createDataChannel(LIVE_DATA_CHANNEL);
    let eventSeq = 0;
    const nextId = (prefix: string) => `${prefix}_${++eventSeq}`;
    events.addEventListener("message", ({ data }) => {
      try {
        const event = JSON.parse(String(data));
        onEvent?.(event);
      } catch {
        /* ignore non-JSON Live events */
      }
    });

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    await waitForIceGathering(peer, deps.iceTimeoutMs);
    deps.signal?.throwIfAborted();
    const sdp = peer.localDescription?.sdp;
    if (!sdp) throw new Error("RTCPeerConnection produced no local SDP offer");
    assertBrowserOfferSdp(sdp);

    const response = await postOffer(sdp);
    const payload = await response.json().catch(() => ({}));
    serverSessionId = liveSessionId(payload);
    deps.signal?.throwIfAborted();
    if (!response.ok) {
      const message =
        (payload as { message?: string; error?: string }).message ||
        (payload as { error?: string }).error ||
        "GPT-Live gpt-live-1 is unavailable";
      if (isLiveUnavailable(response.status, payload) || response.status >= 500) {
        throw new Error(`${(payload as { error?: string }).error ?? "LIVE_UNAVAILABLE"}: ${message}. Voice is not faked and Realtime is not used.`);
      }
      throw new Error(message);
    }

    const answer = liveAnswerSdp(payload);
    if (!answer) {
      throw new Error("Live response had no WebRTC answer SDP. Session is not ready.");
    }
    await peer.setRemoteDescription({ type: "answer", sdp: answer });
    deps.signal?.throwIfAborted();

    return {
      sessionId: liveSessionId(payload),
      peer,
      microphone,
      async getInboundAudioBytes() {
        if (typeof peer.getStats !== "function") return undefined;
        try {
          return inboundAudioBytesReceived(await peer.getStats());
        } catch {
          return undefined;
        }
      },
      setMuted(muted: boolean) {
        for (const track of microphone.getAudioTracks()) {
          track.enabled = !muted;
        }
        if (events.readyState === "open") {
          events.send(JSON.stringify(muted ? muteLiveEvent(nextId("mute")) : unmuteLiveEvent(nextId("unmute"))));
        }
      },
      close() {
        deps.signal?.removeEventListener("abort", onAbort);
        closeServer();
        if (events.readyState === "open") {
          try {
            events.send(JSON.stringify(closeLiveEvent(nextId("close"))));
          } catch {
            /* already closing */
          }
        }
        events.close();
        cleanupMedia();
      },
    };
  } catch (error) {
    deps.signal?.removeEventListener("abort", onAbort);
    closeServer();
    cleanupMedia();
    throw error;
  }
}
