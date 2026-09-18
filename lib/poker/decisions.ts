import { actionChoices, deck52, evaluate, observation } from './engine.ts';
import type { Action, Decision, Game } from './engine.ts';
export type JevConfig = {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
};
export type DecisionResult = { action: Action; decision: Decision };
export class ModelError extends Error {}
export function jevRequest(g: Game, model = 'jev-latest') {
  const choices = actionChoices(g);
  return {
    model,
    state: observation(g, g.actor!),
    questions: {
      poker_action: {
        type: 'choice',
        instructions:
          'You are the acting seat in a no-limit Texas Holdem hand. Which available action has the best expected chip value given your hole cards, the board, position, pot odds, effective stacks and public betting history? Opponent hole cards are unknown. Choose one action. All amounts and legal options are supplied; a raise total includes your chips already committed this street. The objective is to win chips over repeated hands, not to maximize the probability of winning this particular hand. Confidence is not poker equity.',
        criteria: Object.fromEntries(
          Object.entries(choices).map(([k, v]) => [k, v.description]),
        ),
      },
    },
  };
}
export async function jevDecision(
  g: Game,
  config: JevConfig,
  transport: typeof fetch = fetch,
): Promise<DecisionResult> {
  if (!config.apiKey?.trim())
    throw new ModelError(
      '尚未配置 TypeSafe API key。请按「接入 Jev」说明完成配置，再开始 Jev 牌桌。',
    );
  const choices = actionChoices(g),
    started = Date.now();
  let response: Response;
  try {
    response = await transport(
      `${(config.baseUrl || 'https://api.typesafe.ai').replace(/\/$/, '')}/v1/systemone`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey.trim()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(jevRequest(g, config.model || 'jev-latest')),
        signal: AbortSignal.timeout(config.timeoutMs || 15000),
      },
    );
  } catch {
    throw new ModelError('Jev 暂时无法连接或请求超时。本手已暂停，可以重试。');
  }
  if (!response.ok) {
    const messages: Record<number, string> = {
      401: 'API key 无效',
      403: '账号没有此模型的访问权限',
      402: '账号额度不足',
      429: '请求达到限流或额度限制',
    };
    throw new ModelError(
      `Jev：${messages[response.status] || `服务错误 (${response.status})`}。本手已暂停，修复后可重试。`,
    );
  }
  let data;
  try {
    data = (await response.json()) as {
      model?: string;
      answers?: {
        poker_action?: { type?: string; choice?: string; confidence?: number };
      };
    };
  } catch {
    throw new ModelError('Jev 返回的内容无法解析。本手已暂停。');
  }
  const answer = data?.answers?.poker_action,
    choice = answer?.choice;
  if (
    answer?.type !== 'choice' ||
    !choice ||
    !Object.hasOwn(choices, choice) ||
    typeof answer.confidence !== 'number' ||
    !Number.isFinite(answer.confidence) ||
    answer.confidence < 0 ||
    answer.confidence > 1
  )
    throw new ModelError('Jev 返回了不合法的决策。本手已暂停，可以重试。');
  return {
    action: choices[choice].action,
    decision: {
      player: g.actor!,
      source: 'jev',
      model: data.model || config.model || 'jev-latest',
      latencyMs: Date.now() - started,
      confidence: answer.confidence,
      choice,
    },
  };
}
// Lightweight Monte Carlo practice opponents. This is not the Jev model.
export function practiceDecision(
  g: Game,
  rng = Math.random,
  samples = 56,
): DecisionResult {
  const started = Date.now(),
    p = g.players[g.actor!],
    choices = actionChoices(g),
    legal = observation(g, p.id).legal!;
  const opponents = g.players.filter(
    (q) => q.id !== p.id && q.status !== 'folded' && q.status !== 'out',
  ).length;
  const known = new Set([...p.hole, ...g.board]),
    available = deck52().filter((c) => !known.has(c));
  let equity = 0;
  for (let trial = 0; trial < samples; trial++) {
    const deck = [...available];
    const draw = () => {
      const i = Math.floor(rng() * deck.length);
      return deck.splice(i, 1)[0];
    };
    const board = [...g.board];
    while (board.length < 5) board.push(draw());
    const ours = evaluate([...p.hole, ...board]).score;
    let ties = 1,
      beat = false;
    for (let i = 0; i < opponents; i++) {
      const score = evaluate([draw(), draw(), ...board]).score;
      if (score > ours) beat = true;
      if (score === ours) ties++;
    }
    if (!beat) equity += 1 / ties;
  }
  equity /= samples;
  const pot = g.players.reduce((s, q) => s + q.total, 0),
    odds = legal.call / (pot + legal.call || 1);
  let choice = legal.check ? 'check' : 'call';
  if (!legal.check && equity < odds + 0.025 && rng() > 0.08) choice = 'fold';
  const raises = Object.keys(choices).filter((k) => k.startsWith('raise'));
  if (
    raises.length &&
    (equity > Math.max(0.48, 1 / (opponents + 1) + 0.2) || rng() < 0.035) &&
    rng() < 0.7
  )
    choice = raises[Math.floor(rng() * raises.length)];
  if (choices.all_in && equity > 0.83 && rng() < 0.23) choice = 'all_in';
  return {
    action: choices[choice].action,
    decision: {
      player: p.id,
      source: 'practice',
      latencyMs: Date.now() - started,
      choice,
    },
  };
}
