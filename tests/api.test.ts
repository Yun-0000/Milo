import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createApp } from "../server/src/app.ts";
import { resetStore } from "../server/src/store.ts";

async function listen() {
  const app = createApp();
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return { server, base: `http://127.0.0.1:${address.port}` };
}

describe("Milo APIs without live keys", () => {
  afterEach(() => {
    resetStore();
    delete process.env.OPENAI_API_KEY;
  });

  it("rejects placeholder SDP before any Live handshake", async () => {
    delete process.env.OPENAI_API_KEY;
    const { server, base } = await listen();
    try {
      const response = await fetch(`${base}/api/live/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sdp: "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n" }),
      });
      const body = await response.json();
      assert.equal(response.status, 400);
      assert.equal(body.error, "PLACEHOLDER_SDP_REJECTED");
    } finally {
      server.close();
    }
  });

  it("fails Live closed on a real-shaped offer and never mentions a Realtime fallback", async () => {
    delete process.env.OPENAI_API_KEY;
    const { server, base } = await listen();
    try {
      const response = await fetch(`${base}/api/live/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sdp: [
            "v=0",
            "o=- 1 1 IN IP4 127.0.0.1",
            "s=-",
            "t=0 0",
            "m=audio 9 UDP/TLS/RTP/SAVPF 111",
            "a=fingerprint:sha-256 00:11:22:33:44:55:66:77:88:99:aa:bb:cc:dd:ee:ff:00:11:22:33:44:55:66:77:88:99:aa:bb:cc:dd:ee:ff",
            "",
          ].join("\r\n"),
        }),
      });
      const body = await response.json();
      assert.equal(response.status, 503);
      assert.equal(body.error, "LIVE_UNAVAILABLE");
      assert.match(body.message, /gpt-live-1/i);
      assert.match(body.message, /will not fall back to Realtime/i);
    } finally {
      server.close();
    }
  });

  it("accepts a check, streams failure, accepts a follow-up, and deletes", async () => {
    delete process.env.OPENAI_API_KEY;
    const { server, base } = await listen();
    try {
      const created = await fetch(`${base}/api/checks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "Did this press release happen?" }),
      });
      assert.equal(created.status, 202);
      const task = await created.json();
      const cookie = created.headers.get("set-cookie")!.split(";")[0];
      assert.equal(typeof task.id, "string");

      assert.equal((await fetch(`${base}/api/checks/${task.id}`)).status, 404, "another session cannot access this check");
      const events = await fetch(`${base}/api/checks/${task.id}/events`, { headers: { cookie } });
      assert.equal(events.headers.get("content-type"), "text/event-stream");
      const text = await events.text();
      assert.match(text, /EVIDENCE_UNAVAILABLE|OPENAI_API_KEY|failed/);

      const message = await fetch(`${base}/api/checks/${task.id}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ text: "Focus on the date." }),
      });
      assert.equal(message.status, 200);

      const deleted = await fetch(`${base}/api/checks/${task.id}`, { method: "DELETE", headers: { cookie } });
      assert.equal(deleted.status, 204);
    } finally {
      server.close();
    }
  });
});
