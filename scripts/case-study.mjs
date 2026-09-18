import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { seeded, seededGame } from "./evaluate-lib.ts";
import { applyAction, observation, deck52, evaluate } from "../lib/poker/engine.ts";

const out = resolve(process.argv[2]);
const hands = readFileSync(resolve(out, "hands.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((s) => JSON.parse(s));
// Post-hoc illustrative case, selected from the recorded losses. This is not
// an additional independent tournament sample or a solver assessment.
const hand = hands.find((h) => h.groupId === "hu-random-8" && h.jevSeat === 0);
if (!hand) throw new Error("This case is specific to the 2026-09-18 main run");
const g = seededGame(hand.seats, hand.seed);
for (const a of hand.actions) {
  if (a.decision && a.street === "flop" && a.action.type === "call" && a.toCall === 1960) break;
  applyAction(g, a.action);
}
if (g.street !== "flop" || g.actor !== 0) throw new Error("Expected action not found");
const state = observation(g, 0),
  hero = g.players[0].hole,
  known = [...hero, ...g.board];
const unseen = deck52().filter((c) => !known.includes(c));
const random = seeded(81920918),
  samples = 200000;
let sum = 0,
  sumSquares = 0;
for (let i = 0; i < samples; i++) {
  const remaining = [...unseen];
  const draw = () => remaining.splice(Math.floor(random() * remaining.length), 1)[0];
  const opponent = [draw(), draw()],
    board = [...g.board, draw(), draw()];
  const h = evaluate([...hero, ...board]).score,
    o = evaluate([...opponent, ...board]).score;
  const payout = h > o ? 1 : h === o ? 0.5 : 0;
  sum += payout;
  sumSquares += payout * payout;
}
const equity = sum / samples,
  se = Math.sqrt((sumSquares / samples - equity * equity) / samples);
const pot = g.players.reduce((s, p) => s + p.total, 0),
  call = state.legal.call;
const result = {
  kind: "post-hoc illustrative error; not an independent performance sample",
  groupId: hand.groupId,
  seat: 0,
  hole: hero,
  board: g.board,
  callBB: call / 20,
  potBB: pot / 20,
  breakEvenEquity: call / (pot + call),
  samples,
  simulationSeed: 81920918,
  equity,
  equityMonteCarloCI95: [equity - 1.96 * se, equity + 1.96 * se],
  callEVRelativeToFoldBB: (equity * (pot + call) - call) / 20,
  modelAction: "call",
  rationale:
    "Against this known random-action baseline, actions do not depend on hole cards. Opponent range remains uniformly random. Equity uses hero hole cards and flop only; recorded opponent cards and actual turn/river are not used. Sampling interval describes simulation noise, not uncertainty about a human opponent range.",
};
writeFileSync(resolve(out, "case-study.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
