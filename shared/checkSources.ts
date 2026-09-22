import type { CheckTask } from "./types.js";

/** One citation selection for the UI and the exact evidence handed to Live. */
export function checkSources(task?: CheckTask) {
  if (!task || task.status !== "completed") return [];
  const cited = new Set(task.claims.flatMap((claim) => claim.citationIds ?? []));
  return task.evidence.filter((source) => source.kind === "fetched" && cited.has(source.id));
}
