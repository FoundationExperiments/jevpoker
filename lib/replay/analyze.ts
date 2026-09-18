import { deck52, evaluate, legalActions } from '../poker/engine.ts';
import type { Game, Action } from '../poker/engine.ts';
import type { Finding } from './types.ts';

export function contribution(g: Game, action: Action) {
  const p = g.players[g.actor!];
  if (action.type === 'call')
    return Math.min(p.stack, Math.max(0, g.currentBet - p.bet));
  if (action.type === 'raise') return (action.amount || 0) - p.bet;
  return action.type === 'allin' ? p.stack : 0;
}
export function exactRiver(g: Game) {
  const p = g.players[g.actor!],
    known = [...p.hole, ...g.board];
  if (g.board.length !== 5) return null;
  const remaining = deck52().filter((c) => !known.includes(c)),
    score = evaluate(known).score;
  let win = 0,
    tie = 0,
    lose = 0;
  for (let i = 0; i < remaining.length; i++)
    for (let j = i + 1; j < remaining.length; j++) {
      const other = evaluate([remaining[i], remaining[j], ...g.board]).score;
      if (score > other) win++;
      else if (score === other) tie++;
      else lose++;
    }
  return { win, tie, lose, total: win + tie + lose };
}
export function randomEquity(g: Game, seed: number, samples = 16000) {
  const p = g.players[g.actor!],
    known = [...p.hole, ...g.board],
    available = deck52().filter((c) => !known.includes(c));
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  let sum = 0,
    squares = 0;
  for (let i = 0; i < samples; i++) {
    const deck = [...available],
      draw = () => deck.splice(Math.floor(random() * deck.length), 1)[0];
    const opponent = [draw(), draw()],
      board = [...g.board];
    while (board.length < 5) board.push(draw());
    const a = evaluate([...p.hole, ...board]).score,
      b = evaluate([...opponent, ...board]).score;
    const v = a > b ? 1 : a === b ? 0.5 : 0;
    sum += v;
    squares += v * v;
  }
  const equity = sum / samples,
    se = Math.sqrt(Math.max(0, squares / samples - equity * equity) / samples);
  return {
    equity,
    low: Math.max(0, equity - 2.576 * se),
    high: Math.min(1, equity + 2.576 * se),
    samples,
  };
}
export function analyze(
  g: Game,
  action: Action,
  baseline: string,
  seed: number,
  deep = true,
): Finding[] {
  const p = g.players[g.actor!],
    legal = legalActions(g)!;
  const pot = g.players.reduce((s, q) => s + q.total, 0),
    findings: Finding[] = [];
  const active = g.players.filter(
    (q) => q.id !== p.id && !['folded', 'out'].includes(q.status),
  );
  if (action.type === 'fold' && legal.check)
    findings.push({
      kind: 'certain',
      title: '可以免费过牌，却直接弃牌',
      detail:
        '当前不需要投入筹码。过牌至少保留现有权益，直接弃牌不会带来收益优势。',
      recommendation: '至少选择过牌；如需下注，还应另行评估价值或诈唬。',
      source: '合法动作与筹码状态；弱支配关系，不估算具体损失。',
    });
  if (
    action.type === 'fold' &&
    legal.call > 0 &&
    g.board.length === 5 &&
    active.length === 1
  ) {
    const e = exactRiver(g)!;
    if (e.lose === 0) {
      const minEquity = e.tie > 0 ? 0.5 : 1,
        minimumGain =
          (minEquity * (pot + legal.call) - legal.call) / g.bigBlind;
      if (minimumGain > 0)
        findings.push({
          kind: 'certain',
          title:
            e.tie === e.total
              ? '必然平分底池，却选择弃牌'
              : '河牌没有可能输的牌，却弃牌',
          detail: `穷举 ${e.total} 种合法对手底牌：胜 ${e.win}、平 ${e.tie}、负 0。跟注相对弃牌至少多得 ${minimumGain.toFixed(2)} bb。`,
          recommendation: '选择跟注。对手已全下时不需要考虑后续下注。',
          lossBB: minimumGain,
          source: '穷举全部未知对手底牌；没有读取实际对手底牌。',
        });
    }
  }
  // Only evaluate terminal HU decisions against the known card-independent
  // random policy. Uniform ranges are not valid for the other opponents.
  const terminal = active.length === 1 && active[0].status === 'allin';
  if (
    deep &&
    baseline === 'random' &&
    g.players.length === 2 &&
    terminal &&
    legal.call > 0 &&
    ['call', 'fold', 'allin'].includes(action.type)
  ) {
    const e = randomEquity(g, seed),
      required = legal.call / (pot + legal.call),
      scale = (pot + legal.call) / g.bigBlind;
    const callEV = e.equity * scale - legal.call / g.bigBlind;
    const badCall =
      action.type !== 'fold' &&
      e.high < required &&
      (required - e.high) * scale > 1;
    const badFold =
      action.type === 'fold' &&
      e.low > required &&
      (e.low - required) * scale > 1;
    if (badCall || badFold)
      findings.push({
        kind: 'estimated',
        title: badCall
          ? '权益不足，仍跟注全下'
          : '对随机对手有跟注价值，却弃牌',
        detail: `需 ${(required * 100).toFixed(1)}% 权益保本；对已知随机策略的模拟权益 ${(e.equity * 100).toFixed(1)}%（99% 模拟区间 ${(e.low * 100).toFixed(1)}%–${(e.high * 100).toFixed(1)}%）。跟注相对弃牌的估计期望收益 ${callEV.toFixed(2)} bb。`,
        recommendation: badCall
          ? '面对本实验的随机策略应弃牌。不能把均匀范围假设直接套到真实玩家。'
          : '面对本实验的随机策略应跟注。该结论依赖对手动作与底牌无关。',
        lossBB: Math.abs(callEV),
        equity: e.equity,
        equityCI: [e.low, e.high],
        requiredEquity: required,
        samples: e.samples,
        source:
          '16,000 次补牌模拟；只使用行动时的底牌和公共牌。区间仅描述模拟误差，并非 GTO 分析。',
      });
  }
  const paid = contribution(g, action);
  if (!findings.length && paid >= 20 * g.bigBlind)
    findings.push({
      kind: 'review',
      title: '这次投入较大，需结合对手范围复核',
      detail: `本次投入 ${(paid / g.bigBlind).toFixed(1)} bb。${legal.call > 0 ? `跟注保本门槛 ${((legal.call / (pot + legal.call)) * 100).toFixed(1)}%。` : ''}仅靠最终输赢和牌面，不能判断该动作是否最优。`,
      recommendation:
        '先估计对手范围，再比较跟注权益、价值下注或诈唬所需弃牌率。这里没有把大额投入自动判成错误。',
      source: '投入金额提示；不是错误判定，也不计入问题数。',
    });
  return findings;
}
