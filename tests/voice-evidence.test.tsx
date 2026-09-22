import assert from "node:assert/strict";
import { it } from "node:test";
import WebSocket, { WebSocketServer } from "ws";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CheckTask } from "../shared/types.ts";
import { checkSources } from "../shared/checkSources.ts";
import { deliverVoiceEvidence, voiceEvidenceParts } from "../server/src/voiceEvidence.ts";
import { CheckResult } from "../web/src/components/CheckResult.tsx";

const task: CheckTask = {
  id: "test-check", question: "Was the launch in 2019?", status: "completed", imageAttached: false, createdAt: "", updatedAt: "",
  claims: [{ id: "c1", text: "Launch date", priority: 1, verdict: "contradicted", basis: "Important context. ".repeat(40) + "实际发射于2021年12月25日，不是2019年。", citationIds: ["f1"], quotes: [{ sourceId: "f1", text: "December 25, 2021" }] }],
  evidence: [
    { id: "f1", kind: "fetched", url: "https://science.nasa.gov/mission/webb/launch/", finalUrl: "https://science.nasa.gov/mission/webb/launch/", title: "NASA launch", excerpt: "December 25, 2021", fetchedAt: "2026-09-19", claimIds: ["c1"] },
    { id: "s1", kind: "search_only", url: "https://example.com/search", finalUrl: "https://example.com/search", title: "Search snippet", excerpt: "Not read", fetchedAt: "", claimIds: [] },
  ],
};

it("passes the full correction, quotes and the exact UI source set to Live without truncation", () => {
  const parts = voiceEvidenceParts(task);
  assert.ok(parts.length > 1);
  assert.ok(parts.every(part => Buffer.byteLength(part) <= 360));
  const data = JSON.parse(parts.join(""));
  assert.equal(data.findings[0].basis, task.claims[0].basis);
  assert.equal(data.findings[0].quotes[0].text, "December 25, 2021");
  assert.deepEqual(data.sources.map((source: { url: string }) => source.url), checkSources(task).map(source => source.finalUrl));
  assert.equal(data.sources.length, 1);
});

it("voice displays only accepted sources, not an independent summary; text-only still shows its answer", () => {
  assert.equal(renderToStaticMarkup(createElement(CheckResult, { task, voice: true })), "");
  const delivered: CheckTask = { ...task, voiceDelivery: { status: "ready", sourceIds: ["f1"] } };
  const voiceHtml = renderToStaticMarkup(createElement(CheckResult, { task: delivered, voice: true }));
  assert.match(voiceHtml, /NASA launch/);
  assert.match(voiceHtml, /<details class="source-disclosure" open="">/);
  assert.match(voiceHtml, /<summary title="Show or hide sources">/);
  assert.doesNotMatch(voiceHtml, /Important context|2019|Search snippet/);
  const textHtml = renderToStaticMarkup(createElement(CheckResult, { task, voice: false }));
  assert.match(textHtml, /实际发射于2021年12月25日/);
  assert.match(textHtml, /<details class="source-disclosure" open="">/);
});

it("waits for evidence acknowledgments before requesting speech, and fails closed on rejection", async () => {
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>(resolve => server.once("listening", resolve));
  const received: any[] = [];
  let rejectEvidence = false;
  server.on("connection", peer => peer.on("message", raw => {
    const event = JSON.parse(String(raw)); received.push(event);
    assert.ok(Buffer.byteLength(event.content) < 500);
    setTimeout(() => peer.send(JSON.stringify({ type: rejectEvidence ? "error" : event.type.replace(/append$/, "appended"), client_event_id: event.event_id })), 5);
  }));
  const socket = new WebSocket(`ws://127.0.0.1:${(server.address() as { port: number }).port}`);
  await new Promise<void>(resolve => socket.once("open", resolve));
  try {
    const pending = deliverVoiceEvidence(socket, task, "delegation-one", AbortSignal.timeout(5000));
    assert.equal(received.filter(event => event.type === "session.commentary.append").length, 0);
    assert.deepEqual(await pending, ["f1"]);
    assert.equal(received.at(-1).type, "session.commentary.append");
    assert.ok(received.every(event => event.delegation_id === "delegation-one"));
    const data = JSON.parse(received.filter(event => event.type === "session.thinking.append").map(event => event.content.slice(event.content.indexOf("\n") + 1)).join(""));
    assert.equal(data.findings[0].basis, task.claims[0].basis);
    received.length = 0; rejectEvidence = true;
    await assert.rejects(deliverVoiceEvidence(socket, task, "delegation-two", AbortSignal.timeout(5000)), /did not accept/);
    assert.ok(received.every(event => event.type !== "session.commentary.append"));
  } finally { socket.close(); for (const peer of server.clients) peer.terminate(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
