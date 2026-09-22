import assert from "node:assert/strict";
import { it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { VoiceChat, voiceErrorMessage } from "../web/src/components/VoiceChat.tsx";

it("keeps idle voice collapsed with accessible conversation and screenshot entry points", () => {
  const html = renderToStaticMarkup(createElement(VoiceChat, {
    onStart() {}, onEnd() {}, onActive() {}, onScreenshot() {}, onText() {}, onCaption() {},
    sourceCount: 0, stopSignal: 0,
  }));
  assert.match(html, /Talk to Milo/);
  assert.match(html, /aria-label="Conversation"/);
  assert.match(html, /aria-label="Screenshot"/);
  assert.match(html, /Microphone off/);
  assert.doesNotMatch(html, /voice-capsule|End call|Voice connected/);
  assert.equal((html.match(/<button/g) || []).length, 3);
});

it("renders exactly four preview controls without claiming a microphone connection", () => {
  const html = renderToStaticMarkup(createElement(VoiceChat, {
    preview: true, onStart() {}, onEnd() {}, onActive() {}, onScreenshot() {}, onText() {}, onCaption() {}, sourceCount: 0, stopSignal: 0,
  }));
  assert.equal((html.match(/<button/g) || []).length, 4);
  for (const label of ["Screenshot", "Conversation", "Mute", "End call"]) assert.ok(html.includes(`aria-label="${label}"`));
  assert.match(html, /Layout preview · microphone off/);
  assert.doesNotMatch(html, /Voice connected/);
  assert.doesNotMatch(html, /voice-avatar|milo-avatar|you-avatar|Connecting voice/);
  assert.match(html, /voice-identity/);
});

it("turns technical connection failures into short actionable messages", () => {
  assert.equal(voiceErrorMessage(new Error("LIVE_UNAVAILABLE: Set OPENAI_API_KEY")), "Voice isn’t configured yet. You can still use chat.");
  assert.match(voiceErrorMessage(new DOMException("denied", "NotAllowedError")), /Microphone access is off/);
  assert.equal(voiceErrorMessage(new Error("network failed")), "Voice couldn’t connect. Please try again.");
});

it("offers an independent floating action without starting the microphone", () => {
  for (const preview of [false, true]) {
    const html = renderToStaticMarkup(createElement(VoiceChat, {
      preview, onFloat() {}, openingFloat: true,
      onStart() {}, onEnd() {}, onActive() {}, onScreenshot() {}, onText() {}, onCaption() {},
      sourceCount: 0, stopSignal: 0,
    }));
    assert.match(html, /aria-label="Float Milo"[^>]*disabled=""/);
    assert.match(html, /Microphone off/);
  }
});

it("exposes the conversation bubble as an explicit text mode toggle", () => {
  for (const textMode of [false, true]) {
    const html = renderToStaticMarkup(createElement(VoiceChat, {
      preview: true, textMode, onStart() {}, onEnd() {}, onActive() {}, onScreenshot() {}, onText() {}, onCaption() {}, sourceCount: 2, stopSignal: 0,
    }));
    assert.match(html, new RegExp(`aria-label="Conversation" aria-pressed="${textMode}"`));
    assert.match(html, new RegExp(textMode ? 'Hide text input' : 'Show text input'));
  }
});
