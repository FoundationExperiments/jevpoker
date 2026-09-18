import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actionChoices,
  applyAction,
  createGame,
  evaluate,
  legalActions,
  nextHand,
  observation,
  publicGame,
  settle,
} from '../lib/poker/engine.ts';
import type { Game, PublicGame } from '../lib/poker/engine.ts';
import {
  jevDecision,
  jevRequest,
  practiceDecision,
} from '../lib/poker/decisions.ts';
import { GameService } from '../lib/poker/service.ts';
const cards = (s: string) => s.split(' ');
function rng(seed = 1349) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}
function fixture(stacks: number[]): Game {
  const g = createGame(stacks.length);
  g.street = 'flop';
  g.board = cards('2s 5h 9c');
  g.currentBet = 0;
  g.lastFullRaise = 20;
  g.actor = 0;
  g.pending = stacks.map((_, i) => i);
  g.players.forEach((p, i) => {
    p.stack = stacks[i];
    p.bet = 0;
    p.total = 0;
    p.status = 'active';
    p.actedAt = null;
  });
  return g;
}
void test('all hand categories and wheel ordering', () => {
  const examples = [
    'As Jd 9h 7s 3c',
    'As Ad 9h 7s 3c',
    'As Ad 9h 9s 3c',
    'As Ad Ah 7s 3c',
    'As 2d 3h 4s 5c',
    'As Js 9s 7s 3s',
    'As Ad Ah 7s 7c',
    'As Ad Ah Ac 3c',
    '9s Ts Js Qs Ks',
  ];
  const scores = examples.map((s) => evaluate(cards(s)).score);
  for (let i = 1; i < scores.length; i++) assert.ok(scores[i] > scores[i - 1]);
  assert.ok(
    evaluate(cards('2h 3c 4s 5d 6c')).score >
      evaluate(cards(examples[4])).score,
  );
  assert.equal(evaluate(cards('As Ad Ah 7s 7c 7d 3h')).name, '葫芦');
  assert.ok(
    evaluate(cards('As Ad Kh Qs Jc')).score >
      evaluate(cards('As Ad Kh Qs Tc')).score,
  );
  assert.throws(() => evaluate(cards('As As Kh Qs Jc')));
});
void test('heads-up button posts small blind, acts first preflop and last postflop', () => {
  const g = createGame(2);
  assert.equal(g.button, 0);
  assert.equal(g.players[0].bet, 10);
  assert.equal(g.players[1].bet, 20);
  assert.equal(g.actor, 0);
  applyAction(g, { type: 'call' });
  assert.equal(g.actor, 1);
  assert.equal(g.street, 'preflop');
  applyAction(g, { type: 'check' });
  assert.equal(g.street, 'flop');
  assert.equal(g.actor, 1);
});
void test('big blind has an option after everybody calls', () => {
  const g = createGame(6);
  for (let i = 0; i < 5; i++) applyAction(g, { type: 'call' });
  assert.equal(g.actor, 2);
  assert.equal(g.street, 'preflop');
  applyAction(g, { type: 'check' });
  assert.equal(g.street, 'flop');
});
void test('illegal check, fractional/under-minimum raise and wrong player cannot mutate state', () => {
  const g = createGame(6),
    before = structuredClone(g);
  for (const action of [
    { type: 'check' },
    { type: 'raise', amount: 21 },
    { type: 'raise', amount: 40.5 },
  ] as const)
    assert.throws(() => applyAction(g, action));
  assert.throws(() => applyAction(g, { type: 'fold' }, 0));
  assert.deepEqual(g, before);
});
void test('one short all-in does not reopen a prior full bet', () => {
  const g = fixture([1000, 1000, 150]);
  applyAction(g, { type: 'raise', amount: 100 });
  applyAction(g, { type: 'call' });
  applyAction(g, { type: 'allin' });
  assert.equal(g.actor, 0);
  assert.equal(legalActions(g)?.call, 50);
  assert.equal(legalActions(g)?.canRaise, false);
  assert.equal(legalActions(g)?.canAllIn, false);
  assert.throws(() => applyAction(g, { type: 'raise', amount: 250 }));
  applyAction(g, { type: 'call' });
  applyAction(g, { type: 'call' });
  assert.equal(g.street, 'turn');
});
void test('cumulative short all-ins reopen action after one full raise increment', () => {
  const g = fixture([1000, 1000, 150, 200]);
  applyAction(g, { type: 'raise', amount: 100 });
  applyAction(g, { type: 'call' });
  applyAction(g, { type: 'allin' });
  applyAction(g, { type: 'allin' });
  assert.equal(g.actor, 0);
  assert.equal(legalActions(g)?.canRaise, true);
  assert.equal(legalActions(g)?.minRaise, 300);
});
void test('all-ins run out board and return unmatched excess chips', () => {
  const g = createGame(2);
  g.players[0].stack = 1990;
  g.players[1].stack = 80;
  applyAction(g, { type: 'allin' });
  applyAction(g, { type: 'call' });
  assert.equal(g.street, 'complete');
  assert.equal(g.board.length, 5);
  assert.equal(
    g.players.reduce((s, p) => s + p.stack, 0),
    2100,
  );
  assert.equal(g.pots.find((p) => p.refund)?.amount, 1900);
});
void test('multiway side pots pay eligible winners and refund unmatched wager', () => {
  const g = fixture([0, 0, 0]);
  g.board = cards('2s 4h 7d 9c Js');
  g.players[0].hole = cards('Ah Ad');
  g.players[1].hole = cards('Kh Kd');
  g.players[2].hole = cards('Qh Qd');
  g.players.forEach((p, i) => {
    p.total = [100, 200, 300][i];
    p.status = 'allin';
  });
  settle(g, true);
  assert.deepEqual(
    g.players.map((p) => p.stack),
    [300, 200, 100],
  );
  assert.deepEqual(
    g.pots.map((p) => p.amount),
    [300, 200, 100],
  );
  assert.equal(g.pots[2].refund, true);
});
void test('ties include folded contributions and assign odd chip clockwise from button', () => {
  const g = fixture([0, 0, 0]);
  g.board = cards('Ah Kh Qh Jh Th');
  g.button = 0;
  g.players.forEach((p, i) => {
    p.total = 5;
    p.status = i === 2 ? 'folded' : 'allin';
    p.hole = [
      ['2s', '3s'],
      ['4s', '5s'],
      ['6s', '7s'],
    ][i];
  });
  settle(g, true);
  assert.deepEqual(
    g.players.map((p) => p.stack),
    [7, 8, 0],
  );
  assert.deepEqual(g.pots[0].winners, [1, 0]);
});
void test('human view and each Jev request exclude hidden cards, deck and private metadata', () => {
  const g = createGame(6),
    visible = publicGame(g);
  assert.ok(!('deck' in visible));
  assert.deepEqual(visible.players[1].hole, ['??', '??']);
  assert.deepEqual(visible.players[0].hole, g.players[0].hole);
  const obs = observation(g, g.actor!);
  assert.deepEqual(obs.hole_cards, g.players[g.actor!].hole);
  assert.ok(obs.players.every((p) => !('hole' in p)));
  assert.ok(!('deck' in obs));
  const request = jevRequest(g);
  assert.deepEqual(request.state, obs);
  assert.ok(Object.keys(request.questions.poker_action.criteria).length >= 2);
});
void test('folded hands remain concealed after showdown', () => {
  const g = createGame(6);
  applyAction(g, { type: 'fold' });
  while (g.street !== 'complete') {
    const l = legalActions(g)!;
    applyAction(g, { type: l.check ? 'check' : 'call' });
  }
  const visible = publicGame(g);
  assert.equal(g.showdown, true);
  assert.deepEqual(visible.players[3].hole, ['??', '??']);
  assert.deepEqual(visible.players[0].hole, g.players[0].hole);
  assert.ok(
    visible.players
      .filter((p) => p.status !== 'folded')
      .every((p) => p.hole.every((c) => c !== '??')),
  );
});
void test('hundreds of seeded random hands preserve chips, legal actors and termination for 2–9 seats', () => {
  const random = rng();
  let hands = 0;
  for (let n = 2; n <= 9; n++)
    for (let trial = 0; trial < 30; trial++) {
      const g = createGame(n);
      for (let hand = 0; hand < 3; hand++) {
        let steps = 0;
        while (g.street !== 'complete') {
          const legal = legalActions(g)!;
          assert.ok(legal);
          assert.equal(g.players[g.actor!].status, 'active');
          const choices = Object.values(actionChoices(g));
          const selected = choices[Math.floor(random() * choices.length)];
          applyAction(g, selected.action);
          const sum = g.players.reduce(
            (s, p) => s + p.stack + (g.street === 'complete' ? 0 : p.total),
            0,
          );
          assert.equal(sum, n * 2000);
          assert.ok(
            g.players.every((p) => p.stack >= 0 && Number.isInteger(p.stack)),
          );
          assert.ok(++steps < 300);
        }
        assert.equal(
          g.players.reduce((s, p) => s + p.stack, 0),
          n * 2000,
        );
        hands++;
        if (
          g.players[0].stack <= 0 ||
          g.players.filter((p) => p.stack > 0).length < 2
        )
          break;
        nextHand(g);
      }
    }
  assert.ok(hands >= 240);
});
void test('practice decisions only use legal actions', () => {
  const g = createGame(9);
  const result = practiceDecision(g, rng(), 8);
  applyAction(g, result.action);
  assert.equal(result.decision.source, 'practice');
});
void test('Jev wire protocol, authorization and legal typed answer', async () => {
  const g = createGame(6);
  const mock: typeof fetch = async (input, init) => {
    assert.equal(input, 'https://api.typesafe.ai/v1/systemone');
    const headers = init?.headers as Record<string, string> | undefined;
    assert.ok(headers);
    assert.equal(headers.Authorization, 'Bearer test-key');
    const req = JSON.parse(init?.body as string);
    assert.equal(req.model, 'jev-latest');
    assert.equal(req.questions.poker_action.type, 'choice');
    return Response.json({
      model: 'jev-test-version',
      answers: {
        poker_action: { type: 'choice', choice: 'call', confidence: 0.8 },
      },
    });
  };
  const result = await jevDecision(g, { apiKey: 'test-key' }, mock);
  assert.equal(result.decision.source, 'jev');
  assert.equal(result.action.type, 'call');
  assert.equal(result.decision.model, 'jev-test-version');
});
void test('Jev failures and illegal decisions do not become fake model actions', async () => {
  const g = createGame(3),
    before = structuredClone(g);
  await assert.rejects(() => jevDecision(g, {}), /API key/);
  await assert.rejects(
    () =>
      jevDecision(
        g,
        { apiKey: 'secret' },
        async () => new Response('', { status: 401 }),
      ),
    /API key 无效/,
  );
  await assert.rejects(
    () =>
      jevDecision(g, { apiKey: 'secret' }, async () =>
        Response.json({
          answers: {
            poker_action: { type: 'choice', choice: 'hack', confidence: 1 },
          },
        }),
      ),
    /不合法/,
  );
  await assert.rejects(
    () =>
      jevDecision(g, { apiKey: 'secret' }, async () => {
        throw new Error('secret');
      }),
    /无法连接/,
  );
  assert.deepEqual(g, before);
});
const post = (body: unknown, cookie = '') =>
  new Request('http://localhost:4318/api/game', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie,
      origin: 'http://localhost:4318',
    },
    body: JSON.stringify(body),
  });
