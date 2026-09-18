export type Card = string;
export type Mode = 'practice' | 'jev';
export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'complete';
export type Action = {
  type: 'fold' | 'check' | 'call' | 'raise' | 'allin';
  amount?: number;
};
export type Player = {
  id: number;
  name: string;
  stack: number;
  hole: Card[];
  status: 'active' | 'folded' | 'allin' | 'out';
  bet: number;
  total: number;
  actedAt: number | null;
  lastAction: string;
};
export type PotResult = { amount: number; winners: number[]; refund: boolean };
export type Decision = {
  player: number;
  source: Mode;
  model?: string;
  latencyMs: number;
  confidence?: number;
  choice: string;
};
export type Game = {
  players: Player[];
  mode: Mode;
  hand: number;
  button: number;
  smallBlind: number;
  bigBlind: number;
  deck: Card[];
  board: Card[];
  street: Street;
  currentBet: number;
  lastFullRaise: number;
  actor: number | null;
  pending: number[];
  log: string[];
  revision: number;
  pots: PotResult[];
  payouts: Record<number, number>;
  ranks: Record<number, string>;
  showdown: boolean;
  lastDecision: Decision | null;
  settledPot: number;
};
export type Legal = {
  fold: boolean;
  check: boolean;
  call: number;
  minRaise: number;
  maxRaise: number;
  canRaise: boolean;
  canAllIn: boolean;
};
export type PublicGame = Omit<
  Game,
  'deck' | 'pending' | 'lastFullRaise' | 'players'
