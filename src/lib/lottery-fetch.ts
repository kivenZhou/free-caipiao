import type { LotteryApiResponse, LotteryRecord } from "./types";
import {
  isOnCloudflare,
  readBundledFallback,
  readLotteryCache,
  writeLotteryCache,
} from "./lottery-cache";

const CWL_API =
  "https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice";

const MIRROR_API =
  "https://api.huiniao.top/interface/home/lotteryHistory";

type HuiniaoItem = {
  code: string;
  day: string;
  one: string;
  two: string;
  three: string;
  four: string;
  five: string;
  six: string;
  seven: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pad2(n: string | number): string {
  return String(n).padStart(2, "0");
}

function mapHuiniaoItem(item: HuiniaoItem): LotteryRecord {
  const reds = [item.one, item.two, item.three, item.four, item.five, item.six]
    .map(pad2)
    .join(",");
  return {
    code: item.code,
    date: item.day,
    red: reds,
    blue: pad2(item.seven),
  };
}

function buildResponse(
  pageSize: number,
  pageNo: number,
  result: LotteryRecord[],
  message: string,
  source: LotteryApiResponse["source"]
): LotteryApiResponse {
  return {
    state: 0,
    message,
    total: result.length,
    pageNo,
    pageSize,
    result,
    source,
  };
}

async function fetchFromOfficial(
  pageSize: number,
  pageNo: number
): Promise<LotteryApiResponse> {
  const url = new URL(CWL_API);
  url.searchParams.set("name", "ssq");
  url.searchParams.set("issueCount", "");
  url.searchParams.set("issueStart", "");
  url.searchParams.set("issueEnd", "");
  url.searchParams.set("dayStart", "");
  url.searchParams.set("dayEnd", "");
  url.searchParams.set("pageNo", String(pageNo));
  url.searchParams.set("pageSize", String(pageSize));
  url.searchParams.set("week", "");
  url.searchParams.set("systemType", "PC");

  const res = await fetch(url.toString(), {
    headers: {
      Referer: "https://www.cwl.gov.cn/",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "application/json, text/plain, */*",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`official ${res.status}: ${detail.slice(0, 120)}`);
  }

  const data = (await res.json()) as LotteryApiResponse;
  if (data.state !== 0 || !Array.isArray(data.result)) {
    throw new Error(data.message || "official invalid response");
  }

  return { ...data, source: "cwl" };
}

async function fetchHuiniaoPage(
  page: number,
  limit: number
): Promise<HuiniaoItem[]> {
  const url = new URL(MIRROR_API);
  url.searchParams.set("type", "ssq");
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(limit));

  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`mirror http ${res.status}`);
  }

  const json = (await res.json()) as {
    code?: number;
    info?: string;
    data?: { data?: { list?: HuiniaoItem[] } };
  };

  if (json.code !== 1) {
    throw new Error(json.info || "mirror invalid response");
  }

  return json.data?.data?.list ?? [];
}

/** 串行分页 + 重试，避免备用源限流 */
async function fetchFromMirror(
  pageSize: number,
  pageNo: number
): Promise<LotteryApiResponse> {
  const limit = 100;
  const pagesNeeded = Math.ceil(pageSize / limit);
  const merged: HuiniaoItem[] = [];

  for (let i = 0; i < pagesNeeded; i++) {
    const page = pageNo + i;
    let lastErr: unknown;
    let items: HuiniaoItem[] | null = null;

    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        items = await fetchHuiniaoPage(page, limit);
        break;
      } catch (err) {
        lastErr = err;
        await sleep(500 * (attempt + 1));
      }
    }

    if (!items) {
      throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
    }

    merged.push(...items);
    if (i < pagesNeeded - 1) {
      await sleep(350);
    }
  }

  const result = merged.slice(0, pageSize).map(mapHuiniaoItem);
  if (!result.length) {
    throw new Error("mirror returned empty list");
  }

  return buildResponse(
    pageSize,
    pageNo,
    result,
    "查询成功（备用数据源）",
    "mirror"
  );
}

async function fetchLive(
  pageSize: number,
  pageNo: number
): Promise<LotteryApiResponse> {
  const onCf = await isOnCloudflare();

  if (!onCf) {
    try {
      return await fetchFromOfficial(pageSize, pageNo);
    } catch {
      /* 本地开发失败再试备用源 */
    }
  }

  return fetchFromMirror(pageSize, pageNo);
}

/**
 * 拉取双色球历史（带 KV 缓存 + 内置快照兜底）
 */
export async function fetchLotteryData(
  pageSize: number,
  pageNo: number
): Promise<LotteryApiResponse> {
  const cached = await readLotteryCache(pageSize, pageNo);
  if (cached) {
    return { ...cached, source: "cache" };
  }

  try {
    const data = await fetchLive(pageSize, pageNo);
    await writeLotteryCache(pageSize, pageNo, data);
    return data;
  } catch (liveErr) {
    const stale = await readLotteryCache(pageSize, pageNo);
    if (stale) {
      return { ...stale, source: "cache", message: `${stale.message}（缓存）` };
    }

    const bundled = readBundledFallback(pageSize, pageNo);
    if (bundled.result.length) {
      return bundled;
    }

    throw liveErr;
  }
}

export type { LotteryApiResponse };
