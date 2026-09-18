import { applyAction, createGame, nextHand, publicGame } from './engine.ts';
import type { Game, Mode, Action } from './engine.ts';
import { jevDecision, practiceDecision, ModelError } from './decisions.ts';
import type { JevConfig } from './decisions.ts';
type Session = { game: Game; updated: number; busy: boolean };
export class GameService {
  private sessions = new Map<string, Session>();
  constructor(
    privateConfig: JevConfig = {},
    privateTransport: typeof fetch = fetch,
  ) {
    this.config = privateConfig;
    this.transport = privateTransport;
  }
  config: JevConfig;
  transport: typeof fetch;
  private cookieId(request: Request) {
    return request.headers
      .get('cookie')
      ?.split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith('jev_session='))
      ?.slice(12);
  }
  private json(body: unknown, status = 200, cookie?: string) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    };
    if (cookie)
      headers['Set-Cookie'] =
        `jev_session=${cookie}; Path=/; HttpOnly; SameSite=Strict; Max-Age=14400`;
    return new Response(JSON.stringify(body), { status, headers });
  }
  status() {
    return this.json({
      configured: !!this.config.apiKey?.trim(),
      model: this.config.model || 'jev-latest',
    });
  }
  async handle(request: Request): Promise<Response> {
    const cutoff = Date.now() - 14400000;
    for (const [id, session] of this.sessions)
      if (!session.busy && session.updated < cutoff) this.sessions.delete(id);
    const id = this.cookieId(request),
      session = id ? this.sessions.get(id) : undefined;
    if (request.method === 'GET') {
      if (session) session.updated = Date.now();
      return this.json({ game: session ? publicGame(session.game) : null });
    }
    if (request.method !== 'POST')
      return this.json({ error: '不支持的请求' }, 405);
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin)
      return this.json({ error: '仅支持同源请求' }, 403);
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      return this.json({ error: '需要 JSON 请求' }, 415);
    if (session?.busy) return this.json({ error: '对手正在决策，请稍候' }, 409);
    let body;
    try {
      const raw = await request.text();
      if (raw.length > 4096) return this.json({ error: '请求过大' }, 413);
      body = JSON.parse(raw);
    } catch {
      return this.json({ error: '无效的请求内容' }, 400);
    }
    if (!body || typeof body !== 'object')
      return this.json({ error: '无效的请求内容' }, 400);
    if (session?.busy) return this.json({ error: '对手正在决策，请稍候' }, 409);
    try {
      if (body.command === 'new') {
        if (body.mode !== 'practice' && body.mode !== 'jev')
          return this.json({ error: '未知的决策模式' }, 400);
        if (body.mode === 'jev' && !this.config.apiKey?.trim())
          return this.json(
            { error: '请先配置 TypeSafe API key，或选择本地练习模式。' },
            400,
          );
        if (this.sessions.size >= 100 && !session)
          return this.json({ error: '本地牌桌已满，请稍后重试' }, 429);
        const game = createGame(body.seats, body.mode as Mode),
          newId = id && session ? id : crypto.randomUUID();
        this.sessions.set(newId, { game, updated: Date.now(), busy: false });
        return this.json({ game: publicGame(game) }, 200, newId);
      }
      if (!session) return this.json({ error: '牌桌已过期，请重新开始' }, 404);
      if (body.revision !== session.game.revision)
        return this.json({ error: '牌局已更新，请刷新牌局后继续' }, 409);
      session.busy = true;
      session.updated = Date.now();
      try {
        const g = session.game;
        if (body.command === 'action') {
          if (g.actor !== 0) throw new Error('还没轮到你');
          applyAction(g, body.action as Action, 0);
        } else if (body.command === 'step') {
          if (g.actor === null || g.actor === 0)
            throw new Error('当前没有等待决策的 AI');
          const result =
            g.mode === 'jev'
              ? await jevDecision(g, this.config, this.transport)
              : practiceDecision(g);
          applyAction(g, result.action);
          g.lastDecision = result.decision;
        } else if (body.command === 'next') {
          nextHand(g);
        } else return this.json({ error: '未知指令' }, 400);
        return this.json({ game: publicGame(g) });
      } finally {
        session.busy = false;
      }
    } catch (error) {
      return this.json(
        { error: error instanceof Error ? error.message : '操作失败，请重试' },
        error instanceof ModelError ? 502 : 400,
      );
    }
  }
}
