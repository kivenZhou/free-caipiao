import type { BetHit, ParsedRecord, TipBet } from "./types";

/** 根据当前最新期号推算下一期（同年序号 +1） */
export function nextIssueCode(latestCode: string): string {
  const year = Number(latestCode.slice(0, 4));
  const seq = Number(latestCode.slice(4));
  if (!year || !seq) return latestCode;
  return `${year}${String(seq + 1).padStart(3, "0")}`;
}

export function compareBet(bet: TipBet, actual: ParsedRecord): BetHit {
  const redHits = bet.reds.filter((n) => actual.reds.includes(n));
  return {
    redHits,
    redHitCount: redHits.length,
    blueHit: bet.blue === actual.blue,
  };
}

export function formatBalls(reds: number[], blue: number): string {
  return `${reds.map((n) => String(n).padStart(2, "0")).join(" ")} + ${String(blue).padStart(2, "0")}`;
}
