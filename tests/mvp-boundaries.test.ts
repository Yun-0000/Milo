import assert from "node:assert/strict";
import { it } from "node:test";
import { WebSocketServer } from "ws";
import { createApp } from "../server/src/app.ts";
import { attachVoice, closeVoice, delegatedCheck } from "../server/src/liveBridge.ts";
import { checkSignal, createCheck, getCheck, resetStore, updateCheck } from "../server/src/store.ts";
import { validImageInput } from "../server/src/imageInput.ts";

it("private production preview enforces access, origin, ownership and safe API errors", async () => {
  const previous = { mode: process.env.NODE_ENV, code: process.env.MILO_ACCESS_CODE };
  process.env.NODE_ENV = "production"; process.env.MILO_ACCESS_CODE = "test-access-only";
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
    assert.equal((await fetch(`${base}/api/session`)).status, 401);
    const unlocked = await fetch(`${base}/api/session`, { headers: { "x-milo-access-code": "test-access-only" } });
    assert.equal(unlocked.status, 200);
    const setCookie = unlocked.headers.get("set-cookie")!;
    assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /Secure/); assert.match(setCookie, /SameSite=Strict/);
    const cookie = setCookie.split(";")[0];
    assert.equal((await fetch(`${base}/api/session`, { headers: { cookie } })).status, 200);
    assert.equal((await fetch(`${base}/api/session`, { headers: { cookie, origin: "https://attacker.example" } })).status, 403);
    assert.equal((await fetch(`${base}/api/session`, { headers: { cookie, "sec-fetch-site": "cross-site" } })).status, 403);
    const privateTask = createCheck({ status: "queued", question: "Private", imageAttached: false }, "another-owner");
    assert.equal((await fetch(`${base}/api/checks/${privateTask.id}`, { headers: { cookie } })).status, 404);
    assert.equal((await fetch(`${base}/api/checks/${privateTask.id}`, { method: "DELETE", headers: { cookie } })).status, 404);
    const malformed = await fetch(`${base}/api/checks`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: "{private input" });
    assert.equal(malformed.status, 400); assert.deepEqual(await malformed.json(), { error: "Invalid JSON request" });
    assert.equal(malformed.headers.get("x-content-type-options"), "nosniff");
    const invalidImage = await fetch(`${base}/api/checks`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ question: "check", imageBase64: "c2VjcmV0", imageMediaType: "image/png" }) });
    assert.equal(invalidImage.status, 400);
    const oversized = await fetch(`${base}/api/checks`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ question: "x".repeat(8_400_000) }) });
    assert.equal(oversized.status, 413); assert.deepEqual(await oversized.json(), { error: "Request too large" });
    delete process.env.MILO_ACCESS_CODE;
    assert.equal((await fetch(`${base}/api/session`)).status, 401, "production stays locked without an access code");
  } finally {
    server.close(); resetStore();
    if (previous.mode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous.mode;
    if (previous.code === undefined) delete process.env.MILO_ACCESS_CODE; else process.env.MILO_ACCESS_CODE = previous.code;
  }
});

it("rejects malformed, mismatched or oversized images before text or voice model calls", () => {
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=";
  assert.equal(validImageInput(png, "image/png"), true);
  for (const [data, type] of [[png, "image/jpeg"], ["c2VjcmV0", "image/png"], [Buffer.alloc(5_000_001).toString("base64"), "image/png"], [42, "image/png"]]) {
    assert.equal(validImageInput(data, type), false);
  }
});

it("voice delegation snapshots each turn, deduplicates and supersedes only its owner's active work", async () => {
  const upstream = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>(resolve => upstream.once("listening", resolve));
  const previous = { base: process.env.OPENAI_BASE_URL, key: process.env.OPENAI_API_KEY };
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${(upstream.address() as { port: number }).port}/v1`;
  delete process.env.OPENAI_API_KEY;
  try {
    await attachVoice("voice-test", "owner-one");
    const peer = [...upstream.clients][0];
    const emit = (event: object) => peer.send(JSON.stringify(event));
    const typed = createCheck({ status: "running", question: "Typed work", imageAttached: false }, "owner-one");
    const other = createCheck({ status: "running", question: "Other user", imageAttached: false }, "owner-two");
    emit({ type: "session.input_transcript.delta", delta: "Was Webb launched in 2019?" });
    emit({ type: "session.delegation.created", delegation: { id: "first", target: "client" } });
    // Speech after the delegation must not leak into that request.
    emit({ type: "session.input_transcript.delta", delta: "When did Apollo 11 land?" });
    const first = await delegatedCheck("voice-test", "owner-one", "first");
    assert.equal(first?.question, "Was Webb launched in 2019?");
    assert.equal(getCheck(typed.id), undefined); assert.ok(getCheck(other.id));
    assert.equal((await delegatedCheck("voice-test", "owner-one", "first"))?.id, first?.id);
    emit({ type: "session.delegation.created", delegation: { id: "second", target: "client" } });
    const second = await delegatedCheck("voice-test", "owner-one", "second");
    assert.match(second!.question, /Latest request: When did Apollo 11 land\?$/);
    assert.equal(getCheck(first!.id), undefined);
    await assert.rejects(delegatedCheck("voice-test", "owner-two", "second"), /unavailable/);
    assert.equal(closeVoice("voice-test", "owner-two"), false);
    updateCheck(second!.id, { status: "running" });
    const signal = checkSignal(second!.id);
    assert.equal(closeVoice("voice-test", "owner-one"), true);
    assert.equal(signal.aborted, false, "ending voice must not abort research");
    assert.equal(getCheck(second!.id)?.status, "running"); assert.ok(getCheck(other.id));
    updateCheck(second!.id, { status: "completed" });
    assert.equal(getCheck(second!.id)?.status, "completed", "results remain available after ending voice");
  } finally {
    closeVoice("voice-test", "owner-one"); resetStore();
    for (const peer of upstream.clients) peer.terminate();
    await new Promise<void>(resolve => upstream.close(() => resolve()));
    if (previous.base === undefined) delete process.env.OPENAI_BASE_URL; else process.env.OPENAI_BASE_URL = previous.base;
    if (previous.key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous.key;
  }
});
