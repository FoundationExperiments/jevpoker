import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  appendFileSync,
  existsSync,
  copyFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { applyAction, observation } from "../lib/poker/engine.ts";

import { jevDecision } from "../lib/poker/decisions.ts";
import {
  BASE_SEED,
  seeded,
  seededGame,
  baselineAction,
  diagnostics,
  bootstrapMean,
  mean,
  quantile,
} from "./evaluate-lib.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2),
  arg = (name, def) => {
    const at = args.indexOf(name);
    return at < 0 ? def : args[at + 1];
  };
const phase = arg("--phase", "pilot"),
  out = resolve(arg("--out", root + "/outputs/eval-" + phase));
if (!["pilot", "main"].includes(phase)) throw new Error("Use --phase pilot or main");
if (existsSync(out + "/manifest.json"))
  throw new Error("Output directory already contains a run; use a new --out path");
const keyFile = arg("--key-file", resolve(root, ".dev.vars"));
const key = readFileSync(keyFile, "utf8")
  .match(/^TYPESAFE_API_KEY[ \t]*=[ \t]*([^\r\n]+)/m)?.[1]
  ?.trim()
  .replace(/^['"]|['"]$/g, "");
if (!key) throw new Error("Missing TYPESAFE_API_KEY in local ignored configuration");
const model = "jev-1.13.0";
const plan = {
  phase,
  model,
  seed: BASE_SEED + (phase === "pilot" ? 100000 : 0),
  headsUpPairsPerBaseline: phase === "pilot" ? 5 : 100,
  sixSeatDecks: phase === "pilot" ? 2 : 20,
  diagnosticRepeats: phase === "pilot" ? 1 : 3,
  concurrency: 3,
  maximumCalls: 4000,
  maximumInputTokens: 5000000,
  startingStackBB: 100,
  blinds: [10, 20],
  retryLimit: 1,
  perRequestTimeoutMs: 20000,
};
mkdirSync(out, { recursive: true });
let sourceCommit = "unknown";
try {
  sourceCommit = execFileSync("git", ["-C", arg("--source-repo", root), "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
} catch {}
const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const manifest = {
  startedAt: new Date().toISOString(),
  plan,
  sourceCommit,
  sourceHashes: {
    engine: hash(root + "/lib/poker/engine.ts"),
    decisionAdapter: hash(root + "/lib/poker/decisions.ts"),
    harness: hash(fileURLToPath(import.meta.url)),
    evaluationLib: hash(root + "/scripts/evaluate-lib.ts"),
  },
  design:
    "Each hand resets to 100bb, no rake. HU: identical deck used twice, Jev and baseline swap seats. Six-max: one Jev vs five MC56, same deck repeated with Jev in every seat. Public seat names neutralized; production instructions/action mapping unchanged. Per-deck cluster bootstrap. Argmax choice, no mixing probabilities. Fixed sample plan, no outcome-based stopping.",
};
writeFileSync(out + "/manifest.json", JSON.stringify(manifest, null, 2));
for (const rel of [
  "scripts/evaluate.mjs",
  "scripts/evaluate-lib.ts",
  "lib/poker/engine.ts",
  "lib/poker/decisions.ts",
]) {
  const dest = resolve(out, "source", rel);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(resolve(root, rel), dest);
}
const allCalls = [],
  hands = [],
  groups = [],
  probes = [];
let inputTokens = 0,
  outputTokens = 0,
  nextCall = 0,
  finished = 0;
let lastStart = 0;
let chain = Promise.resolve();
async function throttle() {
  const next = chain.then(async () => {
    const delay = Math.max(0, lastStart + 180 - Date.now());
    if (delay) await new Promise((r) => setTimeout(r, delay));
    lastStart = Date.now();
  });
  chain = next;
  await next;
}
async function decide(g, context) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await throttle();
    if (nextCall >= plan.maximumCalls || inputTokens >= plan.maximumInputTokens)
      throw new Error("Evaluation budget cap reached");
    const id = ++nextCall,
      started = Date.now();
    const wire = {};
    const transport = async (url, init) => {
      wire.request = JSON.parse(init?.body);
      const response = await fetch(url, init);
      wire.status = response.status;
      if (response.ok) {
        const raw = await response.clone().json();
        wire.response = { model: raw.model, answers: raw.answers, usage: raw.usage };
        inputTokens += raw.usage?.input_tokens || 0;
        outputTokens += raw.usage?.output_tokens || 0;
      }
      return response;
    };
    try {
      const result = await jevDecision(
        g,
        { apiKey: key, model, timeoutMs: plan.perRequestTimeoutMs },
        transport,
      );
      if (result.decision.model !== model) throw new Error("Unexpected model version");
      const record = {
        id,
        ...context,
        attempt,
        ok: true,
        at: new Date().toISOString(),
        durationMs: Date.now() - started,
        ...wire,
        decision: result.decision,
      };
      allCalls.push(record);
      appendFileSync(out + "/calls.jsonl", JSON.stringify(record) + "\n");
      return result;
    } catch (error) {
      const record = {
        id,
        ...context,
        attempt,
        ok: false,
        at: new Date().toISOString(),
        durationMs: Date.now() - started,
        status: wire.status || null,
        error: error instanceof Error ? error.message : "Unknown decision failure",
      };
      allCalls.push(record);
      appendFileSync(out + "/calls.jsonl", JSON.stringify(record) + "\n");
      if (attempt === 1 || [400, 401, 402, 403, 404, 422].includes(wire.status)) throw error;
      await new Promise((r) => setTimeout(r, 1200));
    }
  }
  throw new Error("Unreachable");
}
async function hand(seats, seed, jevSeat, baseline, groupId) {
  const g = seededGame(seats, seed),
    initial = { holes: g.players.map((p) => [...p.hole]), deck: [...g.deck] },
    rngs = g.players.map((p) => seeded(seed + 7919 * p.id));
  const actions = [];
  while (g.street !== "complete") {
    const seat = g.actor,
      street = g.street,
      legal = observation(g, seat).legal;
    const before = {
      seat,
      street,
      bet: g.currentBet,
      pot: g.players.reduce((s, p) => s + p.total, 0),
      canCheck: legal.check,
      toCall: legal.call,
      stack: g.players[seat].stack,
    };
    if (seat === jevSeat) {
      const result = await decide(g, {
        kind: "match",
        groupId,
        seed,
        seats,
        jevSeat,
        baseline,
        actionIndex: actions.length,
      });
      actions.push({ ...before, action: result.action, decision: result.decision });
      applyAction(g, result.action);
    } else {
      const action = baselineAction(g, baseline, rngs[seat]);
      actions.push({ ...before, action });
      applyAction(g, action);
    }
    if (actions.length > 200) throw new Error("Hand action cap reached");
  }
  if (g.players.reduce((s, p) => s + p.stack, 0) !== seats * 2000)
    throw new Error("Chip conservation failed");
  const record = {
    groupId,
    seed,
    seats,
    jevSeat,
    baseline,
    netBB: (g.players[jevSeat].stack - 2000) / 20,
    endingStacks: g.players.map((p) => p.stack),
    board: g.board,
    showdown: g.showdown,
    log: g.log,
    actions,
    initial,
  };
  hands.push(record);
  appendFileSync(out + "/hands.jsonl", JSON.stringify(record) + "\n");
  return record;
}
const tasks = [];
for (const baseline of ["random", "calling", "mc56"])
  for (let i = 0; i < plan.headsUpPairsPerBaseline; i++) {
    const seed = plan.seed + i,
      groupId = `hu-${baseline}-${i}`;
    tasks.push(async () => {
      const members = [];
      try {
        for (let seat = 0; seat < 2; seat++)
          members.push(await hand(2, seed, seat, baseline, groupId));
        const record = {
          id: groupId,
          condition: `hu_${baseline}`,
          seed,
          hands: 2,
          netBBPerHand: mean(members.map((h) => h.netBB)),
          ok: true,
        };
        groups.push(record);
        appendFileSync(out + "/groups.jsonl", JSON.stringify(record) + "\n");
      } catch (e) {
        const record = {
          id: groupId,
          condition: `hu_${baseline}`,
          seed,
          ok: false,
          error: e instanceof Error ? e.message : "failure",
        };
        groups.push(record);
        appendFileSync(out + "/groups.jsonl", JSON.stringify(record) + "\n");
      }
    });
  }
for (let i = 0; i < plan.sixSeatDecks; i++) {
  const seed = plan.seed + 20000 + i,
    groupId = `six-mc56-${i}`;
  tasks.push(async () => {
    const members = [];
    try {
      for (let seat = 0; seat < 6; seat++) members.push(await hand(6, seed, seat, "mc56", groupId));
      const record = {
        id: groupId,
        condition: "six_mc56",
        seed,
        hands: 6,
        netBBPerHand: mean(members.map((h) => h.netBB)),
        ok: true,
      };
      groups.push(record);
      appendFileSync(out + "/groups.jsonl", JSON.stringify(record) + "\n");
    } catch (e) {
      const record = {
        id: groupId,
        condition: "six_mc56",
        seed,
        ok: false,
        error: e instanceof Error ? e.message : "failure",
      };
      groups.push(record);
      appendFileSync(out + "/groups.jsonl", JSON.stringify(record) + "\n");
    }
  });
}
for (const d of diagnostics())
  for (let repeat = 0; repeat < plan.diagnosticRepeats; repeat++)
    tasks.push(async () => {
      try {
        const result = await decide(structuredClone(d.g), {
          kind: "diagnostic",
          probeId: d.id,
          repeat,
        });
        const record = {
          id: d.id,
          title: d.title,
          repeat,
          ok: true,
          pass: d.expected.includes(result.decision.choice),
          expected: d.expected,
          why: d.why,
          decision: result.decision,
        };
        probes.push(record);
        appendFileSync(out + "/diagnostics.jsonl", JSON.stringify(record) + "\n");
      } catch (e) {
        probes.push({
          id: d.id,
          repeat,
          ok: false,
          error: e instanceof Error ? e.message : "failure",
        });
      }
    });
function summarize() {
  const conditions = ["hu_random", "hu_calling", "hu_mc56", "six_mc56"].map((condition) => {
    const completed = groups.filter((g) => g.condition === condition && g.ok),
      ids = new Set(completed.map((g) => g.id));
    const included = hands.filter((h) => ids.has(h.groupId));
    const ci = completed.length ? bootstrapMean(completed.map((g) => g.netBBPerHand * 100)) : null;
    const decisions = included.flatMap((h) => h.actions.filter((a) => a.decision));
    const free = decisions.filter((a) => a.canCheck),
      aggressive = decisions.filter((a) => ["raise", "allin"].includes(a.action.type));
    return {
      condition,
      clusters: completed.length,
      hands: included.length,
      excludedGroups: groups.filter((g) => g.condition === condition && !g.ok).length,
      bbPer100: ci?.mean,
      ci95: ci ? [ci.low, ci.high] : null,
      totalNetBB: included.reduce((s, h) => s + h.netBB, 0),
      profitableHands: included.filter((h) => h.netBB > 0).length,
      losingHands: included.filter((h) => h.netBB < 0).length,
      decisionCount: decisions.length,
      freeCheckOpportunities: free.length,
      freeFolds: free.filter((a) => a.action.type === "fold").length,
      aggressiveActions: aggressive.length,
      foldActions: decisions.filter((a) => a.action.type === "fold").length,
      preflopVPIP:
        included.filter((h) =>
          h.actions.some(
            (a) =>
              a.decision &&
              a.street === "preflop" &&
              ["call", "raise", "allin"].includes(a.action.type),
          ),
        ).length / included.length,
    };
  });
  const successful = allCalls.filter((c) => c.ok),
    latencies = successful.map((c) => c.durationMs);
  return {
    manifest,
    finishedAt: new Date().toISOString(),
    conditions,
    api: {
      calls: allCalls.length,
      successful: successful.length,
      failed: allCalls.length - successful.length,
      inputTokens,
      outputTokens,
      estimatedInputCostUSD: (inputTokens * 42) / 1e9,
      costBasis: "Official displayed input price $42 / billion tokens; not an invoice.",
      latencyMs: latencies.length
        ? { p50: quantile(latencies, 0.5), p95: quantile(latencies, 0.95), mean: mean(latencies) }
        : null,
      models: [...new Set(successful.map((c) => c.decision.model))],
    },
    diagnostics: probes,
    completedHands: hands.length,
    completeGroups: groups.filter((g) => g.ok).length,
    failedGroups: groups.filter((g) => !g.ok),
    completedTasks: finished,
    totalTasks: tasks.length,
  };
}
let taskIndex = 0;
async function worker() {
  while (taskIndex < tasks.length) {
    const task = tasks[taskIndex++];
    await task();
    finished++;
    writeFileSync(
      out + "/progress.json",
      JSON.stringify({
        finished,
        total: tasks.length,
        calls: allCalls.length,
        inputTokens,
        failures: allCalls.filter((c) => !c.ok).length,
      }),
    );
    if (finished % 10 === 0 || finished === tasks.length)
      console.log(
        JSON.stringify({
          finished,
          total: tasks.length,
          calls: allCalls.length,
          inputTokens,
          failures: allCalls.filter((c) => !c.ok).length,
        }),
      );
    if (allCalls.filter((c) => !c.ok).length >= 20)
      throw new Error("Too many API failures; stopping evaluation");
  }
}
try {
  await Promise.all(Array.from({ length: plan.concurrency }, worker));
} finally {
  writeFileSync(out + "/summary.json", JSON.stringify(summarize(), null, 2));
}
console.log(JSON.stringify({ phase, output: out, ...summarize().api }));
