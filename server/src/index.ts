import { createApp } from "./app.js";
import { listenHost, listenPort } from "./config.js";
import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");

const app = createApp();
const port = listenPort();
const host = listenHost();

app.listen(port, host, () => {
  console.log(`Milo listening on http://${host}:${port}`);
});
