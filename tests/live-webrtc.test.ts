import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertBrowserOfferSdp,
  isPlaceholderSdp,
  liveAnswerSdp,
  REJECTED_PLACEHOLDER_SDP,
} from "../shared/liveProtocol.ts";
import {
  accumulateLiveCaption,
  captionFromLiveEvent,
  maySpeakOfficialVerdict,
} from "../shared/voiceControl.ts";
import {
  connectLivePeer,
  formatRemoteAudioHint,
  inboundAudioBytesReceived,
} from "../web/src/liveWebrtc.ts";

const REAL_OFFER = [
  "v=0",
  "o=- 390382428 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111",
  "c=IN IP4 0.0.0.0",
  "a=fingerprint:sha-256 00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF",
  "a=setup:actpass",
  "a=mid:0",
  "a=ice-ufrag:real",
  "a=ice-pwd:realpasswordvalue",
  "a=rtpmap:111 opus/48000/2",
  "",
].join("\r\n");

const REAL_ANSWER = REAL_OFFER.replace("actpass", "active");

function mockStream() {
  const stopped: string[] = [];
  const track = {
    kind: "audio",
    enabled: true,
    stop: () => stopped.push("mic"),
  };
  return {
    stream: {
      getAudioTracks: () => [track],
      getTracks: () => [track],
    } as unknown as MediaStream,
    track,
    stopped,
  };
}

function mockPeer(localSdp = REAL_OFFER, channelState: RTCDataChannelState = "open", inboundBytes = 4096) {
  const closed: string[] = [];
  const sent: unknown[] = [];
  const listeners = new Map<string, Array<(event?: { data?: string }) => void>>();
  const channel = {
    readyState: channelState as RTCDataChannelState,
    send: (data: string) => sent.push(JSON.parse(data)),
    close: () => closed.push("dc"),
    addEventListener: (type: string, handler: (event?: { data?: string }) => void) => {
      const list = listeners.get(type) ?? [];
      list.push(handler);
      listeners.set(type, list);
    },
    open() {
      channel.readyState = "open";
      for (const handler of listeners.get("open") ?? []) handler();
    },
    receive(event: unknown) {
      const data = JSON.stringify(event);
      for (const handler of listeners.get("message") ?? []) handler({ data });
    },
  };
  const peer = {
    iceGatheringState: "complete",
    localDescription: null as { type: string; sdp: string } | null,
    remoteDescription: null as { type: string; sdp: string } | null,
    addEventListener: () => undefined,
    addTrack: () => undefined,
    createDataChannel: () => channel,
    createOffer: async () => ({ type: "offer", sdp: localSdp }),
    setLocalDescription: async (desc: { type: string; sdp: string }) => {
      peer.localDescription = desc;
    },
    setRemoteDescription: async (desc: { type: string; sdp: string }) => {
      peer.remoteDescription = desc;
    },
    close: () => closed.push("pc"),
    getStats: async () =>
      new Map([
        ["inbound", { type: "inbound-rtp", kind: "audio", bytesReceived: inboundBytes }],
        ["outbound", { type: "outbound-rtp", kind: "audio", bytesSent: 12 }],
      ]),
  };
  return { peer, sent, closed, channel };
}

describe("placeholder SDP is rejected", () => {
  it("rejects the hardcoded VoiceChat probe string", () => {
    assert.equal(isPlaceholderSdp(REJECTED_PLACEHOLDER_SDP), true);
    assert.throws(() => assertBrowserOfferSdp(REJECTED_PLACEHOLDER_SDP), /Placeholder SDP is rejected/);
    assert.throws(() => assertBrowserOfferSdp("v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n"), /Placeholder/);
    assert.doesNotThrow(() => assertBrowserOfferSdp(REAL_OFFER));
  });

  it("VoiceChat source no longer posts a placeholder offer", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../web/src/components/VoiceChat.tsx"), "utf8");
    assert.equal(source.includes("v=0\\r\\no=- 0 0 IN IP4 127.0.0.1"), false);
    assert.match(source, /connectLivePeer/);
    assert.match(source, /audioRef/);
    assert.match(source, /formatRemoteAudioHint/);
    assert.match(source, /remoteAudioHint/);
    assert.match(source, /accumulateLiveCaption/);
    assert.match(source, /getInboundAudioBytes/);
  });

  it("App requests server-owned speech by check ID, never sends its own verdict", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../web/src/App.tsx"), "utf8");
    assert.match(source, /maySpeakOfficialVerdict/);
    assert.match(source, /checkId: payload.task.id/);
    assert.doesNotMatch(source, /livePeerRef\.current\?\.speak/);
  });
});

