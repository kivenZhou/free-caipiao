import { NextResponse } from "next/server";
import { fetchLotteryData } from "@/lib/lottery-fetch";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const pageSize = Math.min(
    2000,
    Math.max(1, Number(searchParams.get("pageSize") || "300"))
  );
  const pageNo = Math.max(1, Number(searchParams.get("pageNo") || "1"));

  try {
    const data = await fetchLotteryData(pageSize, pageNo);
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=600",
        "X-Lottery-Source": data.source ?? "unknown",
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "Failed to fetch lottery data",
        detail: String(err),
      },
      { status: 502 }
    );
  }
}
