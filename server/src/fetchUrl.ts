import http from "node:http";
import https from "node:https";
import { FETCH_BYTE_LIMIT, MAX_REDIRECTS } from "./config.js";
import { assertPublicHostname, assertSafeFetchUrl } from "./ssrf.js";

export interface FetchedPage {
  url: string; finalUrl: string; title: string; excerpt: string; body?: string;
  contentType: string; fetchedAt: string; kind: "fetched" | "blocked"; reason?: string;
}

// Validate DNS and pin the actual connection, including after redirects.
export async function pinnedFetch(raw: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(String(raw));
  const address = await assertPublicHostname(url.hostname);
  init?.signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? https : http).request(url, {
      method: "GET", agent: false, signal: init?.signal ?? undefined,
      headers: { "user-agent": "MiloFactCheck/0.1", "accept-encoding": "identity" },
      lookup: (_host, options, callback) => {
        if ((options as { all?: boolean }).all) (callback as Function)(null, [address]);
        else callback(null, address.address, address.family);
      },
    }, (incoming) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      incoming.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > FETCH_BYTE_LIMIT) request.destroy(new Error("Response exceeded size limit"));
        else chunks.push(chunk);
      });
      incoming.on("error", reject);
      incoming.on("end", () => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (value) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
        }
        const status = incoming.statusCode ?? 502;
        resolve(new Response([204, 205, 304].includes(status) ? null : Buffer.concat(chunks), { status, headers }));
      });
    });
    request.on("error", reject);
    request.end();
  });
}

function textFromHtml(html: string): string {
  return html.replace(/<(script|style|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ").trim();
}

export async function fetchUrl(raw: string, fetcher: typeof fetch = pinnedFetch, parentSignal?: AbortSignal): Promise<FetchedPage> {
  const fetchedAt = new Date().toISOString();
  let current = raw;
  const signal = AbortSignal.any([AbortSignal.timeout(15_000), ...(parentSignal ? [parentSignal] : [])]);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      signal.throwIfAborted();
      const safe = await assertSafeFetchUrl(current);
      signal.throwIfAborted();
      const response = await fetcher(safe, { redirect: "manual", signal });
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        const location = response.headers.get("location");
        if (!location) throw new Error("Redirect missing Location");
        current = new URL(location, safe).toString();
        continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw new Error(`Fetch failed with HTTP ${response.status}`); }
      const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
      if (!/^(text\/(html|plain)|application\/(xhtml\+xml|json|pdf))\b/.test(contentType)) {
        await response.body?.cancel(); throw new Error("Unsupported content type");
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Empty response");
      try {
        while (true) {
          signal.throwIfAborted();
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > FETCH_BYTE_LIMIT) throw new Error("Response exceeded size limit");
          chunks.push(value);
        }
      } finally { await reader.cancel(); }
      const buffer = Buffer.concat(chunks);
      let body = "", title = "";
      if (contentType.includes("application/pdf")) {
        const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
        const loading = getDocument({ data: new Uint8Array(buffer), useSystemFonts: false });
        const abort = () => { void loading.destroy(); };
        signal.addEventListener("abort", abort, { once: true });
        try {
          const pdf = await loading.promise;
          for (let page = 1; page <= Math.min(pdf.numPages, 20); page++) {
            signal.throwIfAborted();
            const content = await (await pdf.getPage(page)).getTextContent();
            body += content.items.map((item) => "str" in item ? item.str : "").join(" ") + "\n";
            if (body.length > 60_000) break;
          }
          title = `PDF (read up to ${Math.min(pdf.numPages, 20)} pages)`;
        } finally { signal.removeEventListener("abort", abort); await loading.destroy(); }
      } else {
        const text = buffer.toString("utf8");
        title = text.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim().slice(0, 200) ?? "";
        body = contentType.includes("html") ? textFromHtml(text) : text;
      }
      body = body.trim().slice(0, 60_000);
      if (!body) throw new Error("No readable text extracted");
      return { url: raw, finalUrl: safe.toString(), title, body, excerpt: body.slice(0, 4000), contentType, fetchedAt, kind: "fetched" };
    }
    throw new Error("Too many redirects");
  } catch (error) {
    return { url: raw, finalUrl: current, title: "", excerpt: "", contentType: "", fetchedAt, kind: "blocked",
      reason: error instanceof Error ? error.message : "Fetch blocked" };
  }
}
