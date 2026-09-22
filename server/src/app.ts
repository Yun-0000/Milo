import express, { type ErrorRequestHandler } from "express";
import path from "node:path";
import { checksRouter } from "./routes/checks.js";
import { liveRouter } from "./routes/live.js";
import { access } from "./access.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use((_request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "no-referrer");
    next();
  });
  app.use(express.json({ limit: "8mb" }));
  app.use("/api", access);
  app.get("/api/session", (_request, response) => response.json({ ok: true }));

  app.get("/api/health", (_request, response) => {
    response.json({
      ok: true,
      product: "Milo",
      live: "gpt-live-1",
      evidence: "gpt-5.6-terra",
      keys: Boolean(process.env.OPENAI_API_KEY?.trim()),
    });
  });

  app.use("/api/live", liveRouter);
  app.use("/api/checks", checksRouter);
  app.use("/api", (_request, response) => response.status(404).json({ error: "API route not found" }));

  const staticDir = path.resolve(process.cwd(), "web-dist");
  app.use(express.static(staticDir));
  app.get(/^(?!\/api\/).*/, (request, response, next) => {
    if (request.method !== "GET") {
      next();
      return;
    }
    response.sendFile(path.join(staticDir, "index.html"), (error) => {
      if (error) next();
    });
  });

  const handleError: ErrorRequestHandler = (error, _request, response, _next) => {
    const status = error?.type === "entity.too.large" ? 413 : error?.type === "entity.parse.failed" ? 400 : 500;
    response.status(status).json({ error: status === 413 ? "Request too large" : status === 400 ? "Invalid JSON request" : "Request failed. Please retry." });
  };
  app.use(handleError);
  return app;
}
