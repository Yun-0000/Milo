import assert from "node:assert/strict";
import http from "node:http";
import { WebSocketServer } from "ws";
import { afterEach, describe, it } from "node:test";
import { createApp } from "../server/src/app.ts";
import { prepareOfferSdp } from "../server/src/routes/live.ts";
import { LIVE_INSTRUCTIONS, visionInput } from "../server/src/openai.ts";
import { assertBrowserOfferSdp, ensureSdpEndsWithNewline } from "../shared/liveProtocol.ts";

const TRIMMED_LOOKING_OFFER = [
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
].join("\r\n");

async function listenApp() {
  const app = createApp();
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return { server, base: `http://127.0.0.1:${address.port}` };
}

async function listenMockOpenAI() {
  const captured: string[] = [];
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(chunk as Buffer));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      captured.push(body);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          session: { id: "live_test" },
          transport: { type: "webrtc", sdp: `${TRIMMED_LOOKING_OFFER}\r\n` },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const sockets = new WebSocketServer({ server });
  sockets.on("connection", (socket) => socket.on("message", () => {}));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return { server, sockets, captured, base: `http://127.0.0.1:${address.port}/v1` };
}

describe("route SDP prep helper", () => {
  it("routes spoken questions to research without requiring an image", () => {
    assert.match(LIVE_INSTRUCTIONS, /VOICE ALONE IS SUFFICIENT/);
    assert.match(LIVE_INSTRUCTIONS, /trigger client delegation immediately/);
    assert.match(LIVE_INSTRUCTIONS, /search the public web, fetch and read pages/);
    assert.match(LIVE_INSTRUCTIONS, /Images are OPTIONAL/);
    const input = visionInput("When did Webb launch?");
    assert.equal(input[0].content.length, 1);
    assert.equal(input[0].content[0].type, "input_text");
    assert.match(String(input[0].content[0].text), /EXTRACT, DO NOT ANSWER OR CORRECT/);
  });
  it("repairs a trimmed-looking offer that has no trailing CRLF", () => {
    assert.equal(TRIMMED_LOOKING_OFFER.endsWith("\n"), false);
    assert.equal(TRIMMED_LOOKING_OFFER.endsWith("\r"), false);

    const prepared = prepareOfferSdp(TRIMMED_LOOKING_OFFER);
    assert.equal(prepared, `${TRIMMED_LOOKING_OFFER}\r\n`);
    assert.match(prepared, /\r\n$/);
    assert.doesNotThrow(() => assertBrowserOfferSdp(prepared));
  });

  it("keeps an offer that already ends with CRLF", () => {
    const withCrlf = `${TRIMMED_LOOKING_OFFER}\r\n`;
    assert.equal(prepareOfferSdp(withCrlf), withCrlf);
  });

  it("strips a leading BOM and leading whitespace only", () => {
    const messy = `\uFEFF  \n${TRIMMED_LOOKING_OFFER}\r\n`;
    assert.equal(prepareOfferSdp(messy), `${TRIMMED_LOOKING_OFFER}\r\n`);
  });

  it("does not strip trailing newlines the way String#trim does", () => {
    const withExtra = `${TRIMMED_LOOKING_OFFER}\r\n\r\n`;
    assert.equal(withExtra.trim().endsWith("\n"), false);
    assert.equal(prepareOfferSdp(withExtra), withExtra);
  });
});

describe("createLiveSession SDP defense", () => {
  it("ensures the SDP passed to live.create ends with a newline", () => {
    assert.equal(ensureSdpEndsWithNewline(TRIMMED_LOOKING_OFFER), `${TRIMMED_LOOKING_OFFER}\r\n`);
    assert.equal(ensureSdpEndsWithNewline(`${TRIMMED_LOOKING_OFFER}\n`), `${TRIMMED_LOOKING_OFFER}\n`);
  });
});

describe("POST /api/live/sessions SDP prep", () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousBase = process.env.OPENAI_BASE_URL;

  afterEach(() => {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousBase === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = previousBase;
  });

  it("forwards SDP and restricts browser events while attaching a trusted sideband", async () => {
    const openai = await listenMockOpenAI();
    process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
    process.env.OPENAI_BASE_URL = openai.base;
    const { server, base } = await listenApp();

    try {
      const response = await fetch(`${base}/api/live/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sdp: TRIMMED_LOOKING_OFFER }),
      });
      const body = await response.json();
      assert.equal(response.status, 201);
      assert.equal((body as { session?: { id?: string } }).session?.id, "live_test");
      assert.equal(openai.captured.length, 1);

      const sent = JSON.parse(openai.captured[0]) as {
        session?: {
          audio?: { output?: { voice?: string } };
          client?: {
            data_channel?: {
              allowed_client_events?: string;
              allowed_server_events?: string;
            };
          };
        };
        transport?: { sdp?: string };
      };
      assert.equal(sent.transport?.sdp, `${TRIMMED_LOOKING_OFFER}\r\n`);
      assert.match(sent.transport?.sdp ?? "", /\r\n$/);
      assert.equal(sent.session?.audio?.output?.voice, "marin");
      assert.deepEqual(sent.session?.client?.data_channel, {
        allowed_client_events: ["session.input_audio.mute", "session.input_audio.unmute", "session.close"],
        allowed_server_events: "all",
      });
    } finally {
      server.close();
      for (const socket of openai.sockets.clients) socket.terminate();
      openai.sockets.close();
      openai.server.close();
    }
  });
});
