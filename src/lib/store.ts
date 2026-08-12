import { promises as fs } from "fs";
import path from "path";
import type { TipSnapshot } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const TIPS_FILE = path.join(DATA_DIR, "tips.json");

async function ensureStore(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(TIPS_FILE);
  } catch {
    await fs.writeFile(TIPS_FILE, "[]", "utf8");
  }
}

export async function readTips(): Promise<TipSnapshot[]> {
  await ensureStore();
  const raw = await fs.readFile(TIPS_FILE, "utf8");
  try {
    const data = JSON.parse(raw) as TipSnapshot[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function writeTips(tips: TipSnapshot[]): Promise<void> {
  await ensureStore();
  await fs.writeFile(TIPS_FILE, JSON.stringify(tips, null, 2), "utf8");
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
