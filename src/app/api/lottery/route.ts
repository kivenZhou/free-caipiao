import { NextResponse } from "next/server";

const LOTTERY_API =
  "https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const pageSize = searchParams.get("pageSize") || "300";
  const pageNo = searchParams.get("pageNo") || "1";

  const url = new URL(LOTTERY_API);
  url.searchParams.set("name", "ssq");
  url.searchParams.set("issueCount", "");
  url.searchParams.set("issueStart", "");
  url.searchParams.set("issueEnd", "");
  url.searchParams.set("dayStart", "");
  url.searchParams.set("dayEnd", "");
  url.searchParams.set("pageNo", pageNo);
  url.searchParams.set("pageSize", pageSize);
  url.searchParams.set("week", "");
  url.searchParams.set("systemType", "PC");

  try {
    const res = await fetch(url.toString(), {
      headers: {
        Referer: "https://www.cwl.gov.cn/",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/json, text/plain, */*",
      },
      // Cloudflare Workers 上 next.revalidate 无效，直接走上游
      cache: "no-store",
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return NextResponse.json(
        {
          error: "Failed to fetch lottery data",
          status: res.status,
          detail: body.slice(0, 200),
        },
        { status: 502 }
      );
    }

    const data = await res.json();
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=600",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Network error", detail: String(err) },
      { status: 500 }
    );
  }
}
