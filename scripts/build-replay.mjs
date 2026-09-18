import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import {
  seededGame,
  seeded,
  baselineAction,
  diagnostics,
} from './evaluate-lib.ts';
import {
  applyAction,
  actionChoices,
  evaluate,
  legalActions,
  streets,
} from '../lib/poker/engine.ts';
import { jevRequest } from '../lib/poker/decisions.ts';
import { analyze, contribution } from '../lib/replay/analyze.ts';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i < 0 ? d : process.argv[i + 1];
};
const source = resolve(
  arg('--source', root + '/outputs/evaluation-2026-09-18'),
);
const out = resolve(arg('--out', root + '/public/replays'));
const deep = !process.argv.includes('--quick');
mkdirSync(out + '/hands', { recursive: true });
const read = (dir, file) =>
  JSON.parse(readFileSync(resolve(dir, file), 'utf8'));
const lines = (dir, file) =>
  readFileSync(resolve(dir, file), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((s) => JSON.parse(s));
const summaries = [],
  findingCounts = { certain: 0, estimated: 0, review: 0 };
const labels = {
  random: '随机策略',
  calling: '只过牌 / 跟注',
  mc56: 'MC56 策略',
  diagnostic: '基础诊断',
};
function snapshot(g, hero) {
  return {
    street: g.street,
    board: [...g.board],
    pot:
      g.street === 'complete'
        ? g.settledPot
        : g.players.reduce((s, p) => s + p.total, 0),
    currentBet: g.currentBet,
    actor: g.actor,
    button: g.button,
    players: g.players.map(
      ({ id, stack, hole, status, bet, total, lastAction }) => ({
        id,
        stack,
        hole: [...hole],
        status,
        bet,
        total,
        lastAction,
      }),
    ),
    legal: legalActions(g),
    rank:
      g.board.length >= 3
        ? evaluate([...g.players[hero].hole, ...g.board]).name
        : null,
  };
}
function actionLabel(g, a, hero) {
  const who = g.actor === hero ? 'Jev' : `座位 ${g.actor + 1}`;
  const paid = contribution(g, a) / 20;
  return `${who} ${a.type === 'fold' ? '弃牌' : a.type === 'check' ? '过牌' : a.type === 'call' ? `跟注 ${paid} bb` : a.type === 'allin' ? `全下 ${paid} bb` : `加注至 ${a.amount / 20} bb`}`;
}
function addAction(frames, g, hero, a, wire, baseline, seed, index) {
  const before = snapshot(g, hero),
    title = actionLabel(g, a, hero);
  if (wire) assert.deepEqual(wire.request, jevRequest(g, wire.decision.model));
  const findings = wire
    ? analyze(g, a, baseline, seed + index * 199, deep)
    : [];
  const paid = contribution(g, a),
    actor = g.actor;
  frames.push({
    kind: 'action',
    title,
    snapshot: before,
    actionIndex: index,
    seat: actor,
    action: a,
    decision: wire?.decision,
    latencyMs: wire?.durationMs,
    request: wire?.request,
    response: wire?.response,
    probabilities: wire?.response?.answers?.poker_action?.probabilities,
    findings,
  });
  applyAction(g, a);
  if (g.board.length > before.board.length) {
    const settled = g.street === 'complete';
    const after = snapshot(g, hero);
    const pending = structuredClone(before);
    const p = pending.players[actor];
    p.stack -= paid;
    p.total += paid;
    p.bet += paid;
    p.lastAction = title;
    if (a.type === 'fold') p.status = 'folded';
    else if (p.stack === 0) p.status = 'allin';
    pending.pot = before.pot + paid;
    pending.actor = null;
    pending.currentBet = 0;
    pending.legal = null;
    pending.players.forEach((p) => (p.bet = 0));
    for (const n of [3, 4, 5].filter(
      (n) => n > before.board.length && n <= g.board.length,
    )) {
      const state = structuredClone(settled ? pending : after);
      state.board = g.board.slice(0, n);
      state.street = n === 3 ? 'flop' : n === 4 ? 'turn' : 'river';
      state.rank = evaluate([...g.players[hero].hole, ...state.board]).name;
      frames.push({
        kind: 'deal',
        title: `发出${streets[state.street]}`,
        snapshot: state,
        findings: [],
      });
    }
  }
}
function save(meta, g, frames, wireCount, log) {
  const all = frames.flatMap((f) => f.findings);
  for (const f of all) findingCounts[f.kind]++;
  const summary = {
    ...meta,
    issueCount: all.filter((f) => f.kind === 'certain').length,
    estimatedCount: all.filter((f) => f.kind === 'estimated').length,
    reviewCount: all.filter((f) => f.kind === 'review').length,
    firstIssue: frames.findIndex((f) =>
      f.findings.some((f) => f.kind !== 'review'),
    ),
    decisions: wireCount,
  };
  const record = {
    ...summary,
    frames,
    log: log || g.log,
    board: g.board,
    payouts: g.payouts,
    endingStacks: g.players.map((p) => p.stack),
    source: '评测模型 jev-1.13.0；问题分析是离线复核，不是模型的自述推理。',
  };
  if (meta.kind === 'diagnostic')
    record.diagnosticNote =
      '合成诊断局面，不纳入对战收益；对手底牌只是合法样例，确定性结论使用全部可能底牌验证。';
  writeFileSync(
    resolve(out, 'hands', meta.id + '.json'),
    JSON.stringify(record),
  );
  summaries.push(summary);
}
for (const run of ['main', 'pilot']) {
  const dir = resolve(source, run),
    calls = lines(dir, 'calls.jsonl'),
    hands = lines(dir, 'hands.jsonl'),
    groups = lines(dir, 'groups.jsonl');
  const included = new Set(groups.filter((g) => g.ok).map((g) => g.id));
  const wires = new Map(
    calls
      .filter((c) => c.ok && c.kind === 'match')
      .map((c) => [`${c.groupId}:${c.jevSeat}:${c.actionIndex}`, c]),
  );
  for (const h of hands) {
    const g = seededGame(h.seats, h.seed),
      frames = [
        {
          kind: 'start',
          title: '盲注已下，开始本手',
          snapshot: snapshot(g, h.jevSeat),
          findings: [],
        },
      ];
    assert.deepEqual(
      g.players.map((p) => p.hole),
      h.initial.holes,
    );
    assert.deepEqual(g.deck, h.initial.deck);
    for (const [i, a] of h.actions.entries())
      addAction(
        frames,
        g,
        h.jevSeat,
        a.action,
        wires.get(`${h.groupId}:${h.jevSeat}:${i}`),
        h.baseline,
        h.seed,
        i,
      );
    assert.deepEqual(
      g.players.map((p) => p.stack),
      h.endingStacks,
    );
    assert.deepEqual(g.board, h.board);
    frames.push({
      kind: 'result',
      title: '本手结束 · 结算',
      snapshot: snapshot(g, h.jevSeat),
      findings: [],
    });
    save(
      {
        id: `${run}-${h.groupId}-s${h.jevSeat}`,
        run,
        kind: 'match',
        number: Number(h.groupId.split('-').at(-1)) + 1,
        groupId: h.groupId,
        baseline: h.baseline,
        seats: h.seats,
        jevSeat: h.jevSeat,
        hole: h.initial.holes[h.jevSeat],
        netBB: h.netBB,
        included: included.has(h.groupId),
        complete: true,
        label: labels[h.baseline],
      },
      g,
      frames,
      h.actions.filter((a) => a.decision).length,
      h.log,
    );
  }
  // Recover attempted but interrupted hands from recorded model decisions and
  // the deterministic baseline. Stop at the missing action; never invent it.
  const completed = new Set(hands.map((h) => `${h.groupId}:${h.jevSeat}`));
  const interrupted = new Map(
    calls
      .filter(
        (c) =>
          c.kind === 'match' && !completed.has(`${c.groupId}:${c.jevSeat}`),
      )
      .map((c) => [`${c.groupId}:${c.jevSeat}`, c]),
  );
  for (const c of interrupted.values()) {
    const g = seededGame(c.seats, c.seed),
      rngs = g.players.map((p) => seeded(c.seed + 7919 * p.id));
    const frames = [
      {
        kind: 'start',
        title: '开始本手（后来连接失败）',
        snapshot: snapshot(g, c.jevSeat),
        findings: [],
      },
    ];
    let i = 0,
      count = 0;
    while (g.street !== 'complete') {
      const wire = wires.get(`${c.groupId}:${c.jevSeat}:${i}`);
      if (g.actor === c.jevSeat && !wire) {
        frames.push({
          kind: 'failure',
          title: '连接失败 · 此动作未执行',
          snapshot: snapshot(g, c.jevSeat),
          findings: [],
          error: '该位置的请求及重试都未成功。回放在此停止，未替模型选择动作。',
        });
        break;
      }
      const action =
        g.actor === c.jevSeat
          ? actionChoices(g)[wire.decision.choice].action
          : baselineAction(g, c.baseline, rngs[g.actor]);
      addAction(
        frames,
        g,
        c.jevSeat,
        action,
        g.actor === c.jevSeat ? wire : null,
        c.baseline,
        c.seed,
        i,
      );
      if (wire) count++;
      if (++i > 200) throw new Error('Interrupted replay did not terminate');
    }
    save(
      {
        id: `${run}-${c.groupId}-s${c.jevSeat}`,
        run,
        kind: 'match',
        number: Number(c.groupId.split('-').at(-1)) + 1,
        groupId: c.groupId,
        baseline: c.baseline,
        seats: c.seats,
        jevSeat: c.jevSeat,
        hole: g.players[c.jevSeat].hole,
        netBB: null,
        included: false,
        complete: false,
        label: labels[c.baseline],
      },
      g,
      frames,
      count,
    );
  }
  for (const c of calls.filter((c) => c.kind === 'diagnostic' && c.ok)) {
    const d = diagnostics().find((d) => d.id === c.probeId),
      g = structuredClone(d.g),
      frames = [];
    const action = actionChoices(g)[c.decision.choice].action;
    addAction(frames, g, 0, action, c, 'diagnostic', 20260918, c.repeat);
    if (g.street === 'complete')
      frames.push({
        kind: 'result',
        title: '诊断题 · 结算',
        snapshot: snapshot(g, 0),
        findings: [],
      });
    save(
      {
        id: `${run}-diagnostic-${c.probeId}-${c.repeat}`,
        run,
        kind: 'diagnostic',
        number: c.repeat + 1,
        groupId: c.probeId,
        baseline: 'diagnostic',
        seats: 2,
        jevSeat: 0,
        hole: d.g.players[0].hole,
        netBB: null,
        included: false,
        complete: g.street === 'complete',
        label: d.title,
      },
      g,
      frames,
      1,
    );
  }
  console.log(`${run}: replayed and validated`);
}
const stats = read(resolve(source, 'main'), 'summary.json');
const index = {
  generatedAt: new Date().toISOString(),
  model: 'jev-1.13.0',
  validHands: stats.conditions.reduce((s, c) => s + c.hands, 0),
  recordedHands: summaries.filter((h) => h.run === 'main' && h.kind === 'match')
    .length,
  failedCalls: stats.api.failed,
  conditions: stats.conditions.map(({ condition, hands, bbPer100, ci95 }) => ({
    condition,
    hands,
    bbPer100,
    ci95,
  })),
  hands: summaries,
  findingCounts,
  method: [
    '正式计划 720 手；4 手因所在组中断而未开始。其余 716 个开局记录全部展示，其中 708 手计入收益。另有 42 手试跑和 32 条重复诊断记录。',
    '明确错误来自合法动作和穷举；对随机基线的赔率问题使用只基于行动时信息的模拟。',
    '其他局面没有专业求解器或对手范围，不将输钱、大额下注或低 confidence 自动判错。',
    '回放可手动显示对手底牌用于复盘；Jev 的原始输入从未包含这些牌。',
  ],
};
const encoded = JSON.stringify(index);
assert.ok(!encoded.includes('apikey_'));
writeFileSync(resolve(out, 'index.json'), encoded);
console.log(
  JSON.stringify({ hands: summaries.length, findings: findingCounts, deep }),
);
