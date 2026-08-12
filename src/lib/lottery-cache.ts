import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { LotteryRecord } from "./types";
import type { LotteryApiResponse } from "./types";
import fallbackRecords from "@/data/ssq-fallback.json";

const CACHE_TTL_SECONDS = 6 * 3600; // 6 小时

function cacheKey(pageSize: number, pageNo: number): string {
  return `lottery:${pageSize}:${pageNo}`;
}

async function getKv(): Promise<KVNamespace | null> {
  try {
    const { env } = await getCloudflareContext();
    return (env as CloudflareEnv).TIPS_KV ?? null;
  } catch {
    return null;
  }
}

export async function isOnCloudflare(): Promise<boolean> {
  try {
    await getCloudflareContext();
    return true;
  } catch {
    return false;
  }
}

export async function readLotteryCache(
  pageSize: number,
  pageNo: number
): Promise<LotteryApiResponse | null> {
  const kv = await getKv();
  if (!kv) return null;
  const raw = await kv.get(cacheKey(pageSize, pageNo));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LotteryApiResponse;
  } catch {
    return null;
  }
}

export async function writeLotteryCache(
  pageSize: number,
  pageNo: number,
  data: LotteryApiResponse
): Promise<void> {
  const kv = await getKv();
  if (!kv) return;
  await kv.put(cacheKey(pageSize, pageNo), JSON.stringify(data), {
    expirationTtl: CACHE_TTL_SECONDS,
  });
}

export function readBundledFallback(
  pageSize: number,
  pageNo: number
): LotteryApiResponse {
  const all = fallbackRecords as LotteryRecord[];
  const start = (pageNo - 1) * pageSize;
  const slice = all.slice(start, start + pageSize);
  return {
    state: 0,
    message: "查询成功（内置快照，可能非最新）",
    total: all.length,
    pageNo,
    pageSize,
    result: slice,
    source: "bundled",
  };
}
