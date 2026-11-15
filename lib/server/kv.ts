// SERVER-ONLY. Small key-value store: Upstash Redis on Vercel (KV_REST_* or UPSTASH_REDIS_*),
// otherwise JSON files under data/demo-sessions/ for local dev and vitest.

import { Redis } from "@upstash/redis";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const FILE_DIR = path.join(process.cwd(), "data", "demo-sessions");

function redisClient(): Redis | null {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    return Redis.fromEnv();
  }
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

let redis: Redis | null | undefined;

function getRedis(): Redis | null {
  if (redis === undefined) redis = redisClient();
  return redis;
}

function filePath(key: string): string {
  const safe = Buffer.from(key, "utf8").toString("base64url");
  return path.join(FILE_DIR, `${safe}.json`);
}

export function persistentStoreReady(): boolean {
  return Boolean(getRedis()) || process.env.NODE_ENV !== "production" || !process.env.VERCEL;
}

export async function kvGet(key: string): Promise<string | null> {
  const r = getRedis();
  if (r) {
    const value = await r.get<string>(key);
    return value ?? null;
  }
  try {
    return await readFile(filePath(key), "utf8");
  } catch {
    return null;
  }
}

export async function kvSet(key: string, value: string, ttlSec?: number): Promise<void> {
  const r = getRedis();
  if (r) {
    if (ttlSec && ttlSec > 0) await r.set(key, value, { ex: ttlSec });
    else await r.set(key, value);
    return;
  }
  await mkdir(FILE_DIR, { recursive: true });
  await writeFile(filePath(key), value, "utf8");
}

export async function kvDel(key: string): Promise<void> {
  const r = getRedis();
  if (r) {
    await r.del(key);
    return;
  }
  try {
    await unlink(filePath(key));
  } catch {
    // missing file is fine
  }
}

/** Fixed-window counter shared across serverless instances when Redis is configured. */
export async function kvIncrWindow(key: string, windowMs: number, now: number): Promise<number> {
  const r = getRedis();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const windowKey = `${key}:${windowStart}`;
  if (!r) return -1;
  const count = await r.incr(windowKey);
  if (count === 1) await r.expire(windowKey, Math.max(1, Math.ceil(windowMs / 1000)));
  return count;
}

export function resetKvFileStoreForTests() {
  redis = null;
}

const fileLocks = new Map<string, Promise<void>>();

async function withFileScopeLock<T>(scopeId: string, fn: () => Promise<T>): Promise<T> {
  const key = `lock:${scopeId}`;
  const prev = fileLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chain = prev.then(() => gate);
  fileLocks.set(
    key,
    chain.finally(() => {
      if (fileLocks.get(key) === chain) fileLocks.delete(key);
    }),
  );
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

/** Serializes purchase commits per scope (Redis NX lock on Vercel, in-process queue on disk). */
export async function withScopeLock<T>(scopeId: string, fn: () => Promise<T>): Promise<T> {
  if (!scopeId) return fn();
  const r = getRedis();
  const lockKey = `melit:lock:${scopeId}`;
  if (r) {
    for (let attempt = 0; attempt < 60; attempt++) {
      const ok = await r.set(lockKey, "1", { nx: true, ex: 45 });
      if (ok === "OK") {
        try {
          return await fn();
        } finally {
          await r.del(lockKey);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Could not acquire financial lock for scope ${scopeId}`);
  }
  return withFileScopeLock(scopeId, fn);
}