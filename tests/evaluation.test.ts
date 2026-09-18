import test from "node:test";
import assert from "node:assert/strict";
import {
  seededGame,
  finishBaseline,
  diagnostics,
  verifyNutDiagnostic,
  bootstrapMean,
} from "../scripts/evaluate-lib.ts";
import { actionChoices, applyAction, observation } from "../lib/poker/engine.ts";
void test("duplicate game has identical full deal, neutral public names, legal first actor", () => {
  const a = seededGame(6, 348),
    b = seededGame(6, 348);
  assert.deepEqual(a, b);
  assert.equal(new Set([...a.deck, ...a.players.flatMap((p) => p.hole)]).size, 52);
  assert.equal(a.actor, 3);
  assert.ok(a.log.every((x) => !x.includes("Jev")));
  assert.ok(observation(a, 3).players.every((x) => !("hole" in x)));
});
void test("baseline role rotation cancels exactly for the identical calling policy", () => {
  const g0 = finishBaseline(seededGame(2, 412), "calling", 91),
    g1 = finishBaseline(seededGame(2, 412), "calling", 91);
  assert.deepEqual(g0, g1);
  assert.equal(g0.players[0].stack - 2000 + g1.players[1].stack - 2000, 0);
});
void test("six-seat calling comparison conserves chips", () => {
  const g = finishBaseline(seededGame(6, 882), "calling", 3);
  assert.equal(
    g.players.reduce((s, p) => s + p.stack, 0),
    12000,
  );
});
void test("all nut/chop probes verified by exhaustive unseen opponent combinations", () => {
  for (const d of diagnostics().filter((d) => d.expected[0] === "call")) {
    assert.equal(verifyNutDiagnostic(d.g).lose, 0, d.id);
    assert.deepEqual(Object.keys(actionChoices(d.g)), ["fold", "call"]);
    applyAction(d.g, { type: "call" });
    assert.equal(d.g.street, "complete");
    assert.equal(
      d.g.players.reduce((s, p) => s + p.stack, 0),
      4000,
    );
  }
});
void test("constant cluster bootstrap has exact constant interval", () => {
  assert.deepEqual(bootstrapMean([2, 2, 2], 3, 100), { mean: 2, low: 2, high: 2 });
});
