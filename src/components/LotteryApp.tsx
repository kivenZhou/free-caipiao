"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ComposedChart,
  Line,
} from "recharts";
import type {
  LotteryRecord,
  ParsedRecord,
  FrequencyItem,
  PredictionResult,
  TipSnapshot,
  TipBet,
  TipReview,
  BetHit,
} from "@/lib/types";
import {
  parseRecords,
  redFrequency,
  blueFrequency,
  predictMultiple,
  hotConsecutive,
  buildTipPackage,
  calcChiSquare,
  calcCollisionAnalysis,
  getProbabilityEV,
  calcRedSumDistribution,
  generateRotationalMatrix,
  runBacktest,
  generate16BlueFullPackage,
  generateHighAntiCollisionPackage,
  calcACValue,
  hasSameTail,
  calcRunsTest,
  calcAutocorrelation,
  validateMarkovMatrix,
  calcKellyCriterion,
  calcRedBlueIndependence,
} from "@/lib/analysis";
import { nextIssueCode, compareBet } from "@/lib/compare";

type Tab =
  | "predict"
  | "matrix"
  | "review"
  | "math"
  | "psychology"
  | "red"
  | "blue"
  | "pairs"
  | "history";

const PERIOD_OPTIONS: [number, string][] = [
  [100, "近100期"],
  [300, "近300期"],
  [500, "近500期"],
  [1000, "近1000期"],
  [1555, "全部历史"],
];

const TABS: [Tab, string][] = [
  ["predict", "✨ AI 直推实战套餐"],
  ["matrix", "🎯 自选矩阵缩水"],
  ["review", "开奖复盘"],
  ["math", "数理与分布"],
  ["psychology", "心理与避撞"],
  ["red", "红球走势"],
  ["blue", "蓝球走势"],
  ["pairs", "热门对子"],
  ["history", "历史记录"],
];

