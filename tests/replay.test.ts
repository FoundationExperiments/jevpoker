import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { diagnostics, seededGame } from '../scripts/evaluate-lib.ts';
import { analyze, randomEquity } from '../lib/replay/analyze.ts';
import type { ReplayHand, ReplayIndex } from '../lib/replay/types.ts';
const base = resolve('public/replays');
const index = JSON.parse(
  readFileSync(resolve(base, 'index.json'), 'utf8'),
) as ReplayIndex;
const hands = index.hands.map(
  (h) =>
    JSON.parse(
      readFileSync(resolve(base, 'hands', h.id + '.json'), 'utf8'),
    ) as ReplayHand,
);
void test('all recorded matches and diagnoses are available, including interrupted and excluded hands', () => {
  assert.equal(new Set(index.hands.map((h) => h.id)).size, 790);
  assert.equal(
    hands.filter((h) => h.run === 'main' && h.kind === 'match').length,
    716,
  );
  assert.equal(
    hands.filter((h) => h.run === 'main' && h.kind === 'match' && h.included)
      .length,
    708,
  );
  assert.equal(hands.filter((h) => !h.complete).length, 6);
  assert.equal(hands.filter((h) => h.kind === 'diagnostic').length, 32);
  assert.equal(
    hands.filter((h) => h.kind === 'match' && h.run === 'pilot').length,
    42,
  );
  for (const h of hands)
    assert.equal(
      h.frames.at(-1)?.kind,
      h.complete ? 'result' : 'failure',
      h.id,
    );
});
void test('every frame preserves chips and reveals public cards monotonically, including all-in runouts', () => {
  for (const h of hands) {
    let last = 0;
    for (const f of h.frames) {
      const s = f.snapshot;
      assert.ok([0, 3, 4, 5].includes(s.board.length));
      assert.ok(s.board.length >= last, h.id);
      last = s.board.length;
      assert.deepEqual(s.board, h.board.slice(0, s.board.length));
      assert.deepEqual(s.players[h.jevSeat].hole, h.hole);
      const cards = [...s.board, ...s.players.flatMap((p) => p.hole)];
      assert.equal(new Set(cards).size, cards.length, h.id);
      assert.equal(
        s.players.reduce((sum, p) => sum + p.stack, 0) +
          (f.kind === 'result' ? 0 : s.pot),
        h.seats * 2000,
        `${h.id}: ${f.title}`,
      );
    }
  }
});
void test('published original model requests contain current information only and no secret or opponent cards', () => {
  let matched = 0;
  for (const h of hands)
    for (const f of h.frames) {
      assert.ok(!JSON.stringify(f).includes('apikey_'));
      if (!f.request) continue;
      const request = f.request as {
        state: {
          community_cards: string[];
          hole_cards: string[];
          players: Record<string, unknown>[];
          deck?: unknown;
        };
        questions: unknown;
      };
      assert.deepEqual(request.state.community_cards, f.snapshot.board);
      assert.deepEqual(request.state.hole_cards, h.hole);
      assert.ok(!('deck' in request.state));
      assert.ok(
        request.state.players.every(
          (p) => !('hole' in p) && !('hole_cards' in p),
        ),
      );
      matched++;
    }
  assert.equal(matched, 2565);
});
void test('highlighted all-in error is evaluated before future cards and each later street can be replayed', () => {
  const h = hands.find((h) => h.id === 'main-hu-random-8-s0')!;
  const f = h.frames.find((f) =>
    f.findings.some((x) => x.kind === 'estimated'),
  )!;
  assert.deepEqual(f.snapshot.board, ['3c', 'Td', '2s']);
  const finding = f.findings.find((x) => x.kind === 'estimated')!;
  assert.equal(finding.requiredEquity, 0.49);
  assert.ok(finding.equity! > 0.29 && finding.equity! < 0.32);
  assert.ok(finding.lossBB! > 34 && finding.lossBB! < 40);
  assert.deepEqual(
    h.frames
      .filter((f) => f.kind === 'deal')
      .map((f) => f.snapshot.board.length),
    [3, 4, 5],
  );
});
void test('certain diagnosis catches forced chops and never uses actual opponent cards or the deck', () => {
  const d = diagnostics().find((d) => d.id === 'royal_board')!;
  const expected = analyze(d.g, { type: 'fold' }, 'diagnostic', 123);
  assert.equal(expected[0].kind, 'certain');
  assert.equal(expected[0].lossBB, 5);
  const changed = structuredClone(d.g);
  changed.players[1].hole = ['7c', '8d'];
  changed.deck.reverse();
  assert.deepEqual(
    analyze(changed, { type: 'fold' }, 'diagnostic', 123),
    expected,
  );
  assert.ok(
    analyze(d.g, { type: 'call' }, 'diagnostic', 123).every(
      (f) => f.kind === 'review',
    ),
  );
  const g = seededGame(2, 817),
    copy = structuredClone(g);
  copy.players[1].hole = ['4c', '6s'];
  copy.deck.reverse();
  assert.deepEqual(randomEquity(g, 827, 256), randomEquity(copy, 827, 256));
});