describe("real RTCPeerConnection path", () => {
  it("stops a microphone granted after the user cancelled connecting", async () => {
    const mic = mockStream();
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(connectLivePeer(() => {}, undefined, {
      signal: controller.signal,
      getUserMedia: async () => mic.stream,
      PeerConnection: function () { throw new Error("Must not create a cancelled peer"); } as unknown as typeof RTCPeerConnection,
    }), { name: "AbortError" });
    assert.deepEqual(mic.stopped, ["mic"]);
  });

  it("stops media immediately while a cancelled offer is still pending", async () => {
    const mic = mockStream();
    const fake = mockPeer();
    const controller = new AbortController();
    await assert.rejects(connectLivePeer(() => {}, undefined, {
      signal: controller.signal,
      getUserMedia: async () => mic.stream,
      PeerConnection: function () { return fake.peer; } as unknown as typeof RTCPeerConnection,
      postOffer: async () => {
        controller.abort();
        assert.deepEqual(mic.stopped, ["mic"]);
        assert.ok(fake.closed.includes("pc"));
        return new Response(JSON.stringify({ transport: { sdp: REAL_ANSWER } }), { status: 201 });
      },
    }), { name: "AbortError" });
    assert.deepEqual(mic.stopped, ["mic"]);
    assert.equal(fake.peer.remoteDescription, null);
  });
  it("getUserMedia + createOffer, posts that SDP, applies gpt-live-1 answer, plays remote path, tears down", async () => {
    const mic = mockStream();
    const fake = mockPeer();
    const posted: string[] = [];
    const remote: MediaStream[] = [];
    const session = await connectLivePeer(
      (stream) => remote.push(stream),
      undefined,
      {
        getUserMedia: async () => mic.stream,
        PeerConnection: function () {
          return fake.peer;
        } as unknown as typeof RTCPeerConnection,
        postOffer: async (sdp) => {
          posted.push(sdp);
          return new Response(
            JSON.stringify({
              session: { id: "live_test" },
              transport: { type: "webrtc", sdp: REAL_ANSWER },
            }),
            { status: 201, headers: { "content-type": "application/json" } },
          );
        },
      },
    );
    assert.equal(posted.length, 1);
    assert.equal(posted[0], REAL_OFFER);
    assert.equal(isPlaceholderSdp(posted[0]), false);
    assert.equal(fake.peer.remoteDescription?.sdp, REAL_ANSWER);
    assert.equal(session.sessionId, "live_test");
    session.setMuted(true);
    assert.equal(mic.track.enabled, false);
    session.close();
    assert.deepEqual(mic.stopped, ["mic"]);
    assert.ok(fake.closed.includes("pc"));
    assert.equal(liveAnswerSdp({ transport: { sdp: REAL_ANSWER } }), REAL_ANSWER);
  });

  it("does not inject trusted commentary from an already-open browser channel", async () => {
    const mic = mockStream();
    const fake = mockPeer();
    await connectLivePeer(() => undefined, undefined, {
      getUserMedia: async () => mic.stream,
      PeerConnection: function () {
        return fake.peer;
      } as unknown as typeof RTCPeerConnection,
      postOffer: async () =>
        new Response(
          JSON.stringify({
            session: { id: "live_test" },
            transport: { type: "webrtc", sdp: REAL_ANSWER },
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
    });
    assert.deepEqual(fake.sent, []);
    assert.equal(
      fake.sent.some((event) => (event as { type?: string }).type === "response.create"),
      false,
    );
    fake.channel.receive({ type: "session.started", event_id: "srv_1" });
    assert.equal(fake.sent.length, 0);
  });

  it("does not inject trusted commentary on channel open or session.started", async () => {
    const mic = mockStream();
    const fake = mockPeer(REAL_OFFER, "connecting");
    await connectLivePeer(() => undefined, undefined, {
      getUserMedia: async () => mic.stream,
      PeerConnection: function () {
        return fake.peer;
      } as unknown as typeof RTCPeerConnection,
      postOffer: async () =>
        new Response(
          JSON.stringify({
            session: { id: "live_test" },
            transport: { type: "webrtc", sdp: REAL_ANSWER },
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
    });
    assert.deepEqual(fake.sent, []);
    fake.channel.receive({ type: "session.started", event_id: "srv_1" });
    assert.deepEqual(fake.sent, []);
    fake.channel.open();
    assert.deepEqual(fake.sent, []);
    fake.channel.receive({ type: "session.started", event_id: "srv_2" });
    fake.channel.open();
    assert.equal(fake.sent.length, 0);
    assert.equal(
      fake.sent.some((event) => (event as { type?: string }).type === "response.create"),
      false,
    );
  });

  it("fails closed on LIVE_UNAVAILABLE and never fakes ready", async () => {
    const mic = mockStream();
    const fake = mockPeer();
    await assert.rejects(
      () =>
        connectLivePeer(() => undefined, undefined, {
          getUserMedia: async () => mic.stream,
          PeerConnection: function () {
            return fake.peer;
          } as unknown as typeof RTCPeerConnection,
          postOffer: async () =>
            new Response(
              JSON.stringify({
                error: "LIVE_UNAVAILABLE",
                message: "Set OPENAI_API_KEY. Milo requires GPT-Live gpt-live-1 and will not fall back to Realtime or fake a voice path.",
              }),
              { status: 503, headers: { "content-type": "application/json" } },
            ),
        }),
      /LIVE_UNAVAILABLE/,
    );
    assert.ok(mic.stopped.includes("mic"));
    assert.ok(fake.closed.includes("pc"));
    assert.equal(fake.peer.remoteDescription, null);
  });

  it("browser peer cannot manufacture a spoken verdict and still reports audio stats", async () => {
    const mic = mockStream();
    const fake = mockPeer();
    const session = await connectLivePeer(() => undefined, undefined, {
      getUserMedia: async () => mic.stream,
      PeerConnection: function () {
        return fake.peer;
      } as unknown as typeof RTCPeerConnection,
      postOffer: async () =>
        new Response(
          JSON.stringify({
            session: { id: "live_test" },
            transport: { type: "webrtc", sdp: REAL_ANSWER },
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
    });
    assert.equal("speak" in session, false);
    assert.deepEqual(fake.sent, []);
    assert.equal(await session.getInboundAudioBytes(), 4096);
    assert.equal(formatRemoteAudioHint(4096), "Remote audio: receiving (4096 bytes)");
  });

  it("disconnected data channel cannot send commentary", async () => {
    const mic = mockStream();
    const fake = mockPeer(REAL_OFFER, "connecting");
    const session = await connectLivePeer(() => undefined, undefined, {
      getUserMedia: async () => mic.stream,
      PeerConnection: function () {
        return fake.peer;
      } as unknown as typeof RTCPeerConnection,
      postOffer: async () =>
        new Response(
          JSON.stringify({
            session: { id: "live_test" },
            transport: { type: "webrtc", sdp: REAL_ANSWER },
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
    });
    assert.equal("speak" in session, false);
    assert.deepEqual(fake.sent, []);
  });
});

describe("remote audio stats and assistant captions", () => {
  it("reads inbound-rtp audio bytesReceived", () => {
    const stats = new Map([
      ["other", { type: "outbound-rtp", kind: "audio", bytesSent: 9 }],
      ["in", { type: "inbound-rtp", kind: "audio", bytesReceived: 2048 }],
    ]);
    assert.equal(inboundAudioBytesReceived(stats), 2048);
    assert.equal(inboundAudioBytesReceived(new Map()), undefined);
    assert.equal(formatRemoteAudioHint(), "Remote audio: waiting");
    assert.equal(formatRemoteAudioHint(0), "Remote audio: receiving (0 bytes)");
  });

  it("accumulates assistant output_transcript deltas into one Milo line", () => {
    const first = captionFromLiveEvent({ type: "session.output_transcript.delta", delta: "Hi, " });
    const second = captionFromLiveEvent({ type: "session.output_transcript.delta", delta: "I'm Milo." });
    const user = captionFromLiveEvent({ type: "session.input_transcript.delta", delta: "Check this." });
    assert.deepEqual(first, { speaker: "assistant", text: "Hi, " });
    let line = accumulateLiveCaption("", first!);
    line = accumulateLiveCaption(line, second!);
    assert.equal(line, "Milo: Hi, I'm Milo.");
    line = accumulateLiveCaption(line, user!);
    assert.equal(line, "You: Check this.");
    line = accumulateLiveCaption(line, { speaker: "user", text: " Please use NASA." });
    assert.equal(line, "You: Check this. Please use NASA.");
    line = accumulateLiveCaption(line, { speaker: "assistant", text: "Official result: contradicted." });
    assert.equal(line, "Milo: Official result: contradicted.");
    assert.equal(maySpeakOfficialVerdict("completed", "Official result."), true);
    assert.equal(maySpeakOfficialVerdict("completed", "  "), false);
  });
});
