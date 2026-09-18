import {
  createGame,
  shuffled,
  actionChoices,
  applyAction,
  evaluate,
  deck52,
  legalActions,
} from "../lib/poker/engine.ts";
import type { Game } from "../lib/poker/engine.ts";
import { practiceDecision } from "../lib/poker/decisions.ts";
export const BASE_SEED = 20260918;
export function seeded(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
export function seededGame(seats: number, seed: number): Game {
  const g = createGame(seats, "jev", 2000),
    deck = shuffled(seeded(seed));
  const oldNames = g.players.map((p) => p.name);
  g.players.forEach((p) => {
    p.hole = [];
    p.name = `Seat ${p.id}`;
  });
  for (let round = 0; round < 2; round++)
    for (let step = 1; step <= seats; step++)
      g.players[(g.button + step) % seats].hole.push(deck.pop()!);
  g.deck = deck;
  g.log = g.log.map((line) => {
    for (let i = 0; i < oldNames.length; i++) line = line.replaceAll(oldNames[i], `Seat ${i}`);
    return line;
  });
  return g;
}
export type Baseline = "random" | "calling" | "mc56";
export function baselineAction(g: Game, kind: Baseline, rng: () => number) {
  if (kind === "mc56") return practiceDecision(g, rng, 56).action;
  const choices = Object.values(actionChoices(g));
  if (kind === "random") return choices[Math.floor(rng() * choices.length)].action;
  return { type: legalActions(g)!.check ? "check" : "call" } as const;
}
export function finishBaseline(g: Game, kind: Baseline, seed: number) {
  const rngs = g.players.map((p) => seeded(seed + 7919 * p.id));
  let count = 0;
  while (g.street !== "complete") {
    applyAction(g, baselineAction(g, kind, rngs[g.actor!]));
    if (++count > 200) throw new Error("Hand did not terminate");
  }
  return g;
}
export function mean(xs: number[]) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
export function bootstrapMean(xs: number[], seed = 78239, iterations = 10000) {
  const random = seeded(seed),
    values = [];
  for (let k = 0; k < iterations; k++) {
    let sum = 0;
    for (let i = 0; i < xs.length; i++) sum += xs[Math.floor(random() * xs.length)];
    values.push(sum / xs.length);
  }
  values.sort((a, b) => a - b);
  return {
    mean: mean(xs),
    low: values[Math.floor(iterations * 0.025)],
    high: values[Math.floor(iterations * 0.975)],
  };
}
export function quantile(xs: number[], q: number) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((s.length - 1) * q))];
}
export type Diagnostic = { id: string; title: string; g: Game; expected: string[]; why: string };
export function diagnostics(): Diagnostic[] {
  const definitions = [
    {
      id: "royal",
      title: "皇家同花顺面对全下",
      hole: ["As", "Ks"],
      board: ["Qs", "Js", "Ts", "2d", "3c"],
      bet: true,
      expected: ["call"],
      why: "唯一最大牌，跟注严格优于弃牌。",
    },
    {
      id: "quads_aces",
      title: "四条 A 面对全下",
      hole: ["As", "Ah"],
      board: ["Ad", "Ac", "2s", "7h", "Kc"],
      bet: true,
      expected: ["call"],
      why: "唯一最大牌，跟注严格优于弃牌。",
    },
    {
      id: "quads_nines",
      title: "四条 9 面对全下",
      hole: ["9s", "9h"],
      board: ["9d", "9c", "As", "Kd", "2h"],
      bet: true,
      expected: ["call"],
      why: "此牌面不可能有更大四条或同花顺，跟注严格优于弃牌。",
    },
    {
      id: "nut_flush",
      title: "无对牌面的最大同花面对全下",
      hole: ["As", "Ks"],
      board: ["Qs", "8s", "3s", "2d", "9c"],
      bet: true,
      expected: ["call"],
      why: "此牌面无更大同花、同花顺、葫芦或四条，跟注严格优于弃牌。",
    },
    {
      id: "royal_board",
      title: "公共牌皇家同花顺面对全下",
      hole: ["2c", "3d"],
      board: ["Ah", "Kh", "Qh", "Jh", "Th"],
      bet: true,
      expected: ["call"],
      why: "所有合法对手底牌都平分；跟注收回 2000，弃牌仅剩 1900。",
    },
    {
      id: "quads_board",
      title: "公共牌四条 A 加 K 面对全下",
      hole: ["2c", "3d"],
      board: ["Ac", "Ad", "Ah", "As", "Kd"],
      bet: true,
      expected: ["call"],
      why: "双方必然使用公共牌平分；跟注严格优于弃牌。",
    },
    {
      id: "free_check_trash",
      title: "河牌弱牌可免费过牌",
      hole: ["2c", "3d"],
      board: ["Ah", "Ks", "9c", "7d", "4h"],
      bet: false,
      expected: ["check", "raise_min", "raise_half_pot", "raise_pot", "all_in"],
      why: "免费过牌可保留所有后续选项；直接弃牌是弱劣势动作。此题仅判定是否无代价弃牌，不把所有下注判为好策略。",
    },
    {
      id: "free_check_pair",
      title: "河牌一对可免费过牌",
      hole: ["8c", "8d"],
      board: ["Ah", "Ks", "9c", "7d", "4h"],
      bet: false,
      expected: ["check", "raise_min", "raise_half_pot", "raise_pot", "all_in"],
      why: "只检测免费弃牌。",
    },
  ];
  return definitions.map((d) => {
    const g = seededGame(2, BASE_SEED);
    g.street = "river";
    g.board = d.board;
    g.players[0].hole = d.hole;
    const remaining = deck52().filter((c) => ![...d.hole, ...d.board].includes(c));
    g.players[1].hole = remaining.slice(0, 2);
    g.deck = remaining.slice(2);
    g.players[0].total = 100;
    g.players[0].bet = 0;
    g.players[0].stack = 1900;
    g.players[0].actedAt = null;
    g.players[0].status = "active";
    g.players[1].total = d.bet ? 2000 : 100;
    g.players[1].bet = d.bet ? 1900 : 0;
    g.players[1].stack = d.bet ? 0 : 1900;
    g.players[1].actedAt = d.bet ? 1900 : 0;
    g.players[1].status = d.bet ? "allin" : "active";
    g.currentBet = d.bet ? 1900 : 0;
    g.lastFullRaise = d.bet ? 1900 : 20;
    g.actor = 0;
    g.pending = [0];
    g.log = [
      "Both players contributed 100 chips on earlier streets.",
      "River: " + d.board.join(" "),
      d.bet ? "Seat 1 bets all-in for 1900. Seat 0 must act." : "Seat 1 checks. Seat 0 must act.",
    ];
    return { id: d.id, title: d.title, g, expected: d.expected, why: d.why };
  });
}
export function verifyNutDiagnostic(g: Game) {
  const hero = evaluate([...g.players[0].hole, ...g.board]).score,
    remaining = deck52().filter((c) => ![...g.players[0].hole, ...g.board].includes(c));
  let win = 0,
    tie = 0,
    lose = 0;
  for (let i = 0; i < remaining.length; i++)
    for (let j = i + 1; j < remaining.length; j++) {
      const other = evaluate([remaining[i], remaining[j], ...g.board]).score;
      if (hero > other) win++;
      else if (hero === other) tie++;
      else lose++;
    }
  return { win, tie, lose, combos: win + tie + lose };
}
