import type {
  Action,
  Decision,
  Legal,
  Player,
  Street,
} from '../poker/engine.ts';
export type Finding = {
  kind: 'certain' | 'estimated' | 'review';
  title: string;
  detail: string;
  recommendation: string;
  lossBB?: number;
  equity?: number;
  equityCI?: number[];
  requiredEquity?: number;
  samples?: number;
  source: string;
};
export type Snapshot = {
  street: Street;
  board: string[];
  pot: number;
  currentBet: number;
  actor: number | null;
  button: number;
  players: Pick<
    Player,
    'id' | 'stack' | 'hole' | 'status' | 'bet' | 'total' | 'lastAction'
  >[];
  legal: Legal | null;
  rank: string | null;
};
export type Frame = {
  kind: 'start' | 'action' | 'deal' | 'result' | 'failure';
  title: string;
  snapshot: Snapshot;
  actionIndex?: number;
  seat?: number;
  action?: Action;
  decision?: Decision;
  findings: Finding[];
  request?: unknown;
  response?: unknown;
  latencyMs?: number;
  error?: string;
  probabilities?: Record<string, number>;
};
export type ReplaySummary = {
  id: string;
  run: 'main' | 'pilot';
  kind: 'match' | 'diagnostic';
  number: number;
  groupId: string;
  baseline: string;
  seats: number;
  jevSeat: number;
  hole: string[];
  netBB: number | null;
  included: boolean;
  complete: boolean;
  issueCount: number;
  estimatedCount: number;
  reviewCount: number;
  firstIssue: number;
  label: string;
  decisions: number;
};
export type ReplayHand = ReplaySummary & {
  frames: Frame[];
  log: string[];
  board: string[];
  diagnosticNote?: string;
  payouts: Record<number, number>;
  endingStacks: number[];
  source: string;
};
export type ReplayIndex = {
  generatedAt: string;
  model: string;
  validHands: number;
  recordedHands: number;
  failedCalls: number;
  conditions: {
    condition: string;
    hands: number;
    bbPer100: number;
    ci95: number[];
  }[];
  hands: ReplaySummary[];
  findingCounts: { certain: number; estimated: number; review: number };
  method: string[];
};