void test('session API enforces model config, human turns, revisions, isolation and origin', async () => {
  const service = new GameService();
  assert.equal(
    (await service.handle(post({ command: 'new', seats: 6, mode: 'jev' })))
      .status,
    400,
  );
  const created = await service.handle(
    post({ command: 'new', seats: 6, mode: 'practice' }),
  );
  const cookie = created.headers.get('set-cookie')!.split(';')[0],
    { game } = (await created.json()) as { game: PublicGame };
  assert.equal(created.status, 200);
  assert.equal(
    (
      await service.handle(
        post(
          {
            command: 'action',
            revision: game.revision,
            action: { type: 'fold' },
          },
          cookie,
        ),
      )
    ).status,
    400,
  );
  assert.equal(
    (await service.handle(post({ command: 'step', revision: -1 }, cookie)))
      .status,
    409,
  );
  const step = await service.handle(
    post({ command: 'step', revision: game.revision }, cookie),
  );
  assert.equal(step.status, 200);
  assert.equal(
    ((await step.json()) as { game: PublicGame }).game.revision,
    game.revision + 1,
  );
  assert.equal(
    (
      (await (
        await service.handle(new Request('http://localhost:4318/api/game'))
      ).json()) as { game: PublicGame | null }
    ).game,
    null,
  );
  const hostile = post({ command: 'new', seats: 2, mode: 'practice' });
  hostile.headers.set('origin', 'https://elsewhere.example');
  assert.equal((await service.handle(hostile)).status, 403);
});
void test('API lock prevents duplicate model calls and failed decisions preserve the turn', async () => {
  let release!: () => void,
    calls = 0;
  const barrier = new Promise<void>((resolve) => (release = resolve));
  const service = new GameService({ apiKey: 'test' }, async () => {
    calls++;
    await barrier;
    return new Response('', { status: 429 });
  });
  const created = await service.handle(
    post({ command: 'new', seats: 6, mode: 'jev' }),
  );
  const cookie = created.headers.get('set-cookie')!.split(';')[0],
    { game } = (await created.json()) as { game: PublicGame };
  const pending = service.handle(
    post({ command: 'step', revision: game.revision }, cookie),
  );
  assert.equal(
    (
      await service.handle(
        post({ command: 'step', revision: game.revision }, cookie),
      )
    ).status,
    409,
  );
  release();
  assert.equal((await pending).status, 502);
  assert.equal(calls, 1);
  const saved = (await (
    await service.handle(
      new Request('http://localhost:4318/api/game', { headers: { cookie } }),
    )
  ).json()) as { game: PublicGame };
  assert.equal(saved.game.revision, game.revision);
  assert.equal(saved.game.actor, game.actor);
});

void test('heads-up short big blind does not force a fictitious call', () => {
  const g = createGame(2);
  g.street = 'complete';
  g.button = 1;
  g.players[0].stack = 100;
  g.players[1].stack = 5;
  nextHand(g);
  assert.equal(g.street, 'complete');
  assert.equal(g.board.length, 5);
  assert.equal(
    g.players.reduce((s, p) => s + p.stack, 0),
    105,
  );
  assert.equal(g.pots.find((p) => p.refund)?.amount, 5);
});
