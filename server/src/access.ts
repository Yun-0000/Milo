import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

const secret = randomBytes(32);
const sign = (value: string) => createHmac("sha256", secret).update(value).digest("hex");
const rates = new Map<string, { count: number; until: number }>();
const sweep = setInterval(() => { for (const [key, value] of rates) if (value.until < Date.now()) rates.delete(key); }, 60_000);
sweep.unref();

export const access: RequestHandler = (request, response, next) => {
  if (request.path === "/health") { next(); return; }
  if (request.headers.origin && ![process.env.MILO_ORIGIN, `http://${request.headers.host}`, `https://${request.headers.host}`].includes(request.headers.origin)) {
    response.status(403).json({ error: "Cross-origin API requests are not allowed" }); return;
  }
  if (request.headers["sec-fetch-site"] === "cross-site") {
    response.status(403).json({ error: "Cross-site API requests are not allowed" }); return;
  }
  const cookie = request.headers.cookie?.match(/(?:^|;\s*)milo_session=([a-f0-9]+)\.([a-f0-9]+)/);
  let id = cookie?.[1];
  const mac = cookie?.[2] ?? "";
  const valid = id && mac.length === 64 && timingSafeEqual(Buffer.from(mac), Buffer.from(sign(id)));
  if (!valid) {
    const required = process.env.MILO_ACCESS_CODE;
    if ((required && request.headers["x-milo-access-code"] !== required) || (!required && process.env.NODE_ENV === "production")) {
      response.status(401).json({ error: "Preview access code required" }); return;
    }
    id = randomBytes(24).toString("hex");
    response.cookie("milo_session", `${id}.${sign(id)}`, { httpOnly: true, sameSite: "strict", secure: request.secure || process.env.NODE_ENV === "production", maxAge: 15 * 60_000 });
  }
  response.locals.owner = id;
  if (request.method === "POST") {
    const key = request.ip ?? "local";
    const previous = rates.get(key);
    const rate = previous && previous.until > Date.now() ? previous : { count: 0, until: Date.now() + 60_000 };
    rate.count++;
    rates.set(key, rate);
    if (rate.count > 30) { response.status(429).json({ error: "Too many requests; try again shortly" }); return; }
  }
  next();
};
