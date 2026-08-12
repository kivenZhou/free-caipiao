import type { LotteryRecord } from "./types";

const CWL_API =
  "https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice";

const MIRROR_API =
  "https://api.huiniao.top/interface/home/lotteryHistory";

export interface LotteryApiResponse {
  state: number;
  message: string;
  total: number;
  pageNo: number;
  pageSize: number;
  result: LotteryRecord[];
  source?: "cwl" | "mirror";
}

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

async function fetchHuiniaoPage(page: number, limit: number): Promise<HuiniaoItem[]> {
  const url = new URL(MIRROR_API);
  url.searchParams.set("type", "ssq");
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(limit));

  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (compatible; free-caipiao/1.0; +https://github.com/)",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`mirror ${res.status}`);
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

/** 备用源分页拉取，合并为与福彩官网一致的结构 */
async function fetchFromMirror(
  pageSize: number,
  pageNo: number
): Promise<LotteryApiResponse> {
  const limit = 100;
  const startPage = pageNo;
  const pagesNeeded = Math.ceil(pageSize / limit);
  const pageNumbers = Array.from(
    { length: pagesNeeded },
    (_, i) => startPage + i
  );

  const chunks = await Promise.all(
    pageNumbers.map((page) => fetchHuiniaoPage(page, limit))
  );
  const merged = chunks.flat().slice(0, pageSize);

  if (!merged.length) {
    throw new Error("mirror returned empty list");
  }

  return {
    state: 0,
    message: "查询成功（备用数据源）",
    total: merged.length,
    pageNo,
    pageSize,
    result: merged.map(mapHuiniaoItem),
    source: "mirror",
  };
}

/**
 * 拉取双色球历史：
 * 1. 优先福彩官网（本地开发通常可用）
 * 2. Cloudflare 等海外节点常被 WAF 403 → 自动切备用源
 */
export async function fetchLotteryData(
  pageSize: number,
  pageNo: number
): Promise<LotteryApiResponse> {
  try {
    return await fetchFromOfficial(pageSize, pageNo);
  } catch (officialErr) {
    try {
      return await fetchFromMirror(pageSize, pageNo);
    } catch (mirrorErr) {
      throw new Error(
        `official failed: ${String(officialErr)}; mirror failed: ${String(mirrorErr)}`
      );
    }
  }
}
