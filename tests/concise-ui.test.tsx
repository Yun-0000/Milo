import assert from "node:assert/strict";
import { it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SourceEvidence } from "../shared/types.ts";
import { SourceCards } from "../web/src/components/SourceCards.tsx";
import { readImageFile } from "../web/src/capture.ts";
import { ScreenshotCheck } from "../web/src/components/ScreenshotCheck.tsx";

it("keeps image options to capture, upload and close without a drop-zone or editing form", () => {
  const html = renderToStaticMarkup(createElement(ScreenshotCheck, { onConfirm() {}, onClose() {} }));
  assert.match(html, /Capture screen/);
  assert.match(html, /type="file"/);
  assert.match(html, /Close image options/);
  assert.doesNotMatch(html, /class="drop"|<h2|Crop X|Use this screenshot/);
});

it("shows only deduplicated readable source links, without snippets or research metadata", () => {
  const source: SourceEvidence = { id: "one", url: "https://example.com/fact", finalUrl: "https://example.com/fact", title: "Primary source", fetchedAt: "2026-09-19", excerpt: "Hidden research excerpt", kind: "fetched", claimIds: [] };
  const html = renderToStaticMarkup(createElement(SourceCards, { evidence: [source, { ...source, id: "duplicate" }, { ...source, id: "search", kind: "search_only", finalUrl: "https://example.com/search" }] }));
  assert.equal((html.match(/<a /g) ?? []).length, 1);
  assert.match(html, /href="https:\/\/example.com\/fact"/);
  assert.match(html, /Primary source/);
  assert.doesNotMatch(html, /Hidden research excerpt|2026-09-19|example.com\/search/);
});

it("rejects invalid image uploads before decoding or reading their contents", async () => {
  for (const file of [new File(["text"], "note.txt", { type: "text/plain" }), new File([], "empty.png", { type: "image/png" }), new File([new Uint8Array(5_000_001)], "huge.png", { type: "image/png" })]) {
    await assert.rejects(readImageFile(file), /PNG, JPEG or WebP image under 5 MB/);
  }
});
