import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const pageSize = searchParams.get("pageSize") || "300";
  const pageNo = searchParams.get("pageNo") || "1";

  const url = new URL(
    "http://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice"
  );
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
        Referer: "http://www.cwl.gov.cn/",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
      next: { revalidate: 3600 },
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: "Failed to fetch lottery data", status: res.status },
        { status: 502 }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: "Network error", detail: String(err) },
      { status: 500 }
    );
  }
}
