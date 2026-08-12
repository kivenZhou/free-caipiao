import { NextResponse } from "next/server";
import { upsertTip, readTips } from "@/lib/store";
import type { TipSnapshot } from "@/lib/types";

export async function GET() {
  try {
    const tips = await readTips();
    return NextResponse.json({ ok: true, tips });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err) },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Omit<TipSnapshot, "id" | "createdAt"> & {
      id?: string;
      createdAt?: string;
    };

    if (!body.targetIssue || !body.basedOnIssue || !body.bets?.length) {
      return NextResponse.json(
        { ok: false, error: "缺少 targetIssue / basedOnIssue / bets" },
        { status: 400 }
      );
    }

    const tip: TipSnapshot = {
      id: body.id ?? `tip_${body.targetIssue}_${body.pageSize}_${Date.now()}`,
      createdAt: body.createdAt ?? new Date().toISOString(),
      targetIssue: body.targetIssue,
      basedOnIssue: body.basedOnIssue,
      pageSize: body.pageSize ?? 300,
      bets: body.bets,
      strategies: body.strategies,
    };

    const saved = await upsertTip(tip);
    return NextResponse.json({ ok: true, tip: saved });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err) },
      { status: 500 }
    );
  }
}