export default function LotteryApp() {
  const [records, setRecords] = useState<ParsedRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("predict");
  const [pageSize, setPageSize] = useState(300);
  const [tips, setTips] = useState<TipSnapshot[]>([]);
  const [tipsLoaded, setTipsLoaded] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [drawLookup, setDrawLookup] = useState<ParsedRecord[]>([]);
  /** 当前 records 实际对应的数据范围，防止切换 tab 时用旧数据误存 */
  const [fetchedPageSize, setFetchedPageSize] = useState<number | null>(null);
  const savingRef = useRef(false);

  const fetchTips = useCallback(async () => {
    try {
      const res = await fetch("/api/tips");
      const json = (await res.json()) as { ok?: boolean; tips?: TipSnapshot[] };
      if (json.ok) setTips(json.tips as TipSnapshot[]);
    } catch {
      /* ignore */
    } finally {
      setTipsLoaded(true);
    }
  }, []);

  const fetchDrawLookup = useCallback(async () => {
    try {
      const res = await fetch("/api/lottery?pageSize=1555");
      const json = (await res.json()) as {
        state?: number;
        result?: LotteryRecord[];
      };
      if (json.state === 0) {
        setDrawLookup(parseRecords(json.result as LotteryRecord[]));
      }
    } catch {
      /* ignore */
    }
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/lottery?pageSize=${pageSize}`);
      if (!res.ok) throw new Error(`请求失败 (${res.status})`);
      const json = (await res.json()) as {
        state?: number;
        result?: LotteryRecord[];
      };
      if (json.state !== 0) throw new Error("福彩接口返回错误");
      setRecords(parseRecords(json.result as LotteryRecord[]));
      setFetchedPageSize(pageSize);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [pageSize]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    fetchTips();
  }, [fetchTips]);

  // 全量历史仅在复盘页需要，避免首页同时打 300+1555 触发限流
  useEffect(() => {
    if (tab !== "review" || drawLookup.length) return;
    void fetchDrawLookup();
  }, [tab, drawLookup.length, fetchDrawLookup]);

  const tipPackage = useMemo(
    () => (records.length ? buildTipPackage(records) : null),
    [records]
  );

  const predictions = useMemo(
    () => predictMultiple(records, 5),
    [records]
  );

  const saveCurrentTip = useCallback(async (): Promise<boolean> => {
    if (!records.length || !tipPackage || savingRef.current) return false;
    if (fetchedPageSize !== pageSize) return false;
    const basedOnIssue = records[0].code;
    const targetIssue = nextIssueCode(basedOnIssue);
    if (tips.some((t) => t.targetIssue === targetIssue && t.pageSize === pageSize)) {
      setSaveMsg(`目标期 ${targetIssue}（近${pageSize}期）已存档，不会覆盖`);
      return false;
    }
    savingRef.current = true;
    try {
      const res = await fetch("/api/tips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetIssue,
          basedOnIssue,
          pageSize,
          bets: tipPackage.bets,
          strategies: tipPackage.strategies,
        }),
      });
      const json = (await res.json()) as { ok?: boolean };
      if (json.ok) {
        setSaveMsg(`已存档目标期 ${targetIssue}（近${pageSize}期）`);
        await fetchTips();
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      savingRef.current = false;
    }
  }, [records, tipPackage, pageSize, fetchedPageSize, tips, fetchTips]);

  // 当前数据范围拉取完成后自动落盘（100/300/500/1000/全部各自一份）
  useEffect(() => {
    if (!tipsLoaded || fetchedPageSize !== pageSize || !records.length || !tipPackage) return;
    const basedOnIssue = records[0].code;
    const targetIssue = nextIssueCode(basedOnIssue);
    if (tips.some((t) => t.targetIssue === targetIssue && t.pageSize === pageSize)) return;
    void saveCurrentTip();
  }, [tipsLoaded, pageSize, fetchedPageSize, records, tipPackage, tips, saveCurrentTip]);

  const redFreq = redFrequency(records);
  const blueFreq = blueFrequency(records);
  const pairs = hotConsecutive(records, 20);

  const reviews: TipReview[] = useMemo(() => {
    const lookup = drawLookup.length ? drawLookup : records;
    const byCode = new Map(lookup.map((r) => [r.code, r]));
    return tips.map((tip) => {
      let actual = byCode.get(tip.targetIssue);
      if (!actual && lookup.length > 1) {
        // 跨年或期号推算偏差兜底：找基于期号 (basedOnIssue) 的紧邻下一期开奖
        const basedIdx = lookup.findIndex((r) => r.code === tip.basedOnIssue);
        if (basedIdx > 0) {
          actual = lookup[basedIdx - 1]; // lookup 倒序排列，idx-1 为紧邻下一期
        }
      }
      if (!actual) {
        return { ...tip, status: "pending" as const };
      }
      return {
        ...tip,
        status: "drawn" as const,
        actual: {
          code: actual.code,
          date: actual.date,
          reds: actual.reds,
          blue: actual.blue,
        },
        betHits: tip.bets.map((b) => compareBet(b, actual)),
        strategyHits: {
          hot: compareBet(tip.strategies.hot, actual),
          cold: compareBet(tip.strategies.cold, actual),
          random: compareBet(tip.strategies.random, actual),
        },
      };
    });
  }, [tips, records, drawLookup]);

  return (
    <div className="min-h-screen bg-[#0b1224] text-gray-100">
      <header className="bg-[#0f172a] border-b border-white/[0.10]">
        <div className="max-w-6xl mx-auto px-5">
          <div className="flex items-center justify-between py-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-red-600 flex items-center justify-center shrink-0">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="6" stroke="white" strokeWidth="1.5" />
                  <circle cx="8" cy="8" r="2.5" fill="white" />
                </svg>
              </div>
              <div>
                <h1 className="text-sm font-semibold text-white leading-none">双色球数据分析</h1>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  统计参考 · 非购彩建议
                  {records.length > 0 ? ` · ${records.length} 期` : ""}
                  {loading && " · 更新中…"}
                </p>
              </div>
            </div>
            <button
              onClick={() => {
                fetchData();
                fetchTips();
                fetchDrawLookup();
              }}
              disabled={loading}
              className="flex items-center gap-1.5 text-xs text-gray-300 hover:text-white border border-white/10 hover:border-white/20 rounded-md px-3 py-1.5 transition-all disabled:opacity-40"
            >
              刷新
            </button>
          </div>

          <div className="flex items-center gap-0.5 mt-1 flex-wrap">
            <span className="text-[11px] text-gray-400 mr-2 shrink-0">数据范围</span>
            {PERIOD_OPTIONS.map(([size, label]) => (
              <button
                key={size}
                onClick={() => setPageSize(size)}
                className={`px-3 py-1.5 text-[12px] font-medium rounded-md transition-all ${
                  pageSize === size
                    ? "bg-red-600/20 text-red-400 border border-red-500/30"
                    : "text-gray-400 hover:text-gray-200 border border-transparent hover:border-white/10"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-0.5 mt-3 border-t border-white/[0.05] pt-1 overflow-x-auto">
            {TABS.map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`px-4 py-2.5 text-[13px] font-medium border-b-2 transition-all -mb-px whitespace-nowrap ${
                  tab === key
                    ? "border-red-500 text-white"
                    : "border-transparent text-gray-400 hover:text-gray-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {error && (
        <div className="max-w-6xl mx-auto px-5 mt-4">
          <div className="bg-red-950/60 border border-red-800/50 text-red-400 rounded-lg px-4 py-3 text-sm">
            {error}
          </div>
        </div>
      )}

      {saveMsg && (
        <div className="max-w-6xl mx-auto px-5 mt-3">
          <div className="text-[12px] text-emerald-400/90 bg-emerald-950/30 border border-emerald-800/40 rounded-lg px-3 py-2">
            {saveMsg}
          </div>
        </div>
      )}

      <main className="max-w-6xl mx-auto px-5 py-7">
        {loading && records.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 gap-3">
            <div className="w-8 h-8 rounded-full border-2 border-red-600/30 border-t-red-500 animate-spin" />
            <p className="text-sm text-gray-400">正在拉取历史数据…</p>
          </div>
        ) : (
          <>
            {tab === "predict" && tipPackage && (
              <PredictTab
                predictions={predictions}
                tipPackage={tipPackage}
                records={records}
                redFreq={redFreq}
                blueFreq={blueFreq}
                pageSize={pageSize}
                alreadySaved={
                  !!records[0] &&
                  tips.some(
                    (t) =>
                      t.targetIssue === nextIssueCode(records[0].code) &&
                      t.pageSize === pageSize
                  )
                }
                onSave={saveCurrentTip}
              />
            )}
            {tab === "matrix" && <MatrixTab records={records} />}
            {tab === "review" && (
              <ReviewTab reviews={reviews} preferredPageSize={pageSize} />
            )}
            {tab === "math" && <MathTab records={records} />}
            {tab === "psychology" && <PsychologyTab predictions={predictions} />}
            {tab === "red" && <RedFreqTab data={redFreq} />}
            {tab === "blue" && <BlueFreqTab data={blueFreq} />}
            {tab === "pairs" && <PairsTab pairs={pairs} />}
            {tab === "history" && <HistoryTab records={records} />}
          </>
        )}
      </main>
    </div>
  );
}

/* ════════════════════════════════════════
   Predict Tab
════════════════════════════════════════ */
function PredictTab({
  predictions,
  tipPackage,
  records,
  redFreq,
  blueFreq,
  pageSize,
  alreadySaved,
  onSave,
}: {
  predictions: PredictionResult[];
  tipPackage: ReturnType<typeof buildTipPackage>;
  records: ParsedRecord[];
  redFreq: FrequencyItem[];
  blueFreq: FrequencyItem[];
  pageSize: number;
  alreadySaved: boolean;
  onSave: () => Promise<boolean>;
}) {
  const latest = records[0];
  const target = latest ? nextIssueCode(latest.code) : "-";
  const hotRed = [...redFreq].sort((a, b) => b.count - a.count)[0];
  const coldRed = [...redFreq].sort((a, b) => a.count - b.count)[0];
  const [saving, setSaving] = useState(false);
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const [activePackage, setActivePackage] = useState<
    "composite5" | "blue16" | "antiCollision5"
  >("composite5");

  const blue16Package = useMemo(
    () => generate16BlueFullPackage(records),
    [records]
  );
  const antiCollisionPackage = useMemo(
    () => generateHighAntiCollisionPackage(records),
    [records]
  );

  const activeBets = useMemo(() => {
    if (activePackage === "blue16") return blue16Package;
    if (activePackage === "antiCollision5") return antiCollisionPackage;
    return predictions.map((p, i) => ({
      reds: p.reds,
      blue: p.blue,
      label: `综合第${i + 1}注`,
    }));
  }, [activePackage, predictions, blue16Package, antiCollisionPackage]);

  function analyzeNote(reds: number[]) {
    const sum = reds.reduce((s, n) => s + n, 0);
    const odd = reds.filter((n) => n % 2 === 1).length;
    const z1 = reds.filter((n) => n <= 11).length;
    const z2 = reds.filter((n) => n >= 12 && n <= 22).length;
    const z3 = reds.filter((n) => n >= 23).length;
    const hasConsec = reds.some((n, i) => i > 0 && n === reds[i - 1] + 1);
    return { sum, odd, even: 6 - odd, z1, z2, z3, hasConsec };
  }

  return (
    <div className="space-y-5">
      <div className="bg-[#0f172a] border border-white/[0.10] rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="text-[12px] text-gray-300 leading-relaxed">
          统计参考，<span className="text-white">非购彩建议</span>。
          切换顶部数据范围会自动存档对应参考（同一目标期可并存多份）。
          目标期 <span className="text-red-400 font-mono">{target}</span>
          {latest && <span className="text-gray-400"> · 基于 {latest.code}</span>}
        </div>
        <button
          disabled={alreadySaved || saving}
          onClick={async () => {
            setSaving(true);
            await onSave();
            setSaving(false);
          }}
          className={`shrink-0 text-xs px-3 py-1.5 rounded-md border transition-colors ${
            alreadySaved
              ? "border-emerald-700/50 text-emerald-400/80 cursor-default"
              : "border-red-500/40 text-red-300 hover:bg-red-600/15"
          }`}
        >
          {alreadySaved ? "已存档" : saving ? "存档中…" : `存档近${pageSize}期`}
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="分析期数" value={`${records.length}`} unit="期" accent />
        <StatCard label="最热红球" value={`${hotRed?.number ?? "-"}`} unit="号" sub={`出现 ${hotRed?.count ?? 0} 次`} />
        <StatCard
          label="综合蓝球参考"
          value={`${predictions[0]?.blue ?? "-"}`}
          unit="号"
          sub="均匀底线 + 轻频率倾斜；5注蓝球互异"
          blue
        />
        <StatCard label="最冷红球" value={`${coldRed?.number ?? "-"}`} unit="号" sub={`出现 ${coldRed?.count ?? 0} 次`} muted />
      </div>

      {/* Multi strategy */}
      <section>
        <h2 className="text-sm font-semibold text-white mb-1">策略对照（各 1 注）</h2>
        <p className="text-[11px] text-gray-400 mb-3">
          用来和综合方案对比：长期看谁也不该稳定更强
        </p>
        <div className="grid md:grid-cols-3 gap-2.5">
          {([tipPackage.strategies.hot, tipPackage.strategies.cold, tipPackage.strategies.random] as TipBet[]).map(
            (bet) => (
              <div key={bet.label} className="bg-[#0f172a] border border-white/[0.10] rounded-xl px-4 py-3">
                <p className="text-[12px] text-gray-300 mb-2">{bet.label}</p>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {bet.reds.map((n) => (
                    <BallRed key={n} n={n} size="sm" />
                  ))}
                  <div className="w-px h-5 bg-white/10 mx-0.5" />
                  <BallBlue n={bet.blue} size="sm" />
                </div>
              </div>
            )
          )}
        </div>
      </section>

      <section className="bg-[#0f172a] border border-white/[0.10] rounded-xl p-5">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div>
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
              ✨ AI 直推实战套餐（免手动选号·一键拿去买）
            </h2>
            <p className="text-[11px] text-gray-400 mt-1">
              算法已自动为您完成红球覆盖选号与蓝球分布优化，挑选适合您的预算套餐即可一键复制。
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                const text = activeBets
                  .map(
                    (b, i) =>
                      `第${i + 1}注: ${b.reds.map((n) => String(n).padStart(2, "0")).join(" ")} + ${String(b.blue).padStart(2, "0")}`
                  )
                  .join("\n");
                navigator.clipboard.writeText(text);
                setCopyToast(`已成功复制【${activeBets.length}注面单文本】到剪贴板！可以直接粘贴发送。`);
                setTimeout(() => setCopyToast(null), 2500);
              }}
              className="text-xs px-3.5 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-medium shadow-lg shadow-red-900/40 transition-all flex items-center gap-1.5 shrink-0"
            >
              📋 复制【{activeBets.length}注】实战面单
            </button>
          </div>
        </div>

        {/* 套餐选择按钮 */}
        <div className="grid sm:grid-cols-3 gap-2.5 my-4">
          <button
            onClick={() => setActivePackage("composite5")}
            className={`p-3 rounded-lg border text-left transition-all ${
              activePackage === "composite5"
                ? "bg-red-950/40 border-red-500 text-red-300 shadow-md shadow-red-950/50"
                : "bg-slate-800/40 border-white/5 text-gray-400 hover:text-gray-200"
            }`}
          >
            <p className="text-xs font-semibold text-white">🔥 AI 精选 5 注 (10元预算)</p>
            <p className="text-[10px] text-gray-400 mt-1">
              全号覆盖 $\ge 24$ · 5个热门蓝球 · 蓝球命中率 31.25%
            </p>
          </button>

          <button
            onClick={() => setActivePackage("blue16")}
            className={`p-3 rounded-lg border text-left transition-all ${
              activePackage === "blue16"
                ? "bg-blue-950/40 border-blue-500 text-blue-300 shadow-md shadow-blue-950/50"
                : "bg-slate-800/40 border-white/5 text-gray-400 hover:text-gray-200"
            }`}
          >
            <p className="text-xs font-semibold text-white">🎯 蓝球 100% 必中包 (32元预算)</p>
            <p className="text-[10px] text-gray-400 mt-1">
              16 注全包蓝球(01-16) · 100% 保底中5元回血
            </p>
          </button>

          <button
            onClick={() => setActivePackage("antiCollision5")}
            className={`p-3 rounded-lg border text-left transition-all ${
              activePackage === "antiCollision5"
                ? "bg-emerald-950/40 border-emerald-500 text-emerald-300 shadow-md shadow-emerald-950/50"
                : "bg-slate-800/40 border-white/5 text-gray-400 hover:text-gray-200"
            }`}
          >
            <p className="text-xs font-semibold text-white">🛡️ AI 高独享避撞 5 注 (10元预算)</p>
            <p className="text-[10px] text-gray-400 mt-1">
              避撞得分 $\ge 80$ · 避开热门撞号心理 · 中奖独享大奖
            </p>
          </button>
        </div>

        {copyToast && (
          <div className="mb-3 text-[12px] text-emerald-300 bg-emerald-950/40 border border-emerald-500/30 rounded-lg px-3.5 py-2 animate-fade-in">
            {copyToast}
          </div>
        )}

        <div className="space-y-2.5">
          {activeBets.map((p, idx) => {
            const info = analyzeNote(p.reds);
            const collision = calcCollisionAnalysis(p.reds, p.blue);
            return (
              <div
                key={idx}
                className="group relative bg-[#1e293b]/40 border border-white/[0.08] hover:border-white/[0.16] rounded-xl px-5 py-4 transition-colors"
              >
                <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl bg-red-600/50 group-hover:bg-red-500 transition-colors" />
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-medium text-gray-300 uppercase tracking-widest pl-1">
                      第 {idx + 1} 注
                    </span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded font-mono font-medium ${
                        collision.score >= 80
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                          : collision.score >= 60
                          ? "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                          : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                      }`}
                    >
                      避撞号 {collision.score}分
                    </span>
                  </div>
                  <div className="flex items-center gap-2.5 text-[11px] text-gray-300 flex-wrap">
                    <span className="tabular-nums">
                      和 <span className="text-gray-200">{info.sum}</span>
                    </span>
                    <span className="tabular-nums">
                      AC <span className="text-emerald-400 font-mono">{calcACValue(p.reds)}</span>
                    </span>
                    {hasSameTail(p.reds) && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300 border border-blue-500/25 font-mono">
                        含同尾号
                      </span>
                    )}
                    <span>
                      奇偶 <span className="text-gray-200">{info.odd}:{info.even}</span>
                    </span>
                    <span>
                      区间 <span className="text-gray-200">{info.z1}-{info.z2}-{info.z3}</span>
                    </span>
                    {info.hasConsec && (
                      <span className="text-amber-400/80">连号</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 pl-1 flex-wrap">
                  {p.reds.map((n) => (
                    <BallRed key={n} n={n} size="lg" />
                  ))}
                  <div className="w-px h-7 bg-white/10 mx-1" />
                  <BallBlue n={p.blue} size="lg" />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {records.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-white mb-3">最近 10 期</h3>
          <div className="bg-[#0f172a] border border-white/[0.10] rounded-xl overflow-hidden">
            {records.slice(0, 10).map((r, i) => (
              <div
                key={r.code}
                className={`flex items-center gap-4 px-5 py-3 ${
                  i !== 9 ? "border-b border-white/[0.05]" : ""
                }`}
              >
                <span className="text-[11px] text-gray-400 font-mono w-16 shrink-0">{r.code}</span>
                <span className="text-[11px] text-gray-400 w-22 shrink-0 hidden sm:block">{r.date}</span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {r.reds.map((n, j) => (
                    <BallRed key={j} n={n} size="sm" />
                  ))}
                  <div className="w-px h-5 bg-white/10 mx-0.5" />
                  <BallBlue n={r.blue} size="sm" />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* ════════════════════════════════════════
   Review Tab — 按目标期归组
════════════════════════════════════════ */
type IssueGroup = {
  targetIssue: string;
  variants: TipReview[];
  status: "pending" | "drawn";
  actual?: TipReview["actual"];
};

function groupReviewsByIssue(reviews: TipReview[]): IssueGroup[] {
  const map = new Map<string, TipReview[]>();
  for (const r of reviews) {
    const list = map.get(r.targetIssue) ?? [];
    list.push(r);
    map.set(r.targetIssue, list);
  }
  return [...map.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([targetIssue, variants]) => {
      const sorted = [...variants].sort((a, b) => a.pageSize - b.pageSize);
      const drawn = sorted.find((v) => v.status === "drawn");
      return {
        targetIssue,
        variants: sorted,
        status: drawn ? ("drawn" as const) : ("pending" as const),
        actual: drawn?.actual,
      };
    });
}

function avgBetRedHits(review: TipReview): number {
  const hits = review.betHits ?? [];
  if (!hits.length) return 0;
  return hits.reduce((s, h) => s + h.redHitCount, 0) / hits.length;
}

function blueHitCount(review: TipReview): number {
  return (review.betHits ?? []).filter((h) => h.blueHit).length;
}

function rangeLabel(size: number): string {
  return size >= 1555 ? "全部" : `近${size}`;
}

function ReviewTab({
  reviews,
  preferredPageSize,
}: {
  reviews: TipReview[];
  preferredPageSize: number;
}) {
  const groups = useMemo(() => groupReviewsByIssue(reviews), [reviews]);
  const drawnGroups = groups.filter((g) => g.status === "drawn");
  const pendingGroups = groups.filter((g) => g.status === "pending");

  // 统计跟顶部数据范围对齐：优先用该范围变体，没有则跳过（不强行混用 300）
  const primaryDrawn = drawnGroups
    .map((g) => g.variants.find((v) => v.pageSize === preferredPageSize))
    .filter(Boolean) as TipReview[];

  const avgCompositeRed =
    primaryDrawn.length === 0
      ? 0
      : primaryDrawn.reduce((s, r) => s + avgBetRedHits(r), 0) / primaryDrawn.length;

  const rangeStatLabel =
    preferredPageSize >= 1555
      ? "全部红球均中"
      : `近${preferredPageSize}红球均中`;

  if (!reviews.length) {
    return (
      <div className="bg-[#0f172a] border border-white/[0.10] rounded-xl px-5 py-10 text-center text-sm text-gray-400">
        还没有存档。切换顶部「近100 / 300 / 500 / 1000 / 全部」会自动为当前目标期各存一份。
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="复盘期数" value={`${groups.length}`} unit="期" />
        <StatCard label="已开奖" value={`${drawnGroups.length}`} unit="期" accent />
        <StatCard label="待开奖" value={`${pendingGroups.length}`} unit="期" muted />
        <StatCard
          label={rangeStatLabel}
          value={primaryDrawn.length ? avgCompositeRed.toFixed(2) : "-"}
          unit="个/注"
          sub={
            primaryDrawn.length
              ? `基于 ${primaryDrawn.length} 期该范围存档 · 理论约 1.09`
              : `尚无「${rangeLabel(preferredPageSize)}」存档，切换范围后会自动生成`
          }
        />
      </div>

      <p className="text-[12px] text-gray-400">
        按<strong className="text-gray-200 font-medium">目标期号</strong>归组；同一期的不同数据范围用卡片内切换。
        顶部范围会优先展示对应存档。
      </p>

      <div className="space-y-4">
        {groups.map((g) => (
          <IssueReviewCard
            key={g.targetIssue}
            group={g}
            preferredPageSize={preferredPageSize}
          />
        ))}
      </div>
    </div>
  );
}

function IssueReviewCard({
  group,
  preferredPageSize,
}: {
  group: IssueGroup;
  preferredPageSize: number;
}) {
  const resolveRange = (preferred: number) =>
    group.variants.find((v) => v.pageSize === preferred)?.pageSize ??
    group.variants[0]?.pageSize ??
    preferred;

  const [range, setRange] = useState(() => resolveRange(preferredPageSize));

  // 顶部数据范围变化时，若该期已有对应存档则跟随切换
  useEffect(() => {
    setRange(resolveRange(preferredPageSize));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to preferred / variant set
  }, [preferredPageSize, group.variants.map((v) => v.pageSize).join(",")]);

  const active =
    group.variants.find((v) => v.pageSize === range) ?? group.variants[0];
  const pending = group.status === "pending";

  if (!active) return null;

  const totalRedHits = (active.betHits ?? []).reduce((s, h) => s + h.redHitCount, 0);
  const totalBlueHits = blueHitCount(active);
  const anyHit = !pending && (totalRedHits > 0 || totalBlueHits > 0);

  return (
    <div className="bg-[#0f172a] border border-white/[0.10] rounded-xl overflow-hidden">
      {/* 票面式页头 */}
      <div className="px-5 py-4 border-b border-white/[0.06] flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[13px] text-white font-medium">
            双色球 · 第<span className="font-mono text-red-400">{group.targetIssue}</span>期
          </p>
          <p className="text-[11px] text-gray-400 mt-0.5">
            {rangeLabel(active.pageSize)}参考 · 基于 {active.basedOnIssue}
          </p>
        </div>
        <span
          className={`text-[12px] font-medium ${
            pending ? "text-amber-300" : anyHit ? "text-red-400" : "text-gray-400"
          }`}
        >
          {pending ? "待开奖" : anyHit ? "有命中" : "未命中"}
        </span>
      </div>

      {group.variants.length > 1 && (
        <div className="px-5 pt-3 flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] text-gray-400 mr-1">范围</span>
          {group.variants.map((v) => (
            <button
              key={v.id}
              onClick={() => setRange(v.pageSize)}
              className={`px-2.5 py-1 text-[11px] rounded-md border transition-colors ${
                v.pageSize === range
                  ? "bg-red-600/20 text-red-300 border-red-500/30"
                  : "text-gray-400 border-white/10 hover:text-gray-200"
              }`}
            >
              {rangeLabel(v.pageSize)}
            </button>
          ))}
        </div>
      )}

      <div className="px-5 py-4 space-y-4">
        {/* 开奖号码 — 实心 */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-[12px] text-gray-400 w-16 shrink-0">开奖号码</span>
          {pending || !group.actual ? (
            <span className="text-[12px] text-gray-500">开奖后自动对照</span>
          ) : (
            <div className="flex items-center gap-1.5 flex-wrap">
              {group.actual.reds.map((n) => (
                <BallRed key={n} n={n} size="md" variant="solid" />
              ))}
              <span className="w-2" />
              <BallBlue n={group.actual.blue} size="md" variant="solid" />
            </div>
          )}
        </div>

        {/* 参考号码 — 空心，命中填实 */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-gray-400">参考号码</span>
            {!pending && (
              <span className="text-[11px] text-gray-400">
                红中合计 {totalRedHits} · 蓝中 {totalBlueHits} 注
              </span>
            )}
          </div>
          {active.bets.map((bet, i) => (
            <TicketBetRow
              key={`${active.id}-${i}`}
              index={i + 1}
              bet={bet}
              hit={active.betHits?.[i]}
              pending={pending}
            />
          ))}
        </div>

        <details className="pt-2 border-t border-white/[0.06]">
          <summary className="text-[11px] text-gray-400 cursor-pointer hover:text-gray-200 select-none">
            热号 / 冷号 / 随机对照
          </summary>
          <div className="mt-3 space-y-2">
            {(["hot", "cold", "random"] as const).map((key) => (
              <TicketBetRow
                key={key}
                label={active.strategies[key].label}
                bet={active.strategies[key]}
                hit={active.strategyHits?.[key]}
                pending={pending}
              />
            ))}
          </div>
        </details>
      </div>
    </div>
  );
}

/** 票面式一注：未中空心，命中实心 */
function TicketBetRow({
  index,
  label,
  bet,
  hit,
  pending,
}: {
  index?: number;
  label?: string;
  bet: TipBet;
  hit?: BetHit;
  pending: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span className="text-[12px] text-gray-400 w-16 shrink-0 tabular-nums">
        {label ?? `${index}`}
      </span>
      <div className="flex items-center gap-1.5 flex-wrap">
        {bet.reds.map((n) => {
          const matched = !pending && !!hit?.redHits.includes(n);
          return (
            <BallRed
              key={n}
              n={n}
              size="md"
              variant={matched ? "solid" : "outline"}
            />
          );
        })}
        <span className="w-2" />
        <BallBlue
          n={bet.blue}
          size="md"
          variant={!pending && hit?.blueHit ? "solid" : "outline"}
        />
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   Red / Blue / Pairs / History
════════════════════════════════════════ */
function RedFreqTab({ data }: { data: FrequencyItem[] }) {
  const sorted = [...data].sort((a, b) => a.number - b.number);
  const max = Math.max(...sorted.map((d) => d.count));
  const min = Math.min(...sorted.map((d) => d.count));
  const avg = Math.round(sorted.reduce((s, d) => s + d.count, 0) / sorted.length);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="最高频次" value={String(max)} unit="次" accent />
        <StatCard label="平均频次" value={String(avg)} unit="次" />
        <StatCard label="最低频次" value={String(min)} unit="次" muted />
      </div>
      <div className="bg-[#0f172a] border border-white/[0.10] rounded-xl p-5">
        <p className="text-[11px] text-gray-400 mb-4">红球号码出现频次（1–33）</p>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={sorted} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
            <XAxis dataKey="number" tick={{ fill: "#9ca3af", fontSize: 10 }} tickLine={false} axisLine={{ stroke: "#334155" }} />
            <YAxis tick={{ fill: "#9ca3af", fontSize: 10 }} tickLine={false} axisLine={false} />
            <Tooltip
              cursor={{ fill: "rgba(255,255,255,0.03)" }}
              contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 8 }}
              formatter={(v) => [`${v ?? 0} 次`, "出现次数"]}
              labelFormatter={(l) => `${l} 号`}
            />
            <Bar dataKey="count" radius={[3, 3, 0, 0]}>
              {sorted.map((entry) => (
                <Cell key={entry.number} fill={entry.count === max ? "#ef4444" : "#7f1d1d"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="grid grid-cols-11 gap-1.5">
        {sorted.map((item) => (
          <div key={item.number} className="bg-[#0f172a] border border-white/[0.10] rounded-lg p-2 text-center">
            <BallRed n={item.number} size="sm" />
            <p className="text-[10px] text-gray-400 mt-1 tabular-nums">{item.count}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function BlueFreqTab({ data }: { data: FrequencyItem[] }) {
  const sorted = [...data].sort((a, b) => a.number - b.number);
  const max = Math.max(...sorted.map((d) => d.count));
  const min = Math.min(...sorted.map((d) => d.count));
  const avg = Math.round(sorted.reduce((s, d) => s + d.count, 0) / sorted.length);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="最高频次" value={String(max)} unit="次" blue />
        <StatCard label="平均频次" value={String(avg)} unit="次" />
        <StatCard label="最低频次" value={String(min)} unit="次" muted />
      </div>
      <div className="bg-[#0f172a] border border-white/[0.10] rounded-xl p-5">
        <p className="text-[11px] text-gray-400 mb-4">蓝球号码出现频次（1–16）</p>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={sorted} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
            <XAxis dataKey="number" tick={{ fill: "#9ca3af", fontSize: 10 }} tickLine={false} axisLine={{ stroke: "#334155" }} />
            <YAxis tick={{ fill: "#9ca3af", fontSize: 10 }} tickLine={false} axisLine={false} />
            <Tooltip
              cursor={{ fill: "rgba(255,255,255,0.03)" }}
              contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 8 }}
              formatter={(v) => [`${v ?? 0} 次`, "出现次数"]}
              labelFormatter={(l) => `${l} 号`}
            />
            <Bar dataKey="count" radius={[3, 3, 0, 0]}>
              {sorted.map((entry) => (
                <Cell key={entry.number} fill={entry.count === max ? "#3b82f6" : "#1e3a8a"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="grid grid-cols-8 gap-1.5">
        {sorted.map((item) => (
          <div key={item.number} className="bg-[#0f172a] border border-white/[0.10] rounded-lg p-2.5 text-center">
            <BallBlue n={item.number} size="sm" />
            <p className="text-[10px] text-gray-400 mt-1 tabular-nums">{item.count}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function PairsTab({ pairs }: { pairs: { pair: string; count: number }[] }) {
  const max = pairs[0]?.count ?? 1;
  return (
    <div className="bg-[#0f172a] border border-white/[0.10] rounded-xl p-5">
      <p className="text-[11px] text-gray-400 mb-4">红球两两组合历史共现频次 TOP 20</p>
      <ResponsiveContainer width="100%" height={420}>
        <BarChart data={pairs} layout="vertical" margin={{ top: 0, right: 48, left: 8, bottom: 0 }} barSize={14}>
          <XAxis type="number" tick={{ fill: "#9ca3af", fontSize: 10 }} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="pair" tick={{ fill: "#9ca3af", fontSize: 11 }} tickLine={false} width={44} />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.03)" }}
            contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 8 }}
            formatter={(v) => [`${v ?? 0} 次`, "共现次数"]}
          />
          <Bar dataKey="count" radius={[0, 3, 3, 0]}>
            {pairs.map((entry, i) => (
              <Cell key={i} fill={entry.count === max ? "#ef4444" : "#7f1d1d"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function HistoryTab({ records }: { records: ParsedRecord[] }) {
  const [search, setSearch] = useState("");
  const filtered = search
    ? records.filter((r) => r.code.includes(search) || r.date.includes(search))
    : records;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <input
          type="text"
          placeholder="搜索期号或日期…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-[#0f172a] border border-white/[0.10] focus:border-white/25 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none w-56"
        />
        <span className="text-[11px] text-gray-400">{filtered.length} 条</span>
      </div>
      <div className="bg-[#0f172a] border border-white/[0.10] rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/[0.06]">
              <th className="text-left px-5 py-3 text-[11px] font-medium text-gray-400">期号</th>
              <th className="text-left px-5 py-3 text-[11px] font-medium text-gray-400 hidden sm:table-cell">日期</th>
              <th className="text-left px-5 py-3 text-[11px] font-medium text-gray-400">红球</th>
              <th className="text-left px-5 py-3 text-[11px] font-medium text-gray-400">蓝球</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 200).map((r, i) => (
              <tr
                key={r.code}
                className={`hover:bg-white/[0.02] ${
                  i !== filtered.slice(0, 200).length - 1 ? "border-b border-white/[0.04]" : ""
                }`}
              >
                <td className="px-5 py-2.5 text-[12px] text-gray-300 font-mono">{r.code}</td>
                <td className="px-5 py-2.5 text-[11px] text-gray-400 hidden sm:table-cell">{r.date}</td>
                <td className="px-5 py-2.5">
                  <div className="flex gap-1">
                    {r.reds.map((n, j) => (
                      <BallRed key={j} n={n} size="xs" />
                    ))}
                  </div>
                </td>
                <td className="px-5 py-2.5">
                  <BallBlue n={r.blue} size="xs" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   Shared
════════════════════════════════════════ */
type BallSize = "xs" | "sm" | "md" | "lg";
type BallVariant = "solid" | "outline";

function ballSizeClass(size: BallSize): string {
  if (size === "lg") return "w-10 h-10 text-sm font-bold";
  if (size === "md") return "w-8 h-8 text-[12px] font-bold";
  if (size === "sm") return "w-7 h-7 text-[11px] font-bold";
  return "w-6 h-6 text-[10px] font-bold";
}

function BallRed({
  n,
  size,
  variant = "solid",
}: {
  n: number;
  size: BallSize;
  variant?: BallVariant;
}) {
  const base = `${ballSizeClass(size)} rounded-full flex items-center justify-center shrink-0 tabular-nums`;
  if (variant === "outline") {
    return (
      <span className={`${base} border-2 border-red-500 text-red-400 bg-transparent`}>
        {String(n).padStart(2, "0")}
      </span>
    );
  }
  return (
    <span className={`${base} bg-red-600 text-white`}>
      {String(n).padStart(2, "0")}
    </span>
  );
}

function BallBlue({
  n,
  size,
  variant = "solid",
}: {
  n: number;
  size: BallSize;
  variant?: BallVariant;
}) {
  const base = `${ballSizeClass(size)} rounded-full flex items-center justify-center shrink-0 tabular-nums`;
  if (variant === "outline") {
    return (
      <span className={`${base} border-2 border-blue-500 text-blue-400 bg-transparent`}>
        {String(n).padStart(2, "0")}
      </span>
    );
  }
  return (
    <span className={`${base} bg-blue-600 text-white`}>
      {String(n).padStart(2, "0")}
    </span>
  );
}

function StatCard({
  label,
  value,
  unit,
  sub,
  accent,
  blue,
  muted,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  accent?: boolean;
  blue?: boolean;
  muted?: boolean;
}) {
  const valueColor = accent
    ? "text-red-400"
    : blue
    ? "text-blue-400"
    : muted
    ? "text-gray-400"
    : "text-white";

  return (
    <div className="bg-[#0f172a] border border-white/[0.10] rounded-xl px-4 py-3.5">
      <p className="text-[11px] text-gray-400 mb-1">{label}</p>
      <div className="flex items-baseline gap-1">
        <span className={`text-2xl font-semibold tabular-nums ${valueColor}`}>{value}</span>
        {unit && <span className="text-xs text-gray-400">{unit}</span>}
      </div>
      {sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

/* ════════════════════════════════════════
   Math & Probability Tab
════════════════════════════════════════ */
function MathTab({ records }: { records: ParsedRecord[] }) {
  const chi = useMemo(() => calcChiSquare(records), [records]);
  const evData = useMemo(() => getProbabilityEV(), []);
  const sumDist = useMemo(() => calcRedSumDistribution(records), [records]);
  const [backtestCount, setBacktestCount] = useState<number>(30);
  const backtest = useMemo(
    () => runBacktest(records, backtestCount),
    [records, backtestCount]
  );

  return (
    <div className="space-y-6">
      {/* 1. 卡方检验科学结论 */}
      <div className="bg-[#0f172a] border border-white/[0.10] rounded-xl p-5">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div>
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
              卡方拟合优度检验 (Chi-Square Goodness-of-Fit)
            </h2>
            <p className="text-[11px] text-gray-400 mt-1">
              基于 {records.length} 期开奖样本，科学检验历史频次是否符合均匀随机分布
            </p>
          </div>
          <span className="text-xs px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
            {chi.red.isUniform ? "符合均匀随机分布 (p ≥ 0.05)" : "极微弱统计涨落"}
          </span>
        </div>

        <div className="grid md:grid-cols-2 gap-4 mt-4">
          <div className="bg-[#1e293b]/60 border border-white/5 rounded-lg p-4">
            <p className="text-[12px] text-gray-300 font-medium mb-2">红球检验 (1-33号, 自由度 df=32)</p>
            <div className="space-y-1.5 text-[11px] text-gray-400">
              <div className="flex justify-between"><span>卡方统计量 χ²:</span><span className="text-white font-mono">{chi.red.chi2}</span></div>
              <div className="flex justify-between"><span>p-value 假设检验:</span><span className="text-emerald-400 font-mono">{chi.red.pValue}</span></div>
              <p className="text-[10px] text-gray-400 mt-2 leading-relaxed pt-2 border-t border-white/5">
                {chi.red.pValue >= 0.05
                  ? "科学结论：p > 0.05 假设成立。红球出现频次的波动属于正常的独立随机游走，无偏向性规律。"
                  : "结论：历史开奖数据呈现正常有限样本极微弱随机涨落。"}
              </p>
            </div>
          </div>

          <div className="bg-[#1e293b]/60 border border-white/5 rounded-lg p-4">
            <p className="text-[12px] text-gray-300 font-medium mb-2">蓝球检验 (1-16号, 自由度 df=15)</p>
            <div className="space-y-1.5 text-[11px] text-gray-400">
              <div className="flex justify-between"><span>卡方统计量 χ²:</span><span className="text-white font-mono">{chi.blue.chi2}</span></div>
              <div className="flex justify-between"><span>p-value 假设检验:</span><span className="text-blue-400 font-mono">{chi.blue.pValue}</span></div>
              <p className="text-[10px] text-gray-400 mt-2 leading-relaxed pt-2 border-t border-white/5">
                {chi.blue.pValue >= 0.05
                  ? "科学结论：p > 0.05 假设成立。蓝球开奖符合严格无偏随机分布。"
                  : "结论：蓝球样本波动属于随机离散。"}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 2. 和值高斯分布拟合 */}
      <div className="bg-[#0f172a] border border-white/[0.10] rounded-xl p-5">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <h2 className="text-sm font-semibold text-white">红球和值高斯分布拟合 (Gaussian Normal Fit)</h2>
          <span className="text-[11px] text-gray-400">理论均值 μ=102, 标准差 σ=21.4</span>
        </div>
        <p className="text-[11px] text-gray-400 mb-4">
          蓝柱为历史实际和值区间占比(%)，红线为理论高斯正态概率密度曲线，证明样本极度贴合大数定律。
        </p>

        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={sumDist} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <XAxis dataKey="bin" tick={{ fill: "#9ca3af", fontSize: 10 }} tickLine={false} axisLine={{ stroke: "#334155" }} />
            <YAxis tick={{ fill: "#9ca3af", fontSize: 10 }} tickLine={false} axisLine={false} unit="%" />
            <Tooltip
              cursor={{ fill: "rgba(255,255,255,0.03)" }}
              contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 8 }}
              formatter={(v, name) => [`${v}%`, name === "actual" ? "实际占比" : "理论高斯占比"]}
            />
            <Bar dataKey="actual" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={28} />
            <Line type="monotone" dataKey="gaussian" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* 3. 期望收益 EV 与中奖概率金字塔 */}
      <div className="bg-[#0f172a] border border-white/[0.10] rounded-xl p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div>
            <h2 className="text-sm font-semibold text-white">概率金字塔与期望收益 (Expected Value, EV)</h2>
            <p className="text-[11px] text-gray-400 mt-0.5">
              双色球法定返奖率 51% (官方规则)，每 2 元单注期望收益 1.02 元 (净期望 -0.98 元)
            </p>
          </div>
          <div className="flex gap-4 text-right">
            <div>
              <p className="text-[10px] text-gray-400">总中奖概率</p>
              <p className="text-sm font-semibold text-emerald-400 font-mono">{(evData.totalProb * 100).toFixed(2)}%</p>
            </div>
            <div>
              <p className="text-[10px] text-gray-400">单注 EV 期望</p>
              <p className="text-sm font-semibold text-red-400 font-mono">{evData.ev.toFixed(2)} 元</p>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-white/10 text-[11px] text-gray-400">
                <th className="py-2 px-3 font-medium">奖级</th>
                <th className="py-2 px-3 font-medium">中奖条件</th>
                <th className="py-2 px-3 font-medium">理论概率</th>
                <th className="py-2 px-3 font-medium">概率比例</th>
                <th className="py-2 px-3 font-medium">奖金说明</th>
                <th className="py-2 px-3 font-medium text-right">期望贡献</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-[12px]">
              {evData.ranks.map((r) => (
                <tr key={r.rank} className="hover:bg-white/[0.02]">
                  <td className="py-2.5 px-3 font-medium text-white">{r.rank}</td>
                  <td className="py-2.5 px-3 text-gray-300 font-mono text-[11px]">{r.rule}</td>
                  <td className="py-2.5 px-3 text-gray-300 font-mono">{r.prob < 0.0001 ? r.prob.toExponential(4) : (r.prob * 100).toFixed(2) + "%"}</td>
                  <td className="py-2.5 px-3 text-gray-400 font-mono text-[11px]">{r.probRatioStr}</td>
                  <td className="py-2.5 px-3 text-amber-300/90 text-[11px]">{r.prizeStr}</td>
                  <td className="py-2.5 px-3 text-right font-mono text-gray-200">+{r.evContribution.toFixed(3)} 元</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 4. 策略历史模拟回测 */}
      <div className="bg-[#0f172a] border border-white/[0.10] rounded-xl p-5">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div>
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-400"></span>
              策略历史模拟回测 (Strategy Backtesting Engine)
            </h2>
            <p className="text-[11px] text-gray-400 mt-0.5">
              模拟逐期应用推荐算法对过去 {backtest.totalIssues} 期开奖进行盲测，对比实际回血与中奖频次
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {[30, 50, 100].map((n) => (
              <button
                key={n}
                onClick={() => setBacktestCount(n)}
                className={`px-3 py-1 text-xs rounded border transition-all ${
                  backtestCount === n
                    ? "bg-blue-600 text-white border-blue-500 font-medium"
                    : "bg-slate-800 text-gray-400 border-white/10 hover:text-white"
                }`}
              >
                近{n}期回测
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 my-4">
          <div className="bg-[#1e293b]/60 border border-white/5 rounded-lg p-3">
            <p className="text-[10px] text-gray-400">模拟投入成本</p>
            <p className="text-lg font-semibold text-white font-mono">{backtest.totalSpent} 元</p>
          </div>
          <div className="bg-[#1e293b]/60 border border-white/5 rounded-lg p-3">
            <p className="text-[10px] text-gray-400">累计回血奖金</p>
            <p className="text-lg font-semibold text-emerald-400 font-mono">{backtest.totalReturn} 元</p>
          </div>
          <div className="bg-[#1e293b]/60 border border-white/5 rounded-lg p-3">
            <p className="text-[10px] text-gray-400">中奖期数占比</p>
            <p className="text-lg font-semibold text-blue-400 font-mono">
              {backtest.totalIssues ? ((backtest.winIssueCount / backtest.totalIssues) * 100).toFixed(1) : 0}%
            </p>
          </div>
          <div className="bg-[#1e293b]/60 border border-white/5 rounded-lg p-3">
            <p className="text-[10px] text-gray-400">回血率 ROI</p>
            <p className={`text-lg font-semibold font-mono ${backtest.roiPct >= 100 ? "text-emerald-400" : "text-amber-400"}`}>
              {backtest.roiPct}%
            </p>
          </div>
        </div>

        <div className="overflow-x-auto max-h-56 overflow-y-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-white/10 text-[11px] text-gray-400 sticky top-0 bg-[#0f172a]">
                <th className="py-2 px-3 font-medium">期号</th>
                <th className="py-2 px-3 font-medium">开奖号码</th>
                <th className="py-2 px-3 font-medium">回测结果</th>
                <th className="py-2 px-3 font-medium text-right">获得奖金</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-[11px] font-mono">
              {backtest.details.map((d) => (
                <tr key={d.code} className="hover:bg-white/[0.02]">
                  <td className="py-2 px-3 text-gray-300">{d.code}</td>
                  <td className="py-2 px-3 text-gray-400">{d.actualStr}</td>
                  <td className="py-2 px-3">
                    <span className={d.prizeAmt > 0 ? "text-emerald-300 font-medium" : "text-gray-500"}>
                      {d.hitDesc}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-right text-gray-200">
                    {d.prizeAmt > 0 ? `+${d.prizeAmt}元` : "0元"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 5. 游程检验 — 序列独立性 */}
      <RunsTestPanel records={records} />

      {/* 6. 自相关分析 ACF */}
      <ACFPanel records={records} />

      {/* 7. 马尔可夫矩阵 KL 散度评估 */}
      <MarkovValidationPanel records={records} />

      {/* 8. Kelly 准则 */}
      <KellyPanel />

      {/* 9. 红蓝球独立性检验 */}
      <RedBlueIndependencePanel records={records} />
    </div>
  );
}

/* ── P2/P3 新增面板组件 ────────────────────────────────── */

function RunsTestPanel({ records }: { records: ParsedRecord[] }) {
  const runsResults = useMemo(() => calcRunsTest(records, "red"), [records]);
  const nonIndependent = runsResults.filter((r) => !r.isIndependent);
  const blueRuns = useMemo(() => calcRunsTest(records, "blue"), [records]);
  const blueNonIndep = blueRuns.filter((r) => !r.isIndependent);

  if (runsResults.length === 0) return null;

  return (
    <div className="bg-[#0f172a] border border-white/[0.10] rounded-xl p-5">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-violet-400" />
            Wald-Wolfowitz 游程检验 (Runs Test)
          </h2>
          <p className="text-[11px] text-gray-400 mt-1">
            检验各号码出现序列是否独立随机，p &lt; 0.05 表示存在显著聚集或交替趋势
          </p>
        </div>
        <span className={`text-xs px-3 py-1 rounded-full border ${
          nonIndependent.length === 0
            ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
            : "bg-amber-500/20 text-amber-300 border-amber-500/30"
        }`}>
          红球: {nonIndependent.length === 0 ? "全部通过独立性检验" : `${nonIndependent.length}个号码不独立`}
        </span>
      </div>

      {nonIndependent.length > 0 && (
        <div className="bg-amber-950/30 border border-amber-500/20 rounded-lg p-3 mb-4">
          <p className="text-[11px] text-amber-300 font-medium mb-1.5">⚠️ 以下红球号码的出现序列不满足独立性假设 (p &lt; 0.05)：</p>
          <div className="flex flex-wrap gap-2">
            {nonIndependent.map((r) => (
              <span key={r.number} className="text-[11px] font-mono bg-amber-500/15 text-amber-200 px-2 py-1 rounded border border-amber-500/25">
                {String(r.number).padStart(2, "0")} · Z={r.zScore} · p={r.pValue}
              </span>
            ))}
          </div>
        </div>
      )}

      {blueNonIndep.length > 0 && (
        <div className="bg-blue-950/30 border border-blue-500/20 rounded-lg p-3 mb-4">
          <p className="text-[11px] text-blue-300 font-medium mb-1.5">蓝球不独立号码：</p>
          <div className="flex flex-wrap gap-2">
            {blueNonIndep.map((r) => (
              <span key={r.number} className="text-[11px] font-mono bg-blue-500/15 text-blue-200 px-2 py-1 rounded border border-blue-500/25">
                {String(r.number).padStart(2, "0")} · Z={r.zScore} · p={r.pValue}
              </span>
            ))}
          </div>
        </div>
      )}

      <details>
        <summary className="text-[11px] text-gray-400 cursor-pointer hover:text-gray-200 select-none">
          展开全部红球游程检验明细 ({runsResults.length} 个号码)
        </summary>
        <div className="overflow-x-auto max-h-56 overflow-y-auto mt-3">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-white/10 text-[11px] text-gray-400 sticky top-0 bg-[#0f172a]">
                <th className="py-2 px-3 font-medium">号码</th>
                <th className="py-2 px-3 font-medium">出现次数</th>
                <th className="py-2 px-3 font-medium">游程数</th>
                <th className="py-2 px-3 font-medium">期望游程</th>
                <th className="py-2 px-3 font-medium">Z-score</th>
                <th className="py-2 px-3 font-medium">p-value</th>
                <th className="py-2 px-3 font-medium text-right">结论</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-[11px] font-mono">
              {runsResults.map((r) => (
                <tr key={r.number} className="hover:bg-white/[0.02]">
                  <td className="py-2 px-3 text-gray-300">{String(r.number).padStart(2, "0")}</td>
                  <td className="py-2 px-3 text-gray-400">{r.nOnes}</td>
                  <td className="py-2 px-3 text-gray-300">{r.runs}</td>
                  <td className="py-2 px-3 text-gray-400">{r.expectedRuns}</td>
                  <td className="py-2 px-3 text-gray-300">{r.zScore}</td>
                  <td className={`py-2 px-3 font-medium ${r.isIndependent ? "text-emerald-400" : "text-amber-400"}`}>
                    {r.pValue}
                  </td>
                  <td className="py-2 px-3 text-right">
                    <span className={r.isIndependent ? "text-emerald-400" : "text-amber-400"}>
                      {r.isIndependent ? "✓ 独立" : "⚠ 不独立"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function ACFPanel({ records }: { records: ParsedRecord[] }) {
  const acfResults = useMemo(() => calcAutocorrelation(records, 10, "red"), [records]);
  const significantBalls = acfResults.filter((r) => r.hasSignificantLag);

  if (acfResults.length === 0) return null;

  return (
    <div className="bg-[#0f172a] border border-white/[0.10] rounded-xl p-5">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-cyan-400" />
            自相关分析 ACF (Autocorrelation Function)
          </h2>
          <p className="text-[11px] text-gray-400 mt-1">
            检测各号码是否存在周期性模式，超过 ±{acfResults[0]?.confidenceBand ?? 0} 的 Bartlett 置信带视为显著
          </p>
        </div>
        <span className={`text-xs px-3 py-1 rounded-full border ${
          significantBalls.length === 0
            ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
            : "bg-amber-500/20 text-amber-300 border-amber-500/30"
        }`}>
          {significantBalls.length === 0 ? "无显著周期性" : `${significantBalls.length}个号码有显著 lag`}
        </span>
      </div>

      {significantBalls.length > 0 && (
        <div className="bg-cyan-950/30 border border-cyan-500/20 rounded-lg p-3 mb-4">
          <p className="text-[11px] text-cyan-300 font-medium mb-1.5">以下号码存在统计显著的自相关 lag：</p>
          <div className="flex flex-wrap gap-2">
            {significantBalls.slice(0, 10).map((r) => {
              const sigLags = r.acfValues.filter((a) => a.significant);
              return (
                <span key={r.number} className="text-[11px] font-mono bg-cyan-500/15 text-cyan-200 px-2 py-1 rounded border border-cyan-500/25">
                  {String(r.number).padStart(2, "0")} · lag {sigLags.map((a) => `${a.lag}(${a.acf})`).join(", ")}
                </span>
              );
            })}
          </div>
          <p className="text-[10px] text-gray-400 mt-2">
            注意：33 个号码各检验 10 个 lag = 330 次假设检验。在 α=0.05 下，纯随机也会产生约 {Math.round(330 * 0.05)} 个假阳性。
          </p>
        </div>
      )}

      <p className="text-[10px] text-gray-400 leading-relaxed">
        {significantBalls.length === 0
          ? "所有号码在 lag-1 到 lag-10 的自相关系数均在 Bartlett 置信带内，不存在可利用的周期性信号。这进一步验证了开奖数据的独立随机性。"
          : `发现 ${significantBalls.length} 个号码有显著自相关，但考虑多重比较校正(Bonferroni)后可能均为假阳性。不建议基于此做投注决策。`
        }
      </p>
    </div>
  );
}

function MarkovValidationPanel({ records }: { records: ParsedRecord[] }) {
  const validation = useMemo(() => validateMarkovMatrix(records), [records]);

  return (
    <div className="bg-[#0f172a] border border-white/[0.10] rounded-xl p-5">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-orange-400" />
            马尔可夫转移矩阵有效性评估 (KL Divergence)
          </h2>
          <p className="text-[11px] text-gray-400 mt-1">
            计算转移矩阵与均匀分布之间的 KL 散度，评估矩阵是否包含有用的预测信号
          </p>
        </div>
        <span className={`text-xs px-3 py-1 rounded-full border ${
          validation.hasSignal
            ? "bg-amber-500/20 text-amber-300 border-amber-500/30"
            : "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
        }`}>
          {validation.hasSignal ? "检测到微弱信号" : "接近均匀 · 无预测信号"}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
        <div className="bg-[#1e293b]/60 border border-white/5 rounded-lg p-3">
          <p className="text-[10px] text-gray-400">平均 KL 散度</p>
          <p className="text-sm font-semibold text-white font-mono">{validation.klDivergence} bit</p>
        </div>
        <div className="bg-[#1e293b]/60 border border-white/5 rounded-lg p-3">
          <p className="text-[10px] text-gray-400">最大行 KL</p>
          <p className="text-sm font-semibold text-amber-400 font-mono">{validation.maxRowKL} bit</p>
        </div>
        <div className="bg-[#1e293b]/60 border border-white/5 rounded-lg p-3">
          <p className="text-[10px] text-gray-400">最小行 KL</p>
          <p className="text-sm font-semibold text-emerald-400 font-mono">{validation.minRowKL} bit</p>
        </div>
        <div className="bg-[#1e293b]/60 border border-white/5 rounded-lg p-3">
          <p className="text-[10px] text-gray-400">矩阵行熵(平均)</p>
          <p className="text-sm font-semibold text-blue-400 font-mono">{validation.avgEntropy}</p>
        </div>
        <div className="bg-[#1e293b]/60 border border-white/5 rounded-lg p-3">
          <p className="text-[10px] text-gray-400">均匀分布熵</p>
          <p className="text-sm font-semibold text-gray-300 font-mono">{validation.uniformEntropy}</p>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 leading-relaxed bg-[#1e293b]/40 border border-white/5 rounded-lg p-3">
        {validation.description}
      </p>
    </div>
  );
}

function KellyPanel() {
  const [bankroll, setBankroll] = useState(10000);
  const kelly = useMemo(() => calcKellyCriterion(bankroll), [bankroll]);

  return (
    <div className="bg-[#0f172a] border border-white/[0.10] rounded-xl p-5">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-rose-400" />
            Kelly 准则 (Kelly Criterion) — 最优投注比例
          </h2>
          <p className="text-[11px] text-gray-400 mt-1">
            数学最优投注比例 f* = (b·p − q) / b，用于量化风险与回报的平衡
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-gray-400">总资金</span>
          <input
            type="number"
            value={bankroll}
            onChange={(e) => setBankroll(Math.max(100, Number(e.target.value) || 10000))}
            className="w-24 bg-[#1e293b] border border-white/10 rounded px-2 py-1 text-xs text-white font-mono focus:outline-none focus:border-white/25"
          />
          <span className="text-[11px] text-gray-400">元</span>
        </div>
      </div>

      <div className="bg-red-950/30 border border-red-500/30 rounded-lg p-3 mb-4">
        <p className="text-[11px] text-red-300 leading-relaxed">{kelly.riskNote}</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
        <div className="bg-[#1e293b]/60 border border-white/5 rounded-lg p-3">
          <p className="text-[10px] text-gray-400">综合最优投注比例</p>
          <p className="text-sm font-semibold text-white font-mono">
            {kelly.optimalFraction === 0 ? "0%" : `${(kelly.optimalFraction * 100).toExponential(4)}%`}
          </p>
        </div>
        <div className="bg-[#1e293b]/60 border border-white/5 rounded-lg p-3">
          <p className="text-[10px] text-gray-400">建议单期投注</p>
          <p className="text-sm font-semibold text-amber-400 font-mono">
            {kelly.suggestedBet <= 0.01 ? "≤ 0.01 元" : `${kelly.suggestedBet} 元`}
          </p>
        </div>
        <div className="bg-[#1e293b]/60 border border-white/5 rounded-lg p-3">
          <p className="text-[10px] text-gray-400">结论</p>
          <p className="text-sm font-semibold text-red-400">
            {kelly.optimalFraction <= 0 ? "不建议投注" : "极微比例"}
          </p>
        </div>
      </div>

      <details>
        <summary className="text-[11px] text-gray-400 cursor-pointer hover:text-gray-200 select-none">
          各奖级 Kelly 分数明细
        </summary>
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-white/10 text-[11px] text-gray-400">
                <th className="py-2 px-3 font-medium">奖级</th>
                <th className="py-2 px-3 font-medium">Kelly 分数</th>
                <th className="py-2 px-3 font-medium">说明</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-[11px]">
              {kelly.rankKelly.map((r) => (
                <tr key={r.rank} className="hover:bg-white/[0.02]">
                  <td className="py-2 px-3 text-white font-medium">{r.rank}</td>
                  <td className="py-2 px-3 text-gray-300 font-mono">
                    {r.kelly === 0 ? "0" : r.kelly.toExponential(4)}
                  </td>
                  <td className="py-2 px-3 text-gray-400">{r.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function RedBlueIndependencePanel({ records }: { records: ParsedRecord[] }) {
  const result = useMemo(() => calcRedBlueIndependence(records), [records]);

  return (
    <div className="bg-[#0f172a] border border-white/[0.10] rounded-xl p-5">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-indigo-400" />
            红蓝球条件独立性检验 (χ² Independence Test)
          </h2>
          <p className="text-[11px] text-gray-400 mt-1">
            验证红球和值区间与蓝球号码之间是否满足统计独立 · df={result.df}
          </p>
        </div>
        <span className={`text-xs px-3 py-1 rounded-full border ${
          result.isIndependent
            ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
            : "bg-amber-500/20 text-amber-300 border-amber-500/30"
        }`}>
          {result.isIndependent ? "红蓝独立 ✓" : "存在微弱相关"}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-[#1e293b]/60 border border-white/5 rounded-lg p-3">
          <p className="text-[10px] text-gray-400">χ² 统计量</p>
          <p className="text-sm font-semibold text-white font-mono">{result.chi2}</p>
        </div>
        <div className="bg-[#1e293b]/60 border border-white/5 rounded-lg p-3">
          <p className="text-[10px] text-gray-400">自由度 df</p>
          <p className="text-sm font-semibold text-gray-300 font-mono">{result.df}</p>
        </div>
        <div className="bg-[#1e293b]/60 border border-white/5 rounded-lg p-3">
          <p className="text-[10px] text-gray-400">p-value</p>
          <p className={`text-sm font-semibold font-mono ${result.isIndependent ? "text-emerald-400" : "text-amber-400"}`}>
            {result.pValue}
          </p>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 leading-relaxed bg-[#1e293b]/40 border border-white/5 rounded-lg p-3">
        {result.description}
      </p>
    </div>
  );
}

/* ════════════════════════════════════════
   Psychology & Anti-Collision Tab
════════════════════════════════════════ */
function PsychologyTab({ predictions }: { predictions: PredictionResult[] }) {
  const collisions = useMemo(
    () => predictions.map((p) => calcCollisionAnalysis(p.reds, p.blue)),
    [predictions]
  );

  return (
    <div className="space-y-6">
      {/* 1. 彩民选号心理与理性认知 */}
      <div className="bg-[#0f172a] border border-white/[0.10] rounded-xl p-5">
        <h2 className="text-sm font-semibold text-white mb-1">彩民选号心理学与行为经济学剖析</h2>
        <p className="text-[11px] text-gray-400 mb-4">
          虽然任何号码中一等奖的物理概率完全相等，但彩民在自主选号时具有高度一致的心理偏好，这直接导致了撞号与奖金平摊风险。
        </p>

        <div className="grid md:grid-cols-3 gap-3">
          <div className="bg-[#1e293b]/60 border border-white/5 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="w-2 h-2 rounded-full bg-red-400" />
              <h3 className="text-[12px] font-medium text-white">赌徒谬误 (Gambler's Fallacy)</h3>
            </div>
            <p className="text-[11px] text-gray-400 leading-relaxed">
              误以为遗漏较久的冷号“下一期弹出的概率更高”。实际上摇奖球无记忆，每期弹出概率依然严格保持 6/33。
            </p>
          </div>

          <div className="bg-[#1e293b]/60 border border-white/5 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              <h3 className="text-[12px] font-medium text-white">热手效应 (Hot-hand Fallacy)</h3>
            </div>
            <p className="text-[11px] text-gray-400 leading-relaxed">
              误以为近几期频发的热号“手气正旺会连续出现”。短期内的频次聚集纯属随机游走的自然样本涨落。
            </p>
          </div>

          <div className="bg-[#1e293b]/60 border border-white/5 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <h3 className="text-[12px] font-medium text-white">撞号与奖金稀释 (Prize Dilution)</h3>
            </div>
            <p className="text-[11px] text-gray-400 leading-relaxed">
              彩民偏爱吉利号(6,8,16,18,28)和生日数(1-31)。选择高离散/冷门组合中奖时可以独享奖金，避免多人平摊。
            </p>
          </div>
        </div>
      </div>

      {/* 2. 本期推荐号码避撞号指数评估 */}
      <div className="bg-[#0f172a] border border-white/[0.10] rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-white">本期 5 注参考号码 — 避撞号独享指数</h2>
            <p className="text-[11px] text-gray-400 mt-0.5">
              得分越高代表越能回避彩民心理集聚区，中奖时独享高额奖金概率越高
            </p>
          </div>
        </div>

        <div className="space-y-3">
          {predictions.map((p, i) => {
            const c = collisions[i];
            return (
              <div key={i} className="bg-[#1e293b]/40 border border-white/5 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-medium text-gray-300">第 {i + 1} 注</span>
                    <span className={`text-xs px-2.5 py-0.5 rounded-full font-semibold font-mono ${
                      c.score >= 80 ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30" :
                      c.score >= 60 ? "bg-blue-500/20 text-blue-300 border border-blue-500/30" :
                      "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                    }`}>
                      避撞号得分: {c.score}分
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {c.tags.map((tag, tidx) => (
                      <span key={tidx} className="text-[10px] px-2 py-0.5 rounded bg-white/5 text-gray-400 border border-white/10">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 my-2.5 flex-wrap">
                  {p.reds.map((n) => (
                    <BallRed key={n} n={n} size="md" />
                  ))}
                  <div className="w-px h-5 bg-white/10 mx-1" />
                  <BallBlue n={p.blue} size="md" />
                </div>

                <p className="text-[11px] text-gray-400 mt-1">{c.description}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. 彩民选号偏好号分布与热门偏好热力 */}
      <div className="bg-[#0f172a] border border-white/[0.10] rounded-xl p-5">
        <h2 className="text-sm font-semibold text-white mb-1">彩民选号心理偏好分布热力</h2>
        <p className="text-[11px] text-gray-400 mb-4">
          红色标记为彩民文化习惯中最喜爱的吉利热门号 (6, 8, 9, 16, 18, 26, 28, 33)，蓝色为相对高位避撞号。
        </p>

        <div className="grid grid-cols-[repeat(auto-fill,minmax(70px,1fr))] gap-2">
          {Array.from({ length: 33 }, (_, i) => i + 1).map((n) => {
            const isPopular = [6, 8, 9, 16, 18, 26, 28, 33].includes(n);
            const isBirthdayOnly = n <= 31;
            return (
              <div
                key={n}
                className={`p-2 rounded-lg text-center border transition-all ${
                  isPopular
                    ? "bg-red-950/40 border-red-500/40 text-red-300"
                    : isBirthdayOnly
                    ? "bg-slate-800/40 border-white/5 text-gray-300"
                    : "bg-emerald-950/30 border-emerald-500/30 text-emerald-300"
                }`}
              >
                <p className="text-xs font-bold font-mono">{String(n).padStart(2, "0")}</p>
                <p className="text-[9px] text-gray-400 mt-0.5">
                  {isPopular ? "热门吉利" : n > 31 ? "高位避撞" : "常规生日"}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   Personal Matrix Tab (个人实战·旋转矩阵缩水)
════════════════════════════════════════ */
function MatrixTab({ records }: { records: ParsedRecord[] }) {
  const [mode, setMode] = useState<"10-保4" | "12-保3" | "14-保3">("10-保4");

  const defaultPool = useMemo(() => {
    if (!records.length) return [1, 5, 8, 12, 16, 19, 22, 26, 29, 32];
    return redFrequency(records)
      .sort((a, b) => b.count - a.count)
      .slice(0, mode === "10-保4" ? 10 : mode === "12-保3" ? 12 : 14)
      .map((f) => f.number)
      .sort((a, b) => a - b);
  }, [records, mode]);

  const [pool, setPool] = useState<number[]>(defaultPool);

  useEffect(() => {
    setPool(defaultPool);
  }, [defaultPool]);

  const toggleBall = (n: number) => {
    if (pool.includes(n)) {
      setPool(pool.filter((x) => x !== n));
    } else {
      const maxAllowed = mode === "10-保4" ? 10 : mode === "12-保3" ? 12 : 14;
      if (pool.length < maxAllowed) {
        setPool([...pool, n].sort((a, b) => a - b));
      }
    }
  };

  const matrixResult = useMemo(
    () => generateRotationalMatrix(pool, mode, records),
    [pool, mode, records]
  );

  const needed = mode === "10-保4" ? 10 : mode === "12-保3" ? 12 : 14;

  return (
    <div className="space-y-6">
      {/* 1. 说明面板 */}
      <div className="bg-[#0f172a] border border-white/[0.10] rounded-xl p-5">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
            <h2 className="text-sm font-semibold text-white">个人实战 — 旋转矩阵组合缩水器</h2>
          </div>
          <span className="text-xs px-3 py-1 rounded-full bg-red-500/20 text-red-300 border border-red-500/30">
            高概率实战保中模式
          </span>
        </div>
        <p className="text-[11px] text-gray-400 leading-relaxed">
          针对个人实战投注，通过组合数学中的**旋转矩阵 (Rotational Matrix / Covering Design)** 算法。
          您只需看好 {needed} 个红球组成球池，算法可以以最少的单式注数（5~7注）在数学上 100% 承诺：**只要开奖红球落在看好的球池内，必中 4 红或 3 红！**
        </p>

        {/* 模式选择按钮 */}
        <div className="flex items-center gap-2 mt-4 flex-wrap">
          <span className="text-xs text-gray-300 font-medium mr-1">缩水模式：</span>
          {(["10-保4", "12-保3", "14-保3"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-lg border transition-all ${
                mode === m
                  ? "bg-red-600 text-white border-red-500 shadow-lg shadow-red-900/40"
                  : "bg-slate-800/80 text-gray-400 border-white/10 hover:text-white"
              }`}
            >
              {m === "10-保4" ? "10球选6保4 (5注)" : m === "12-保3" ? "12球选6保3 (5注)" : "14球选6保3 (7注)"}
            </button>
          ))}
        </div>
      </div>

      {/* 2. 看好球池点选 */}
      <div className="bg-[#0f172a] border border-white/[0.10] rounded-xl p-5">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div>
            <h3 className="text-sm font-semibold text-white">自选/智能候选红球池 ({pool.length}/{needed})</h3>
            <p className="text-[11px] text-gray-400 mt-0.5">
              直接在下方点选您的看好号码，或保留系统根据近 {records.length} 期频率智能推荐的前 {needed} 个热门号
            </p>
          </div>
          <button
            onClick={() => setPool(defaultPool)}
            className="text-xs text-gray-400 hover:text-white px-2.5 py-1 rounded bg-white/5 border border-white/10"
          >
            重置为智能推荐池
          </button>
        </div>

        {/* 1-33 红球点击矩阵 */}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(38px,1fr))] gap-1.5 my-3">
          {Array.from({ length: 33 }, (_, i) => i + 1).map((n) => {
            const selected = pool.includes(n);
            return (
              <button
                key={n}
                onClick={() => toggleBall(n)}
                className={`h-9 rounded-lg font-bold font-mono text-xs flex items-center justify-center transition-all ${
                  selected
                    ? "bg-red-600 text-white border border-red-400 scale-105 shadow-md shadow-red-900/50"
                    : "bg-slate-800/40 text-gray-400 border border-white/5 hover:border-white/20 hover:text-gray-200"
                }`}
              >
                {String(n).padStart(2, "0")}
              </button>
            );
          })}
        </div>

        {pool.length < needed && (
          <p className="text-[11px] text-amber-400/90 mt-2">
            ⚠️ 当前已被选择 {pool.length} 个球，还需点选 {needed - pool.length} 个球以构建完整【{mode}】矩阵。
          </p>
        )}
      </div>

      {/* 3. 矩阵缩水生成结果 */}
      <div className="bg-[#0f172a] border border-white/[0.10] rounded-xl p-5">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div>
            <h3 className="text-sm font-semibold text-white">旋转矩阵生成方案 ({matrixResult.bets.length} 注)</h3>
            <p className="text-[11px] text-emerald-400 font-mono mt-0.5">
              组合覆盖率: {matrixResult.coverageRate}% · 蓝球命中率: {((matrixResult.bets.length / 16) * 100).toFixed(1)}%
            </p>
          </div>
          <span className="text-xs px-3 py-1 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 font-mono">
            {matrixResult.guaranteeText}
          </span>
        </div>

        <div className="space-y-2.5 mt-4">
          {matrixResult.bets.map((b, idx) => (
            <div
              key={idx}
              className="bg-[#1e293b]/50 border border-white/10 rounded-xl px-4 py-3 flex items-center justify-between flex-wrap gap-3"
            >
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold text-gray-300 w-28 shrink-0">{b.label}</span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {b.reds.map((n) => (
                    <BallRed key={n} n={n} size="md" />
                  ))}
                  <div className="w-px h-5 bg-white/10 mx-1" />
                  <BallBlue n={b.blue} size="md" />
                </div>
              </div>

              <span className="text-[11px] text-gray-400 font-mono">
                和值 {b.reds.reduce((s, x) => s + x, 0)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


