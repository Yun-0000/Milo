import assert from "node:assert/strict";
import { it } from "node:test";
import { WebSocketServer } from "ws";
import { createApp } from "../server/src/app.ts";
import { attachVoice, closeVoice } from "../server/src/liveBridge.ts";
import { syncLiveAttachment } from "../web/src/api.ts";

it("syncs attachment, replacement and removal through the owned sideband, with acknowledgment", async () => {
  const upstream = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>(resolve => upstream.once("listening", resolve));
  const previousBase = process.env.OPENAI_BASE_URL;
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${(upstream.address() as { port: number }).port}/v1`;
  const received: Array<{ type: string; content: string; delegation_id: unknown; event_id: string }> = [];
  let reject = false;
  upstream.on("connection", peer => peer.on("message", raw => {
    const event = JSON.parse(String(raw));
    if (event.type === "session.close") return;
    received.push(event);
    setTimeout(() => peer.send(JSON.stringify({ type: reject ? "error" : "session.thinking.appended", client_event_id: event.event_id })), 5);
  }));
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  let owner = "";
  try {
    const session = await fetch(`${base}/api/session`);
    const cookie = session.headers.get("set-cookie")!.split(";")[0];
    owner = cookie.split("=")[1].split(".")[0];
    await attachVoice("attachment-test", owner);
    const post = (body: object, auth = cookie) => fetch(`${base}/api/live/sessions/attachment-test/attachment`, {
      method: "POST", headers: { "content-type": "application/json", cookie: auth }, body: JSON.stringify(body),
    });
    assert.equal((await post({ attached: true }, "")).status, 404);
    assert.equal((await post({ attached: "true", content: "untrusted instruction" })).status, 400);
    assert.equal(received.length, 0);
    for (const attached of [false, true, true, false]) {
      assert.equal((await post({ attached, content: "untrusted instruction" })).status, 200);
      const event = received.at(-1)!;
      assert.equal(event.type, "session.thinking.append");
      assert.equal(event.delegation_id, null);
      assert.match(event.content, attached ? /an image is attached/ : /no image is attached/);
      assert.doesNotMatch(event.content, /untrusted instruction|base64/);
    }
    reject = true;
    assert.equal((await post({ attached: true })).status, 502, "must not report ready when Live rejects metadata");
  } finally {
    closeVoice("attachment-test", owner);
    server.close();
    for (const peer of upstream.clients) peer.terminate();
    await new Promise<void>(resolve => upstream.close(() => resolve()));
    if (previousBase === undefined) delete process.env.OPENAI_BASE_URL; else process.env.OPENAI_BASE_URL = previousBase;
  }
});

it("client synchronization sends only attachment metadata and exposes failure", async () => {
  const originalFetch = globalThis.fetch;
  const sent: boolean[] = [];
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "/api/live/sessions/session%2Fone/attachment");
      const body = JSON.parse(String(options?.body));
      assert.deepEqual(Object.keys(body), ["attached"]);
      sent.push(body.attached);
      return new Response(null, { status: 200 });
    };
    for (const attached of [true, true, false]) await syncLiveAttachment("session/one", attached);
    assert.deepEqual(sent, [true, true, false]);
    globalThis.fetch = async () => new Response(null, { status: 502 });
    await assert.rejects(syncLiveAttachment("session/one", true), /Reconnect voice/);
  } finally { globalThis.fetch = originalFetch; }
});
