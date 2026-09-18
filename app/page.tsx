'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Slider } from '@/components/ui/slider';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Action, Mode, PublicGame } from '@/lib/poker/engine';
const streetNames = {
  preflop: '翻牌前',
  flop: '翻牌',
  turn: '转牌',
  river: '河牌',
  complete: '本手结束',
};
const suits: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };
const numbers = (n: number) => n.toLocaleString('en-US');
function PlayingCard({
  card,
  small = false,
}: {
  card?: string;
  small?: boolean;
}) {
  const hidden = card === '??',
    empty = !card;
  return (
    <div
      className={`playing-card ${small ? 'small' : ''} ${hidden ? 'back' : ''} ${empty ? 'empty' : ''} ${card && ['h', 'd'].includes(card[1]) ? 'red' : ''}`}
      aria-label={
        empty
          ? '待发公共牌'
          : hidden
            ? '未公开的底牌'
            : `${card![0] === 'T' ? '10' : card![0]}${suits[card![1]]}`
      }
    >
      {hidden || empty ? (
        '♠'
      ) : (
        <>
          <span className="rank">{card![0] === 'T' ? '10' : card![0]}</span>
          <span className="suit">{suits[card![1]]}</span>
        </>
      )}
    </div>
  );
}
export default function Home() {
  const [game, setGame] = useState<PublicGame | null>(null),
    [seats, setSeats] = useState('6'),
    [mode, setMode] = useState<Mode>('practice');
  const [configured, setConfigured] = useState(false),
    [model, setModel] = useState('jev-latest'),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [help, setHelp] = useState(false),
    [raise, setRaise] = useState(40);
  const lock = useRef(false),
    mounted = useRef(true);
  const load = useCallback(async () => {
    try {
      const [statusRes, gameRes] = await Promise.all([
        fetch('/api/status'),
        fetch('/api/game'),
      ]);
      if (!statusRes.ok || !gameRes.ok) throw new Error('无法读取牌桌，请重试');
      const [status, saved] = await Promise.all([
        statusRes.json() as Promise<{ configured: boolean; model: string }>,
        gameRes.json() as Promise<{ game: PublicGame | null }>,
      ]);
      if (!mounted.current) return;
      setConfigured(status.configured);
      setModel(status.model);
      setGame(saved.game);
      if (saved.game?.legal)
        setRaise(
          Math.min(saved.game.legal.minRaise, saved.game.legal.maxRaise),
        );
      setError('');
      if (saved.game) {
        setSeats(String(saved.game.players.length));
        setMode(saved.game.mode);
      } else if (status.configured) setMode('jev');
      setReady(true);
    } catch (e) {
      if (mounted.current)
        setError(e instanceof Error ? e.message : '无法读取牌桌');
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const timer = setTimeout(() => void load(), 0);
    return () => {
      clearTimeout(timer);
      mounted.current = false;
    };
  }, [load]);
  const send = useCallback(
    async (command: string, extra: Record<string, unknown> = {}) => {
      if (lock.current) return;
      lock.current = true;
      setBusy(true);
      setError('');
      try {
        const response = await fetch('/api/game', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command, revision: game?.revision, ...extra }),
        });
        const result = (await response.json()) as {
          game: PublicGame;
          error?: string;
        };
        if (!response.ok) throw new Error(result.error || '操作失败，请重试');
        if (mounted.current) {
          setGame(result.game);
          if (result.game.legal)
            setRaise(
              Math.min(result.game.legal.minRaise, result.game.legal.maxRaise),
            );
        }
      } catch (e) {
        if (mounted.current)
          setError(e instanceof Error ? e.message : '无法连接本地服务');
      } finally {
        lock.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [game],
  );
  useEffect(() => {
    if (
      !ready ||
      !game ||
      game.street === 'complete' ||
      game.actor === 0 ||
      game.actor === null ||
      error
    )
      return;
    const timer = setTimeout(() => void send('step'), 650);
    return () => clearTimeout(timer);
  }, [ready, game, error, send]);
  const started = !!game,
    complete = game?.street === 'complete',
    humanTurn = game?.actor === 0 && !complete,
    legal = game?.legal;
  const displayedMode = game?.mode || mode,
    opponents = Number(seats) - 1;
  const canNew = !busy && ready && (!game || complete);
  const act = (action: Action) => void send('action', { action });
  const players =
    game?.players ||
    Array.from({ length: Number(seats) }, (_, id) => ({
      id,
      name:
        id === 0
          ? '你'
          : `${mode === 'jev' ? 'Jev' : '练习对手'} ${String(id).padStart(2, '0')}`,
      stack: 2000,
      hole: [],
      status: 'active',
      bet: 0,
      total: 0,
      lastAction: '',
    }));
  const winnerNames = game
    ? Object.keys(game.payouts)
        .map((id) => game.players[Number(id)].name)
        .join('、')
    : '';
  const displayedRaise = legal
    ? Math.max(
        Math.min(legal.minRaise, legal.maxRaise),
        Math.min(legal.maxRaise, raise),
      )
    : 40;
  const setPreset = (fraction: number) => {
    if (legal && game)
      setRaise(
        Math.min(
          legal.maxRaise,
          Math.max(
            legal.minRaise,
            game.currentBet + Math.round((game.pot + legal.call) * fraction),
          ),
        ),
      );
  };
  return (
    <main className="poker-app">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Jev Poker 主页">
          <b>♠</b> jev<span>poker</span>
        </Link>
        <Link href="/review" className="top-note">逐手复盘 ↗</Link>
        <span className={`mode-pill ${displayedMode === 'jev' ? 'live' : ''}`}>
          {displayedMode === 'jev' ? 'JEV 决策模式' : '本地练习 · 非 Jev'}
        </span>
      </header>
      <div className="workspace">
        <section className="game-area" aria-label="德扑牌桌">
          <div className="table-heading">
            <div>
              <span className="eyebrow">THE POKER ROOM</span>
              <h1>
                {!game
                  ? '坐下来，打一手。'
                  : complete
                    ? '好牌，下一手见。'
                    : humanTurn
                      ? '轮到你了。'
                      : `${game.players[game.actor!]?.name} 正在决策。`}
              </h1>
              {game && (
                <div className="hand-count">
                  HAND {String(game.hand).padStart(3, '0')} &nbsp; / &nbsp;{' '}
                  {streetNames[game.street]}
                </div>
              )}
            </div>
            <span className="blind-label">盲注 10 / 20</span>
          </div>
          <div className="table-stage">
            <div className="felt">
              <div className="felt-line" />
              <div className="board">
                <div className="pot-label">
                  {started ? '底池 · POT' : 'TEXAS HOLD’EM'}
                </div>
                {game && <div className="pot-amount">{numbers(game.pot)}</div>}
                <div className="board-cards">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <PlayingCard key={i} card={game?.board[i]} />
                  ))}
                </div>
                <div className="table-watermark">JEV POKER</div>
              </div>
            </div>
            {players.map((p, i) => {
              const angle = (i / players.length) * 2 * Math.PI;
              return (
                <div
                  key={p.id}
                  className={`seat ${i === 0 ? 'human' : ''} ${game?.actor === i ? 'active' : ''} ${p.status === 'folded' || p.status === 'out' ? 'folded' : ''} ${complete && game?.payouts[i] ? 'winner' : ''} ${Math.cos(angle) < -0.4 ? 'top-seat' : ''}`}
                  style={{
                    left: `${50 + 40 * Math.sin(angle)}%`,
                    top: `${50 + 39 * Math.cos(angle)}%`,
                  }}
                >
                  {p.hole.length > 0 && (
                    <div className="seat-cards">
                      {p.hole.map((c, j) => (
                        <PlayingCard key={j} card={c} small />
                      ))}
                    </div>
                  )}
                  <div className="seat-avatar">
                    {i === 0 ? '你' : String(i).padStart(2, '0')}
                  </div>
                  <div className="seat-name">{p.name}</div>
                  <div className="seat-stack">{numbers(p.stack)}</div>
                  <div className="seat-action">
                    {complete && game?.ranks[i]
                      ? game.ranks[i]
                      : p.status === 'out'
                        ? '已出局'
                        : p.lastAction || '准备就绪'}
                  </div>
                  {game?.button === i && (
                    <span className="dealer" title="庄家位置">
                      D
                    </span>
                  )}
                  {p.bet > 0 && !complete && (
                    <span className="seat-bet">● {numbers(p.bet)}</span>
                  )}
                </div>
              );
            })}
          </div>
          {error && (
            <div className="notice error-notice" role="alert">
              {error}
              <div className="action-buttons" style={{ marginTop: 10 }}>
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => {
                    void load();
                  }}
                >
                  刷新牌局 / 重试
                </button>
                {game?.mode === 'jev' && (
                  <button
                    className="secondary-button"
                    onClick={() => setHelp(true)}
                  >
                    接入说明
                  </button>
                )}
              </div>
            </div>
          )}
          <section
            className="action-panel"
            aria-label="玩家操作"
            aria-live="polite"
          >
            {!ready ? (
              <div className="muted">
                <span className="spinner-dot" />
                正在连接本地牌桌…
              </div>
            ) : !game ? (
              <>
                <div>
                  <strong>1 位玩家，{opponents} 位对手。</strong>
                  <div className="muted">每人 2,000 筹码，从第一手开始。</div>
                </div>
                <button
                  className="primary-button"
                  disabled={busy || (mode === 'jev' && !configured)}
                  onClick={() =>
                    void send('new', { seats: Number(seats), mode })
                  }
                >
                  {busy ? '准备中…' : '入座开局 →'}
                </button>
              </>
            ) : complete ? (
              <>
                <div className="result-box">
                  <h3>
                    {game.sessionOver
                      ? game.players[0].stack > 0
                        ? '你赢下了这桌。'
                        : '本桌结束。'
                      : `${winnerNames} 赢得本手`}
                  </h3>
                  <p>
                    {Object.entries(game.payouts)
                      .map(
                        ([id, amount]) =>
                          `${game.players[Number(id)].name} 收到 ${numbers(amount)} 筹码`,
                      )
                      .join(' · ')}
                  </p>
                </div>
                <button
                  className="primary-button"
                  disabled={busy}
                  onClick={() =>
                    game.sessionOver
                      ? void send('new', { seats: Number(seats), mode })
                      : void send('next')
                  }
                >
                  {game.sessionOver ? '重新开桌' : '下一手 →'}
                </button>
              </>
            ) : humanTurn && legal ? (
              <div className="action-stack">
                <div className="action-title">
                  <strong>你的回合</strong>
                  <span className="muted">
                    {legal.check
                      ? '可以免费过牌'
                      : `跟注需要 ${numbers(legal.call)} 筹码`}
                  </span>
                </div>
                {legal.canRaise && (
                  <div className="raise-row">
                    <label htmlFor="raise-amount" className="muted">
                      加注至
                    </label>
                    <input
                      id="raise-amount"
                      className="raise-input"
                      type="number"
                      min={Math.min(legal.minRaise, legal.maxRaise)}
                      max={legal.maxRaise}
                      step="1"
                      value={raise}
                      onChange={(e) =>
                        setRaise(Math.trunc(Number(e.target.value)))
                      }
                      disabled={busy}
                    />
                    <Slider
                      aria-label="加注总额"
                      value={[displayedRaise]}
                      min={Math.min(legal.minRaise, legal.maxRaise)}
                      max={legal.maxRaise}
                      step={1}
                      disabled={busy || legal.minRaise >= legal.maxRaise}
                      onValueChange={(v) =>
                        setRaise(Array.isArray(v) ? v[0] : v)
                      }
                    />
                    <div className="presets">
                      <button disabled={busy} onClick={() => setPreset(0.5)}>
                        ½ 底池
                      </button>
                      <button disabled={busy} onClick={() => setPreset(1)}>
                        底池
                      </button>
                    </div>
                  </div>
                )}
                <div className="action-buttons">
                  <button
                    className="danger-button"
                    disabled={busy}
                    onClick={() => act({ type: 'fold' })}
                  >
                    弃牌
                  </button>
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() =>
                      act({ type: legal.check ? 'check' : 'call' })
                    }
                  >
                    {legal.check ? '过牌' : `跟注 ${numbers(legal.call)}`}
                  </button>
                  {legal.canRaise && (
                    <button
                      className="primary-button"
                      disabled={busy}
                      onClick={() =>
                        act({ type: 'raise', amount: displayedRaise })
                      }
                    >
                      加注至 {numbers(displayedRaise)}
                    </button>
                  )}
                  {legal.canAllIn && legal.maxRaise > game.currentBet && (
                    <button
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => act({ type: 'allin' })}
                    >
                      全下
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div>
                <span className="spinner-dot" />
                <strong>{game.players[game.actor!]?.name} 正在决策…</strong>
                <div className="muted" style={{ marginTop: 5 }}>
                  {game.players[0].status === 'folded'
                    ? '你已弃牌，继续观看本手。'
                    : game.players[0].status === 'allin'
                      ? '你已全下，等待本手结果。'
                      : '等待对手行动，随后自动轮转。'}
                </div>
              </div>
            )}
          </section>
          {game && (
            <div className="session-info">
              <span>
                {game.players.filter((p) => p.status !== 'out').length} 人在桌 ·{' '}
                {game.showdown ? '摊牌' : '对手底牌保持隐藏'}
              </span>
              <span>
                你的筹码 {numbers(game.players[0].stack)} ·{' '}
                {game.players[0].stack - 2000 >= 0 ? '+' : ''}
                {numbers(game.players[0].stack - 2000)}
              </span>
            </div>
          )}
        </section>
        <aside className="sidebar">
          <section className="side-section">
            <span className="eyebrow">YOUR TABLE</span>
            <h2>牌桌设置</h2>
            <label className="field-label" htmlFor="seats">
              牌桌人数
            </label>
            <NativeSelect
              id="seats"
              value={seats}
              disabled={!canNew}
              onChange={(e) => setSeats(e.target.value)}
            >
              {[2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                <NativeSelectOption key={n} value={n}>
                  {n} 人 · 1 位玩家 + {n - 1} 位 AI
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <label className="field-label" htmlFor="mode">
              对手决策方式
            </label>
            <NativeSelect
              id="mode"
              value={mode}
              disabled={!canNew}
              onChange={(e) => setMode(e.target.value as Mode)}
            >
              <NativeSelectOption value="practice">
                本地练习对手
              </NativeSelectOption>
              <NativeSelectOption value="jev">
                Jev · TypeSafe API
              </NativeSelectOption>
            </NativeSelect>
            <p className="mode-description">
              {mode === 'practice'
                ? '使用本地蒙特卡洛策略，可以直接试玩。此模式不会调用 Jev。'
                : configured
                  ? '已配置 API key。每位对手将独立调用 Jev。'
                  : '尚未配置 API key，请先查看下方接入说明。'}
            </p>
            <div className="setting-row">
              <span>初始筹码</span>
              <strong>2,000</strong>
            </div>
            <div className="setting-row">
              <span>小盲 / 大盲</span>
              <strong>10 / 20</strong>
            </div>
            <button
              className="primary-button full-width"
              disabled={!canNew || (mode === 'jev' && !configured)}
              onClick={() => void send('new', { seats: Number(seats), mode })}
            >
              {started ? '按当前设置开新桌' : '入座开局 →'}
            </button>
            {started && !complete && (
              <p style={{ fontSize: 12 }}>完成本手后可调整设置、开始新牌桌。</p>
            )}
          </section>
          <section className="side-section">
            <h2>Jev 决策模型</h2>
            <p>
              {configured ? 'API key 已配置 · ' + model : 'API key 尚未配置'}
            </p>
            <button className="text-link" onClick={() => setHelp(true)}>
              接入 Jev ↗
            </button>
            <p>每位对手仅能看到自己的底牌与公开信息。</p>
            {game?.lastDecision && (
              <div className="decision-note">
                最近决策 · {game.players[game.lastDecision.player].name}
                <br />
                {game.lastDecision.source === 'jev'
                  ? `${game.lastDecision.model} · ${game.lastDecision.latencyMs} ms`
                  : '本地蒙特卡洛策略'}
                {game.lastDecision.source === 'jev' &&
                  game.lastDecision.confidence !== undefined && (
                    <>
                      <br />
                      决策置信度{' '}
                      {(game.lastDecision.confidence * 100).toFixed(0)}
                      %（不是胜率）
                    </>
                  )}
              </div>
            )}
          </section>
          <section className="side-section">
            <span className="eyebrow">HAND HISTORY</span>
            <h2>本手记录</h2>
            <div className="hand-log" aria-label="本手行动记录">
              {game?.log.length ? (
                game.log
                  .slice()
                  .reverse()
                  .map((line, i) => (
                    <div
                      className="log-line"
                      key={`${game.hand}-${game.log.length - i}`}
                    >
                      <span className="log-index">
                        {String(game.log.length - i).padStart(2, '0')}
                      </span>
                      <span>{line}</span>
                    </div>
                  ))
              ) : (
                <p className="empty-log">
                  入座后，发牌和下注记录将出现在这里。
                </p>
              )}
            </div>
          </section>
        </aside>
      </div>
      <footer>
        练习筹码 · 无现金交易<span>ONE HUMAN. EVERY DECISION COUNTS.</span>
      </footer>
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent className="sm:max-w-lg">
          <DialogTitle>接入 Jev</DialogTitle>
          <DialogDescription>
            密钥保存在本地服务端，不会发送到网页。
          </DialogDescription>
          <div className="setup-instructions">
            <ol>
              <li>
                前往{' '}
                <a
                  className="text-link"
                  href="https://console.typesafe.ai"
                  target="_blank"
                  rel="noreferrer"
                >
                  TypeSafe 控制台 ↗
                </a>{' '}
                登录并获取 API key。若暂无权限，可在{' '}
                <a
                  className="text-link"
                  href="https://typesafe.ai"
                  target="_blank"
                  rel="noreferrer"
                >
                  官网申请候补 ↗
                </a>
                。
              </li>
              <li>
                在项目目录将 <code>.dev.vars.example</code> 复制为{' '}
                <code>.dev.vars</code>，填入 <code>TYPESAFE_API_KEY</code>。
              </li>
              <li>
                重启本地服务，刷新页面，选择「Jev · TypeSafe API」后开桌。
              </li>
            </ol>
            <p>
              默认模型：<code>jev-latest</code>。调用失败会暂停牌局，可以重试。
            </p>
            <p>
              目前是本地内存牌桌：刷新可继续，服务重启或空闲超过 4 小时会清空。
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