> & {
  players: Omit<Player, 'actedAt'>[];
  legal: Legal | null;
  pot: number;
  sessionOver: boolean;
};
export const streets: Record<Street, string> = {
  preflop: '翻牌前',
  flop: '翻牌',
  turn: '转牌',
  river: '河牌',
  complete: '本手结束',
};
const rankNames = [
  '高牌',
  '一对',
  '两对',
  '三条',
  '顺子',
  '同花',
  '葫芦',
  '四条',
  '同花顺',
];
export function deck52(): Card[] {
  return '23456789TJQKA'
    .split('')
    .flatMap((r) => 'shdc'.split('').map((s) => r + s));
}
function secureRandom(): number {
  const x = new Uint32Array(1);
  crypto.getRandomValues(x);
  return x[0] / 4294967296;
}
export function shuffled(rng = secureRandom): Card[] {
  const deck = deck52();
  for (let i = 51; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
function scoreFive(cards: Card[]): number {
  const ranks = cards
    .map((c) => '23456789TJQKA'.indexOf(c[0]) + 2)
    .sort((a, b) => b - a);
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) || 0) + 1);
  const groups = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const unique = [...new Set(ranks)];
  if (unique[0] === 14) unique.push(1);
  let straight = 0;
  for (let i = 0; i <= unique.length - 5; i++)
    if (unique[i] - unique[i + 4] === 4) {
      straight = unique[i];
      break;
    }
  const flush = cards.every((c) => c[1] === cards[0][1]);
  let cat = 0,
    tie = ranks;
  if (flush && straight) {
    cat = 8;
    tie = [straight];
  } else if (groups[0][1] === 4) {
    cat = 7;
    tie = [groups[0][0], groups[1][0]];
  } else if (groups[0][1] === 3 && groups[1][1] === 2) {
    cat = 6;
    tie = [groups[0][0], groups[1][0]];
  } else if (flush) {
    cat = 5;
  } else if (straight) {
    cat = 4;
    tie = [straight];
  } else if (groups[0][1] === 3) {
    cat = 3;
    tie = groups.map((g) => g[0]);
  } else if (groups[0][1] === 2 && groups[1][1] === 2) {
    cat = 2;
    tie = groups.map((g) => g[0]);
  } else if (groups[0][1] === 2) {
    cat = 1;
    tie = groups.map((g) => g[0]);
  }
  let score = cat;
  for (let i = 0; i < 5; i++) score = score * 15 + (tie[i] || 0);
  return score;
}
export function evaluate(cards: Card[]): { score: number; name: string } {
  if (
    cards.length < 5 ||
    cards.length > 7 ||
    new Set(cards).size !== cards.length ||
    cards.some((c) => !deck52().includes(c))
  )
    throw new Error('无效的手牌');
  let best = -1;
  for (let a = 0; a < cards.length - 4; a++)
    for (let b = a + 1; b < cards.length - 3; b++)
      for (let c = b + 1; c < cards.length - 2; c++)
        for (let d = c + 1; d < cards.length - 1; d++)
          for (let e = d + 1; e < cards.length; e++)
            best = Math.max(
              best,
              scoreFive([cards[a], cards[b], cards[c], cards[d], cards[e]]),
            );
  return { score: best, name: rankNames[Math.floor(best / 15 ** 5)] };
}
export function createGame(
  n: number,
  mode: Mode = 'practice',
  stack = 2000,
): Game {
  if (!Number.isInteger(n) || n < 2 || n > 9) throw new Error('人数必须为 2–9');
  if (!Number.isInteger(stack) || stack < 40 || stack > 100000)
    throw new Error('初始筹码必须为 40–100000 的整数');
  const g: Game = {
    players: Array.from({ length: n }, (_, id) => ({
      id,
      name:
        id === 0
          ? '你'
          : `${mode === 'jev' ? 'Jev' : '练习对手'} ${String(id).padStart(2, '0')}`,
      stack,
      hole: [],
      status: 'active',
      bet: 0,
      total: 0,
      actedAt: null,
      lastAction: '',
    })),
    mode,
    hand: 0,
    button: n - 1,
    smallBlind: 10,
    bigBlind: 20,
    deck: [],
    board: [],
    street: 'complete',
    currentBet: 0,
    lastFullRaise: 20,
    actor: null,
    pending: [],
    log: [],
    revision: 0,
    pots: [],
    payouts: {},
    ranks: {},
    showdown: false,
    lastDecision: null,
    settledPot: 0,
  };
  return nextHand(g);
}
function nextSeat(
  g: Game,
  after: number,
  eligible: (p: Player) => boolean,
): number {
  for (let step = 1; step <= g.players.length; step++) {
    const id = (after + step) % g.players.length;
    if (eligible(g.players[id])) return id;
  }
  throw new Error('无可用座位');
}
function pay(p: Player, amount: number) {
  const value = Math.min(p.stack, amount);
  p.stack -= value;
  p.bet += value;
  p.total += value;
  if (p.stack === 0) p.status = 'allin';
  return value;
}
function addLog(g: Game, text: string) {
  g.log.push(text);
}
export function nextHand(g: Game): Game {
  if (g.street !== 'complete') throw new Error('请先完成当前牌局');
  if (
    g.players[0].stack <= 0 ||
    g.players.filter((p) => p.stack > 0).length < 2
  )
    throw new Error('本桌已结束，请开始新牌桌');
  g.hand++;
  g.revision++;
  g.button = nextSeat(g, g.button, (p) => p.stack > 0);
  g.deck = shuffled();
  g.board = [];
  g.street = 'preflop';
  g.currentBet = g.bigBlind;
  g.lastFullRaise = g.bigBlind;
  g.log = [];
  g.pots = [];
  g.payouts = {};
  g.ranks = {};
  g.showdown = false;
  g.lastDecision = null;
  g.settledPot = 0;
  for (const p of g.players) {
    p.hole = [];
    p.bet = 0;
    p.total = 0;
    p.actedAt = null;
    p.status = p.stack > 0 ? 'active' : 'out';
    p.lastAction = p.stack > 0 ? '等待行动' : '已出局';
  }
  const seated = g.players.filter((p) => p.status !== 'out');
  // Deal clockwise, one card per round, starting left of the button.
  for (let round = 0; round < 2; round++) {
    let seat = g.button;
    for (let i = 0; i < seated.length; i++) {
      seat = nextSeat(g, seat, (p) => p.status !== 'out');
      g.players[seat].hole.push(g.deck.pop()!);
    }
  }
  const sb =
    seated.length === 2
      ? g.button
      : nextSeat(g, g.button, (p) => p.status !== 'out');
  const bb = nextSeat(g, sb, (p) => p.status !== 'out');
  const sbPaid = pay(g.players[sb], g.smallBlind),
    bbPaid = pay(g.players[bb], g.bigBlind);
  g.players[sb].lastAction = `小盲 ${sbPaid}`;
  g.players[bb].lastAction = `大盲 ${bbPaid}`;
  addLog(g, `第 ${g.hand} 手 · ${g.players[g.button].name} 为庄家`);
  addLog(
    g,
    `${g.players[sb].name} 小盲 ${sbPaid} · ${g.players[bb].name} 大盲 ${bbPaid}`,
  );
  g.pending = g.players.filter((p) => p.status === 'active').map((p) => p.id);
  advance(g, bb);
  return g;
}
export function legalActions(g: Game, id = g.actor): Legal | null {
  if (id === null || g.street === 'complete' || id !== g.actor) return null;
  const p = g.players[id],
    owed = Math.max(0, g.currentBet - p.bet),
    max = p.bet + p.stack;
  const reopened =
    p.actedAt === null || g.currentBet - p.actedAt >= g.lastFullRaise;
  const canRaise =
    max > g.currentBet &&
    reopened &&
    g.players.some((other) => other.id !== id && other.status === 'active');
  return {
    fold: true,
    check: owed === 0,
    call: Math.min(owed, p.stack),
    minRaise: g.currentBet + g.lastFullRaise,
    maxRaise: max,
    canRaise,
    canAllIn: max <= g.currentBet || canRaise,
  };
}
export function applyAction(g: Game, action: Action, id = g.actor): Game {
  if (id === null || id !== g.actor || g.street === 'complete')
    throw new Error('还没轮到该玩家');
  const p = g.players[id],
    legal = legalActions(g)!;
  if (
    !action ||
    !['fold', 'check', 'call', 'raise', 'allin'].includes(action.type)
  )
    throw new Error('未知操作');
  let type = action.type,
    amount = action.amount;
  if (type === 'allin') {
    if (!legal.canAllIn) throw new Error('当前不能全下加注');
    if (legal.maxRaise <= g.currentBet) type = 'call';
    else {
      type = 'raise';
      amount = legal.maxRaise;
    }
  }
  let description = '';
  if (type === 'fold') {
    p.status = 'folded';
    description = '弃牌';
  } else if (type === 'check') {
    if (!legal.check) throw new Error('需要跟注，不能过牌');
    description = '过牌';
  } else if (type === 'call') {
    if (legal.call <= 0) throw new Error('无须跟注，请过牌');
    const paid = pay(p, legal.call);
    description = `${p.status === 'allin' ? '全下跟注' : '跟注'} ${paid}`;
  } else {
    if (
      !legal.canRaise ||
      !Number.isSafeInteger(amount) ||
      amount! > legal.maxRaise ||
      amount! <= g.currentBet ||
      (amount! < legal.minRaise && amount !== legal.maxRaise)
    )
      throw new Error('加注金额不合法');
    const increment = amount! - g.currentBet;
    pay(p, amount! - p.bet);
    g.currentBet = amount!;
    if (increment >= g.lastFullRaise) g.lastFullRaise = increment;
    g.pending = g.players
      .filter(
        (q) => q.status === 'active' && q.id !== id && q.bet < g.currentBet,
      )
      .map((q) => q.id);
    description = `${p.status === 'allin' ? '全下至' : '加注至'} ${amount}`;
  }
  p.actedAt = g.currentBet;
  p.lastAction = description;
  g.pending = g.pending.filter((x) => x !== id);
  g.revision++;
  addLog(g, `${p.name} ${description}`);
  advance(g, id);
  return g;
}
function advance(g: Game, after: number) {
  const alive = g.players.filter(
    (p) => p.status !== 'folded' && p.status !== 'out',
  );
  if (alive.length === 1) {
    settle(g, false);
    return;
  }
  g.pending = g.pending.filter((id) => g.players[id].status === 'active');
  const active = g.players.filter((p) => p.status === 'active');
  // No one can contest a bet when all the other live players are all-in.
  if (active.length === 1) {
    const contestable = Math.max(
      ...alive.filter((p) => p.id !== active[0].id).map((p) => p.bet),
    );
    g.currentBet = Math.min(g.currentBet, contestable);
    if (active[0].bet >= g.currentBet) g.pending = [];
  }
  if (g.pending.length) {
    g.actor = nextSeat(g, after, (p) => g.pending.includes(p.id));
    return;
  }
  if (g.street === 'river') {
    settle(g, true);
    return;
  }
  dealStreet(g);
}
function dealStreet(g: Game) {
  g.deck.pop(); // Burn one card before each public street.
  if (g.street === 'preflop') {
    g.street = 'flop';
    g.board.push(g.deck.pop()!, g.deck.pop()!, g.deck.pop()!);
  } else if (g.street === 'flop') {
    g.street = 'turn';
    g.board.push(g.deck.pop()!);
  } else {
    g.street = 'river';
    g.board.push(g.deck.pop()!);
  }
  addLog(g, `${streets[g.street]} · ${g.board.join(' ')}`);
  g.currentBet = 0;
  g.lastFullRaise = g.bigBlind;
  for (const p of g.players) {
    p.bet = 0;
    p.actedAt = null;
    if (p.status === 'active') p.lastAction = '等待行动';
  }
  g.pending = g.players.filter((p) => p.status === 'active').map((p) => p.id);
  if (g.pending.length < 2) g.pending = [];
  advance(g, g.button);
}
export function settle(g: Game, showdown: boolean) {
  const alive = g.players.filter(
    (p) => p.status !== 'folded' && p.status !== 'out',
  );
  const scores = new Map<number, number>();
  if (showdown)
    for (const p of alive) {
      const rank = evaluate([...p.hole, ...g.board]);
      scores.set(p.id, rank.score);
      g.ranks[p.id] = rank.name;
    }
  const levels = [
    ...new Set(g.players.map((p) => p.total).filter((n) => n > 0)),
  ].sort((a, b) => a - b);
  let previous = 0;
  g.settledPot = g.players.reduce((s, p) => s + p.total, 0);
  for (const level of levels) {
    const contributors = g.players.filter((p) => p.total >= level);
    const amount = (level - previous) * contributors.length;
    previous = level;
    const refund = contributors.length === 1;
    const eligible = refund
      ? contributors
      : alive.filter((p) => p.total >= level);
    if (!eligible.length) throw new Error('底池没有可获胜玩家');
    const best = Math.max(...eligible.map((p) => scores.get(p.id) || 0));
    const winners = eligible
      .filter((p) => (scores.get(p.id) || 0) === best)
      .sort(
        (a, b) =>
          ((a.id - g.button - 1 + g.players.length) % g.players.length) -
          ((b.id - g.button - 1 + g.players.length) % g.players.length),
      );
    g.pots.push({ amount, winners: winners.map((p) => p.id), refund });
    winners.forEach((p, i) => {
      const share =
        Math.floor(amount / winners.length) +
        (i < amount % winners.length ? 1 : 0);
      p.stack += share;
      if (!refund) g.payouts[p.id] = (g.payouts[p.id] || 0) + share;
    });
    addLog(
      g,
      refund
        ? `${winners[0].name} 收回未跟注筹码 ${amount}`
        : `${winners.map((p) => p.name).join('、')} ${winners.length > 1 ? '平分' : '赢得'}${g.pots.length === 1 ? '底池' : '边池'} ${amount}`,
    );
  }
  g.street = 'complete';
  g.actor = null;
  g.pending = [];
  g.showdown = showdown;
}
export function publicGame(g: Game): PublicGame {
  const {
    deck: _deck,
    pending: _pending,
    lastFullRaise: _last,
    players,
    ...rest
  } = g;
  return {
    ...structuredClone(rest),
    players: players.map(({ actedAt: _acted, hole, ...p }) => ({
      ...p,
      hole:
        p.id === 0 ||
        (g.showdown && p.status !== 'folded' && p.status !== 'out')
          ? [...hole]
          : hole.map(() => '??'),
    })),
    legal: legalActions(g),
    pot:
      g.street === 'complete'
        ? g.settledPot
        : g.players.reduce((s, p) => s + p.total, 0),
    sessionOver:
      g.players[0].stack <= 0 ||
      g.players.filter((p) => p.stack > 0).length < 2,
  };
}
// One seat's observation: no deck, no opponents' hole cards, no other AI confidences.
export function observation(g: Game, id: number) {
  const p = g.players[id];
  return {
    game: 'No-limit Texas Holdem, chip-only practice',
    seat: id,
    hand_number: g.hand,
    street: g.street,
    button: g.button,
    small_blind: g.smallBlind,
    big_blind: g.bigBlind,
    hole_cards: [...p.hole],
    community_cards: [...g.board],
    pot: g.players.reduce((s, q) => s + q.total, 0),
    current_bet: g.currentBet,
    legal: legalActions(g, id),
    players: g.players.map((q) => ({
      seat: q.id,
      stack: q.stack,
      status: q.status,
      street_contribution: q.bet,
      hand_contribution: q.total,
    })),
    history: [...g.log],
  };
}
export function actionChoices(
  g: Game,
): Record<string, { action: Action; description: string }> {
  const legal = legalActions(g);
  if (!legal) return {};
  const choices: Record<string, { action: Action; description: string }> = {
    fold: {
      action: { type: 'fold' },
      description: 'Fold and forfeit this hand.',
    },
  };
  if (legal.check)
    choices.check = {
      action: { type: 'check' },
      description: 'Check for free.',
    };
  else
    choices.call = {
      action: { type: 'call' },
      description: `Call ${legal.call} additional chips${g.players[g.actor!].stack === legal.call ? ' (all-in)' : ''}.`,
    };
  if (legal.canRaise) {
    const pot = g.players.reduce((s, p) => s + p.total, 0),
      seen = new Set<number>();
    for (const [name, total] of [
      ['raise_min', legal.minRaise],
      ['raise_half_pot', g.currentBet + Math.round((pot + legal.call) * 0.5)],
      ['raise_pot', g.currentBet + pot + legal.call],
    ] as const) {
      const amount = Math.max(legal.minRaise, Math.min(legal.maxRaise, total));
      if (amount >= legal.maxRaise || seen.has(amount)) continue;
      seen.add(amount);
      choices[name] = {
        action: { type: 'raise', amount },
        description: `Raise to ${amount} total chips on this street; pay ${amount - g.players[g.actor!].bet} additional chips.`,
      };
    }
  }
  if (legal.canAllIn && legal.maxRaise > g.currentBet)
    choices.all_in = {
      action: { type: 'allin' },
      description: `All-in, to ${legal.maxRaise} total chips this street.`,
    };
  return choices;
}
