import { promises as fs } from "fs";
import path from "path";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { TipSnapshot } from "./types";

const TIPS_KEY = "tips";
const DATA_DIR = path.join(process.cwd(), "data");
const TIPS_FILE = path.join(DATA_DIR, "tips.json");

function parseTips(raw: string | null): TipSnapshot[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw) as TipSnapshot[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function getKv(): Promise<KVNamespace | null> {
  try {
    const { env } = await getCloudflareContext();
    return (env as CloudflareEnv).TIPS_KV ?? null;
  } catch {
    return null;
  }
}

async function isOnCloudflare(): Promise<boolean> {
  try {
    await getCloudflareContext();
    return true;
  } catch {
    return false;
  }
}

async function ensureLocalStore(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(TIPS_FILE);
  } catch {
    await fs.writeFile(TIPS_FILE, "[]", "utf8");
  }
}

export async function readTips(): Promise<TipSnapshot[]> {
  const kv = await getKv();
  if (kv) {
    return parseTips(await kv.get(TIPS_KEY));
  }

  if (await isOnCloudflare()) {
    // Workers 上未绑定 KV 时降级，避免 fs 报错
    return [];
  }

  await ensureLocalStore();
  const raw = await fs.readFile(TIPS_FILE, "utf8");
  return parseTips(raw);
}

export async function writeTips(tips: TipSnapshot[]): Promise<void> {
  const payload = JSON.stringify(tips, null, 2);
  const kv = await getKv();
  if (kv) {
    await kv.put(TIPS_KEY, payload);
    return;
  }

  if (await isOnCloudflare()) {
    return;
  }

  await ensureLocalStore();
  await fs.writeFile(TIPS_FILE, payload, "utf8");
}

/**
 * 按 targetIssue + pageSize 去重写入：
 * 同一目标期、同一数据范围若已存在则保留首次存档（不覆盖号码）。
 */
export async function upsertTip(tip: TipSnapshot): Promise<TipSnapshot> {
  const tips = await readTips();
  const idx = tips.findIndex(
    (t) => t.targetIssue === tip.targetIssue && t.pageSize === tip.pageSize
  );
  if (idx >= 0) {
    return tips[idx];
  }
  tips.unshift(tip);
  await writeTips(tips);
  return tip;
}
