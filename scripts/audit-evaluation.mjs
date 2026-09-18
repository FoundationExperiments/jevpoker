import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { seededGame, diagnostics, verifyNutDiagnostic } from "./evaluate-lib.ts";
import { applyAction } from "../lib/poker/engine.ts";
import { jevRequest } from "../lib/poker/decisions.ts";

const out = resolve(process.argv[2]);
const json = (name) => JSON.parse(readFileSync(resolve(out, name + ".json"), "utf8"));
const lines = (name) =>
  readFileSync(resolve(out, name + ".jsonl"), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((s) => JSON.parse(s));
const summary = json("summary"),
  hands = lines("hands"),
  calls = lines("calls"),
  groups = lines("groups");
const successful = calls.filter((c) => c.ok),
  byAction = new Map(
    successful
      .filter((c) => c.kind === "match")
      .map((c) => [`${c.groupId}:${c.jevSeat}:${c.actionIndex}`, c]),
  );
let verifiedDecisions = 0;
for (const h of hands) {
  const g = seededGame(h.seats, h.seed);
  assert.deepEqual(h.initial, { holes: g.players.map((p) => p.hole), deck: g.deck });
  for (const [i, a] of h.actions.entries()) {
    assert.equal(g.actor, a.seat);
    if (a.decision) {
      const c = byAction.get(`${h.groupId}:${h.jevSeat}:${i}`);
      assert.ok(c, "missing API record");
      assert.deepEqual(
        c.request,
        jevRequest(g, summary.manifest.plan.model),
        "API sees precisely the production observation",
      );
      assert.equal(c.response.answers.poker_action.choice, a.decision.choice);
      assert.ok(c.request.state.players.every((p) => !("hole" in p)));
      assert.ok(!("deck" in c.request.state));
      verifiedDecisions++;
    }
    applyAction(g, a.action);
  }
  assert.equal(g.street, "complete");
  assert.deepEqual(
    g.players.map((p) => p.stack),
    h.endingStacks,
  );
  assert.deepEqual(g.board, h.board);
  assert.equal((g.players[h.jevSeat].stack - 2000) / 20, h.netBB);
  assert.equal(
    g.players.reduce((sum, p) => sum + p.stack, 0),
    2000 * h.seats,
  );
}
assert.ok(verifiedDecisions <= byAction.size);
for (const group of groups.filter((g) => g.ok)) {
  const members = hands.filter((h) => h.groupId === group.id);
  assert.equal(members.length, group.hands);
  assert.equal(new Set(members.map((h) => h.jevSeat)).size, group.hands);
  assert.equal(members.reduce((s, h) => s + h.netBB, 0) / group.hands, group.netBBPerHand);
  for (const h of members) assert.deepEqual(h.initial, members[0].initial);
}
for (const c of summary.conditions) {
  const ids = new Set(groups.filter((g) => g.ok && g.condition === c.condition).map((g) => g.id));
  const subset = hands.filter((h) => ids.has(h.groupId));
  assert.equal(subset.length, c.hands);
  assert.equal(
    subset.reduce((s, h) => s + h.netBB, 0),
    c.totalNetBB,
  );
  assert.ok(Math.abs(c.bbPer100 - (c.totalNetBB / c.hands) * 100) < 1e-8);
}
const hash = (p) =>
  createHash("sha256")
    .update(readFileSync(resolve(out, "source", p)))
    .digest("hex");
for (const [key, path] of Object.entries({
  engine: "lib/poker/engine.ts",
  decisionAdapter: "lib/poker/decisions.ts",
  harness: "scripts/evaluate.mjs",
  evaluationLib: "scripts/evaluate-lib.ts",
}))
  assert.equal(hash(path), summary.manifest.sourceHashes[key]);
const probes = diagnostics().map((d) => {
  const result = summary.diagnostics.filter((p) => p.id === d.id),
    wire = successful.filter((c) => c.probeId === d.id);
  for (const c of wire) assert.deepEqual(c.request, jevRequest(d.g, summary.manifest.plan.model));
  return {
    id: d.id,
    title: d.title,
    hole: d.g.players[0].hole,
    board: d.g.board,
    expected: d.expected,
    why: d.why,
    passed: result.filter((p) => p.pass).length,
    attempts: result.length,
    choices: result.map((p) => p.decision?.choice),
    confidence: result.map((p) => p.decision?.confidence),
    probabilities: wire.map((c) => c.response.answers.poker_action.probabilities),
    exhaustive: d.expected[0] === "call" ? verifyNutDiagnostic(d.g) : null,
  };
});
const streets = ["preflop", "flop", "turn", "river"].map((street) => {
  const ds = hands.flatMap((h) => h.actions.filter((a) => a.decision && a.street === street));
  return {
    street,
    decisions: ds.length,
    choices: Object.fromEntries(
      [...new Set(ds.map((a) => a.decision.choice))].map((k) => [
        k,
        ds.filter((a) => a.decision.choice === k).length,
      ]),
    ),
    freeChecks: ds.filter((a) => a.canCheck).length,
    freeFolds: ds.filter((a) => a.canCheck && a.action.type === "fold").length,
  };
});
const examples = [...hands]
  .sort((a, b) => a.netBB - b.netBB)
  .slice(0, 5)
  .map((h) => ({
    groupId: h.groupId,
    seat: h.jevSeat,
    netBB: h.netBB,
    hole: h.initial.holes[h.jevSeat],
    board: h.board,
    log: h.log,
    decisions: h.actions.filter((a) => a.decision),
  }));
const analysis = {
  auditedAt: new Date().toISOString(),
  checks: {
    handsReplayed: hands.length,
    productionRequestsMatched: verifiedDecisions,
    unfinishedHandRequests: byAction.size - verifiedDecisions,
    diagnosticRequestsMatched: successful.filter((c) => c.kind === "diagnostic").length,
    chipConservation: true,
    duplicateDeals: true,
    hiddenCardsExcluded: true,
    sourceHashesMatched: true,
  },
  probes,
  streets,
  examples,
  summary,
};
writeFileSync(resolve(out, "analysis.json"), JSON.stringify(analysis, null, 2));
console.log(
  JSON.stringify(
    {
      checks: analysis.checks,
      conditions: summary.conditions,
      probes: probes.map(({ probabilities: _probabilities, ...p }) => p),
      api: summary.api,
    },
    null,
    2,
  ),
);
