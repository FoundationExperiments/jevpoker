import assert from 'node:assert/strict';
const base = process.argv[2] || 'http://localhost:4318';
let cookie = '';
async function request(command, fields = {}) {
  const response = await fetch(`${base}/api/game`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base, cookie },
    body: JSON.stringify({ command, ...fields }),
  });
  if (response.headers.get('set-cookie'))
    cookie = response.headers.get('set-cookie').split(';')[0];
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  return data.game;
}
const page = await fetch(base);
assert.equal(page.status, 200);
const status = await (await fetch(`${base}/api/status`)).json();
assert.equal(typeof status.configured, 'boolean');
let actions = 0;
for (const seats of [2, 6, 9]) {
  let g = await request('new', { seats, mode: 'practice' });
  assert.equal(g.players.length, seats);
  assert.ok(!('deck' in g));
  for (let hand = 0; hand < 2; hand++) {
    let steps = 0;
    while (g.street !== 'complete') {
      if (g.actor === 0)
        g = await request('action', {
          revision: g.revision,
          action: { type: g.legal.check ? 'check' : 'call' },
        });
      else g = await request('step', { revision: g.revision });
      actions++;
      assert.ok(++steps < 200);
    }
    assert.equal(
      g.players.reduce((sum, p) => sum + p.stack, 0),
      seats * 2000,
    );
    const saved = await (
      await fetch(`${base}/api/game`, { headers: { cookie } })
    ).json();
    assert.deepEqual(saved.game, g);
    console.log(
      `${seats} seats, hand ${g.hand}: complete; chips conserved; refresh state retained`,
    );
    if (g.sessionOver) break;
    g = await request('next', { revision: g.revision });
  }
}
console.log(
  `HTTP smoke passed: ${actions} actions. Jev key configured: ${status.configured}. No real Jev calls made.`,
);
