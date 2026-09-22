import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
  "metadata.google.internal",
  "metadata.google.internal.",
]);

export function isPrivateIp(ip: string): boolean {
  const value = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (value.includes(":")) {
    if (!isIP(value) || !/^[23][0-9a-f]{3}:/.test(value)) return true;
    return /^(2001:(db8|0|2|10|20):|2002:)/.test(value);
  }
  const parts = value.split(".").map((part) => Number(part));
  if (!isIP(value) || parts.length !== 4) return true;
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224 || (a === 198 && (b === 18 || b === 19))) return true;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  if ((a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113)) return true;
  return false;
}

export function parsePublicHttpUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("URL is not valid");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http and https URLs can be fetched");
  }
  if (parsed.username || parsed.password) {
    throw new Error("URLs with credentials are blocked");
  }
  if (parsed.port) throw new Error("Non-default ports are blocked");
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTS.has(host) || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error("Host is not allowed");
  }
  if (isIP(host) && isPrivateIp(host)) {
    throw new Error("Private IP targets are blocked");
  }
  return parsed;
}

export async function assertPublicHostname(hostname: string): Promise<{ address: string; family: number }> {
  hostname = hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error("Private IP targets are blocked");
    return { address: hostname, family: isIP(hostname) };
  }
  const records = await lookup(hostname, { all: true, verbatim: true });
  if (!records.length) throw new Error("Host did not resolve");
  for (const record of records) {
    if (isPrivateIp(record.address)) {
      throw new Error("Host resolves to a private address");
    }
  }
  return records[0];
}

export async function assertSafeFetchUrl(raw: string): Promise<URL> {
  const parsed = parsePublicHttpUrl(raw);
  await assertPublicHostname(parsed.hostname);
  return parsed;
}
