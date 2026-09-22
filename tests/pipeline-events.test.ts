import assert from "node:assert/strict";
import http from "node:http";
import { it } from "node:test";
import { createApp } from "../server/src/app.ts";
import { resetStore } from "../server/src/store.ts";

it("streams evidence before completion and reports billing failures without exposing SDK details", async () => {
  let calls = 0;
  let exhausted = false;
  const upstream = http.createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      response.setHeader("content-type", "application/json");
      if (exhausted) {
        response.writeHead(429);
        response.end(JSON.stringify({ error: { code: "credit_balance_exhausted", message: "private upstream details", type: "insufficient_quota" } }));
        return;
      }
      const sequence = calls++;
      const text = sequence === 0
        ? JSON.stringify({ claims: [{ text: "Test claim", priority: 1 }] })
        : JSON.stringify({ claims: [{ id: "claim-1", verdict: "insufficient", basis: "No fetched source", citationIds: [] }] });
      response.end(JSON.stringify({ output_text: sequence === 1 ? "" : text, output: sequence === 1
        ? [{ type: "web_search_call", action: { sources: [{ url: "http://127.0.0.1/private", title: "Blocked test source" }] } }]
        : [{ type: "message", role: "assistant", content: [{ type: "output_text", text, annotations: [] }] }] }));
    });
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const previousKey = process.env.OPENAI_API_KEY;
  const previousBase = process.env.OPENAI_BASE_URL;
  process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${(upstream.address() as { port: number }).port}/v1`;
  const app = createApp().listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => app.on("listening", resolve));
  const base = `http://127.0.0.1:${(app.address() as { port: number }).port}`;
  const check = async () => {
    const created = await fetch(`${base}/api/checks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: "Test claim" }) });
    const { id } = await created.json();
    const cookie = created.headers.get("set-cookie")!.split(";")[0];
    return (await fetch(`${base}/api/checks/${id}/events`, { headers: { cookie } })).text();
  };
  try {
    const events = await check();
    assert.ok(events.includes("event: evidence") && events.indexOf("event: evidence") < events.indexOf("event: completed"), events);
    assert.match(events, /"kind":"search_only"/);
    assert.match(events, /"kind":"blocked"/);
    assert.match(events, /"verdict":"insufficient"/);
    assert.equal(calls, 3);
    exhausted = true;
    const failed = await check();
    assert.match(failed, /event: failed/);
    assert.match(failed, /API credits are exhausted/);
    assert.doesNotMatch(failed, /private upstream details/);
  } finally {
    resetStore(); app.close(); upstream.close();
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey;
    if (previousBase === undefined) delete process.env.OPENAI_BASE_URL; else process.env.OPENAI_BASE_URL = previousBase;
  }
});
