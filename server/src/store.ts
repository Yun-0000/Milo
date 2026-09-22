import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { CheckEvent, CheckTask } from "../../shared/types.js";
import { SESSION_TTL_MS } from "./config.js";

interface StoredCheck {
  task: CheckTask;
  events: CheckEvent[];
  emitter: EventEmitter;
  messages: string[];
  timer: NodeJS.Timeout;
  controller: AbortController;
  owner?: string;
}

const checks = new Map<string, StoredCheck>();

function touch(entry: StoredCheck): void {
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => deleteCheck(entry.task.id), SESSION_TTL_MS);
  entry.timer.unref();
}

export function createCheck(partial: Omit<CheckTask, "id" | "createdAt" | "updatedAt" | "claims" | "evidence"> & Partial<CheckTask>, owner?: string): CheckTask {
  if (owner && [...checks.values()].some((entry) => entry.owner === owner && ["queued", "running"].includes(entry.task.status))) {
    throw new Error("A check is already running; cancel it first.");
  }
  const now = new Date().toISOString();
  const task: CheckTask = {
    id: randomUUID(),
    claims: [],
    evidence: [],
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
  const entry: StoredCheck = {
    task,
    events: [],
    emitter: new EventEmitter(),
    messages: [],
    timer: setTimeout(() => deleteCheck(task.id), SESSION_TTL_MS),
    controller: new AbortController(),
    owner,
  };
  checks.set(task.id, entry);
  entry.timer.unref();
  return task;
}

export function getCheck(id: string): CheckTask | undefined {
  return checks.get(id)?.task;
}

export function ownsCheck(id: string, owner: string): boolean {
  return checks.get(id)?.owner === owner;
}

/** An explicit new voice request supersedes this owner's in-flight text or voice work. */
export function cancelActiveChecks(owner: string): void {
  for (const [id, entry] of checks) {
    if (entry.owner === owner && ["queued", "running"].includes(entry.task.status)) deleteCheck(id);
  }
}

export function checkSignal(id: string): AbortSignal {
  return checks.get(id)?.controller.signal ?? AbortSignal.abort();
}

export function getMessages(id: string): string[] {
  return checks.get(id)?.messages.slice() ?? [];
}

export function addMessage(id: string, text: string): CheckTask | undefined {
  const entry = checks.get(id);
  if (!entry) return undefined;
  entry.messages.push(text);
  entry.task.updatedAt = new Date().toISOString();
  touch(entry);
  return entry.task;
}

export function updateCheck(id: string, patch: Partial<CheckTask>): CheckTask | undefined {
  const entry = checks.get(id);
  if (!entry) return undefined;
  entry.task = { ...entry.task, ...patch, updatedAt: new Date().toISOString() };
  touch(entry);
  return entry.task;
}

export function emitEvent(id: string, event: Omit<CheckEvent, "at" | "checkId"> & Partial<CheckEvent>): CheckEvent | undefined {
  const entry = checks.get(id);
  if (!entry) return undefined;
  const full: CheckEvent = {
    ...event,
    type: event.type,
    at: event.at ?? new Date().toISOString(),
    checkId: id,
  };
  entry.events.push(full);
  entry.emitter.emit("event", full);
  touch(entry);
  return full;
}

export function listEvents(id: string): CheckEvent[] {
  return checks.get(id)?.events.slice() ?? [];
}

export function subscribe(id: string, listener: (event: CheckEvent) => void): (() => void) | undefined {
  const entry = checks.get(id);
  if (!entry) return undefined;
  entry.emitter.on("event", listener);
  return () => entry.emitter.off("event", listener);
}

export function deleteCheck(id: string): boolean {
  const entry = checks.get(id);
  if (!entry) return false;
  clearTimeout(entry.timer);
  entry.controller.abort();
  entry.task.status = "cancelled";
  entry.emitter.emit("event", {
    type: "cancelled",
    at: new Date().toISOString(),
    checkId: id,
    task: entry.task,
  } satisfies CheckEvent);
  checks.delete(id);
  return true;
}

export function resetStore(): void {
  for (const id of checks.keys()) deleteCheck(id);
}
