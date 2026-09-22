import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchUrl } from "../server/src/fetchUrl.ts";

describe("fetch_url", () => {
  it("blocks private targets before sending a request", async () => {
    let called = false;
    const page = await fetchUrl("http://127.0.0.1/admin", async () => {
      called = true;
      return new Response("nope");
    });
    assert.equal(called, false);
    assert.equal(page.kind, "blocked");
    assert.match(page.reason || "", /Private IP|not allowed/);
  });

  it("stores a fetched public HTML excerpt", async () => {
    const page = await fetchUrl("https://example.com/notice", async () => {
      return new Response("<html><title>Notice</title><body>Official denial.</body></html>", {
        headers: { "content-type": "text/html" },
      });
    });
    assert.equal(page.kind, "fetched");
    assert.equal(page.title, "Notice");
    assert.match(page.excerpt, /Official denial/);
    assert.match(page.body!, /Official denial/);
  });

  it("blocks redirect-to-private before following it", async () => {
    let calls = 0;
    const result = await fetchUrl("https://1.1.1.1/", async () => { calls++; return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/admin" } }); });
    assert.equal(calls, 1); assert.equal(result.kind, "blocked");
  });

  it("enforces byte limits while reading and does not label invalid PDFs as read", async () => {
    const large = await fetchUrl("https://1.1.1.1/", async () => new Response("x".repeat(2_000_001), { headers: { "content-type": "text/plain" } }));
    assert.equal(large.kind, "blocked"); assert.match(large.reason!, /size limit/);
    const pdf = await fetchUrl("https://1.1.1.1/a.pdf", async () => new Response("not a PDF", { headers: { "content-type": "application/pdf" } }));
    assert.equal(pdf.kind, "blocked"); assert.equal(pdf.excerpt, "");
  });
});
