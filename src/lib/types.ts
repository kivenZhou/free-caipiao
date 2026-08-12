export interface LotteryRecord {
  code: string; // 期号
  date: string; // 开奖日期
  red: string; // 红球，逗号分隔，如 "01,05,12,19,24,30"
  blue: string; // 蓝球，如 "07"
  sales?: string; // 销售额
  poolmoney?: string; // 奖池金额
}

export interface LotteryApiResponse {
  state: number;
  message: string;
  total: number;
  pageNo: number;
  pageSize: number;
  result: LotteryRecord[];
  source?: "cwl" | "mirror" | "bundled" | "cache";
}

export interface ParsedRecord {
  code: string;
  date: string;
  reds: number[];
  blue: number;
}

export interface FrequencyItem {
  number: number;
  count: number;
  percentage: number;
}

export interface PredictionResult {
  reds: number[];
  blue: number;
  method: string;
  markovScore?: number;
  acValue?: number;
  sameTail?: boolean;
  gaussianScore?: number;
}

/** 一注号码 */
export interface TipBet {
  reds: number[];
  blue: number;
  label: string;
}

/** 某次生成并落盘的推荐快照（按目标期号存） */
export interface TipSnapshot {
  id: string;
  createdAt: string;
  /** 预测要打的目标期号，如 2026093 */
  targetIssue: string;
  /** 生成时已知的最新开奖期号 */
  basedOnIssue: string;
  /** 分析所用历史期数，如 300 */
  pageSize: number;
  /** 综合策略 5 注 */
  bets: TipBet[];
  /** 对照策略各 1 注：热号 / 冷号 / 随机 */
  strategies: {
    hot: TipBet;
    cold: TipBet;
    random: TipBet;
  };
}

export interface BetHit {
  redHits: number[];
  redHitCount: number;
  blueHit: boolean;
}

export interface TipReview extends TipSnapshot {
  status: "pending" | "drawn";
  actual?: {
    code: string;
    date: string;
    reds: number[];
    blue: number;
  };
  betHits?: BetHit[];
  strategyHits?: {
    hot: BetHit;
    cold: BetHit;
    random: BetHit;
  };
}

export interface ChiSquareResult {
  chi2: number;
  df: number;
  pValue: number;
  isUniform: boolean;
  sampleSize: number;
}

export interface CollisionAnalysis {
  score: number;
  tags: string[];
  description: string;
}

export interface PrizeRankInfo {
  rank: string;
  name: string;
  rule: string;
  prob: number;
  probRatioStr: string;
  prizeStr: string;
  evContribution: number;
}

export interface MatrixReductionResult {
  pool: number[];
  mode: "10-保4" | "12-保3" | "14-保3";
  bets: TipBet[];
  coverageRate: number;
  guaranteeText: string;
}

export interface BacktestResult {
  totalIssues: number;
  totalSpent: number;
  totalReturn: number;
  netProfit: number;
  roiPct: number;
  winIssueCount: number;
  rankCounts: { [rank: string]: number };
  details: {
    code: string;
    date: string;
    actualStr: string;
    hitDesc: string;
    prizeAmt: number;
  }[];
}

/** 游程检验结果 */
export interface RunsTestResult {
  /** 号码 */
  number: number;
  /** 实际游程数 */
  runs: number;
  /** 期望游程数 */
  expectedRuns: number;
  /** Z 统计量 */
  zScore: number;
  /** p-value (双侧) */
  pValue: number;
  /** 是否通过独立性检验 (p >= 0.05) */
  isIndependent: boolean;
  /** 出现次数 */
  nOnes: number;
  /** 未出现次数 */
  nZeros: number;
}

/** 自相关分析结果 */
export interface AutocorrelationResult {
  /** 号码 */
  number: number;
  /** 各 lag 的自相关系数 */
  acfValues: { lag: number; acf: number; significant: boolean }[];
  /** Bartlett 置信带阈值 (±) */
  confidenceBand: number;
  /** 是否存在任何显著 lag */
  hasSignificantLag: boolean;
}

/** 马尔可夫矩阵有效性评估 */
export interface MarkovValidation {
  /** 与均匀矩阵的 KL 散度 */
  klDivergence: number;
  /** 最大行 KL 散度 */
  maxRowKL: number;
  /** 最小行 KL 散度 */
  minRowKL: number;
  /** 矩阵信息熵 (平均行熵) */
  avgEntropy: number;
  /** 均匀矩阵信息熵 */
  uniformEntropy: number;
  /** 是否有显著预测信号 */
  hasSignal: boolean;
  /** 文字描述 */
  description: string;
}

/** Kelly 准则计算结果 */
export interface KellyResult {
  /** 各奖级的 Kelly 分数 */
  rankKelly: { rank: string; kelly: number; description: string }[];
  /** 总体最优投注比例 */
  optimalFraction: number;
  /** 每期建议最大投注金额（基于给定总资金） */
  suggestedBet: number;
  /** 风险提示 */
  riskNote: string;
}

/** 红蓝球独立性检验 */
export interface IndependenceTestResult {
  /** χ² 统计量 */
  chi2: number;
  /** 自由度 */
  df: number;
  /** p-value */
  pValue: number;
  /** 是否独立 */
  isIndependent: boolean;
  /** 描述 */
  description: string;
}

