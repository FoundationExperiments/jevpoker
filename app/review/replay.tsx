'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  Play,
  Pause,
  SkipForward,
  ChevronLeft,
  ChevronRight,
  Search,
  Info,
  AlertTriangle,
  Eye,
  RotateCcw,
} from 'lucide-react';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import type {
  ReplayIndex,
  ReplayHand,
  ReplaySummary,
  Finding,
} from '@/lib/replay/types';
const suits: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };
const streets: Record<string, string> = {
  preflop: '翻牌前',
  flop: '翻牌',
  turn: '转牌',
  river: '河牌',
  complete: '结算',
};
const status: Record<string, string> = {
  active: '在局',
  folded: '已弃牌',
  allin: '已全下',
  out: '离桌',
};
const money = (n: number) =>
  Number((n / 20).toFixed(2)).toLocaleString('en-US');
const signed = (n: number) => `${n > 0 ? '+' : ''}${Number(n.toFixed(2))}`;
const cardText = (xs: string[]) =>
  xs.map((c) => (c[0] === 'T' ? '10' : c[0]) + suits[c[1]]).join(' ');
const interesting = [
  'main-hu-random-8-s0',
  'main-diagnostic-royal_board-0',
  'main-diagnostic-quads_board-0',
];
function Card({
  card,
  hidden = false,
  small = false,
}: {
  card?: string;
  hidden?: boolean;
  small?: boolean;
}) {
  return (
    <span
      className={`replay-card ${small ? 'compact' : ''} ${hidden ? 'concealed' : ''} ${!card ? 'unfilled' : ''} ${card && 'hd'.includes(card[1]) ? 'red' : ''}`}
      aria-label={
        hidden ? '未知底牌' : card ? cardText([card]) : '尚未发出的公共牌'
      }
    >
      {hidden ? (
        <span>?</span>
      ) : card ? (
        <>
          <b>{card[0] === 'T' ? '10' : card[0]}</b>
          <span>{suits[card[1]]}</span>
        </>
      ) : (
        <span>·</span>
      )}
    </span>
  );
}
function Badge({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={`replay-badge ${tone}`}>{children}</span>;
}
function Issue({ finding }: { finding: Finding }) {
  return (
    <section className={`replay-issue ${finding.kind}`}>
      <div className="issue-heading">
        {finding.kind === 'review' ? (
          <Info size={18} />
        ) : (
          <AlertTriangle size={18} />
        )}
        <span>
          {finding.kind === 'certain'
            ? '确定错误'
            : finding.kind === 'estimated'
              ? '赔率问题 · 有范围假设'
              : '复核提示 · 尚未判错'}
        </span>
      </div>
      <h3>{finding.title}</h3>
      <p>{finding.detail}</p>
      {finding.lossBB !== undefined && (
        <div className="issue-loss">
          <b>
            {finding.kind === 'certain' ? '至少' : '估计'}{' '}
            {finding.lossBB.toFixed(2)} bb
          </b>
          <span>相对所建议动作的损失</span>
        </div>
      )}
      <p className="issue-advice">{finding.recommendation}</p>
      <small>{finding.source}</small>
    </section>
  );
}
function handTitle(h: ReplaySummary) {
  return h.kind === 'diagnostic'
    ? h.label
    : `${h.seats === 6 ? '六人桌' : '单挑'} · 第 ${String(h.number).padStart(3, '0')} 副 · 座位 ${h.jevSeat + 1}`;
}
export default function Replay({
  initialIndex,
  initialHand,
}: {
  initialIndex: ReplayIndex;
  initialHand: ReplayHand;
}) {
  const [index, setIndex] = useState<ReplayIndex | null>(initialIndex),
    [hand, setHand] = useState<ReplayHand | null>(initialHand),
    [selected, setSelected] = useState(initialHand.id),
    [step, setStep] = useState(
      initialHand.firstIssue >= 0
        ? initialHand.firstIssue
        : Math.max(
            0,
            initialHand.frames.findIndex((f) => f.decision),
          ),
    ),
    [playing, setPlaying] = useState(false),
    [reveal, setReveal] = useState(false),
    [error, setError] = useState('');
  const [query, setQuery] = useState(''),
    [source, setSource] = useState('main'),
    [baseline, setBaseline] = useState('all'),
    [problem, setProblem] = useState('all'),
    [order, setOrder] = useState('issues'),
    [page, setPage] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/replays/index.json', { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error('复盘目录暂时无法加载');
        return r.json() as Promise<ReplayIndex>;
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        setIndex(data);
        const id = new URLSearchParams(window.location.search).get('hand');
        setSelected(data.hands.some((h) => h.id === id) ? id! : interesting[0]);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    fetch(`/replays/hands/${encodeURIComponent(selected)}.json`, {
      signal: controller.signal,
    })
      .then((r) => {
        if (!r.ok) throw new Error('该手记录暂时无法加载');
        return r.json() as Promise<ReplayHand>;
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        setHand(data);
        const rawStep = new URLSearchParams(window.location.search).get('step');
        const urlStep = rawStep === null ? NaN : Number(rawStep);
        const initial =
          Number.isInteger(urlStep) && urlStep >= 0
            ? Math.min(urlStep, data.frames.length - 1)
            : data.firstIssue >= 0
              ? data.firstIssue
              : Math.max(
                  0,
                  data.frames.findIndex((f) => f.decision),
                );
        setStep(initial);
        setError('');
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [selected]);
  const ready = hand?.id === selected ? hand : null;
  const frame = ready?.frames[Math.min(step, ready.frames.length - 1)];
  useEffect(() => {
    if (!playing || !ready) return;
    const timer = setTimeout(() => {
      if (step >= ready.frames.length - 1) setPlaying(false);
      else setStep(step + 1);
    }, 1400);
    return () => clearTimeout(timer);
  }, [playing, ready, step]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        (e.target instanceof HTMLElement &&
          e.target.closest(
            'button,input,select,textarea,a,[role="slider"],[role="switch"]',
          ))
      )
        return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        setPlaying(false);
        setStep((s) =>
          Math.max(
            0,
            Math.min(
              (ready?.frames.length || 1) - 1,
              s + (e.key === 'ArrowRight' ? 1 : -1),
            ),
          ),
        );
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [ready]);
  const filtered = useMemo(() => {
    if (!index) return [];
    const text = query.toLowerCase().replaceAll(' ', '');
    return index.hands
      .filter(
        (h) =>
          (source === 'all' ||
            (source === 'diagnostic'
              ? h.kind === 'diagnostic'
              : h.run === source)) &&
          (baseline === 'all' || h.baseline === baseline) &&
          (problem === 'all' ||
            (problem === 'certain'
              ? h.issueCount > 0
              : problem === 'estimated'
                ? h.estimatedCount > 0
                : problem === 'unfinished'
                  ? !h.complete
                  : problem === 'loss'
                    ? (h.netBB ?? 0) < 0
                    : h.issueCount + h.estimatedCount > 0)) &&
          (!text ||
            `${h.id}${h.label}${h.hole.join('')}${cardText(h.hole)}${handTitle(h)}`
              .toLowerCase()
              .replaceAll(' ', '')
              .includes(text)),
      )
      .sort((a, b) =>
        order === 'loss'
          ? (a.netBB ?? Infinity) - (b.netBB ?? Infinity) ||
            a.id.localeCompare(b.id)
          : order === 'number'
            ? a.number - b.number || a.id.localeCompare(b.id)
            : b.issueCount * 100 +
                b.estimatedCount * 10 -
                (a.issueCount * 100 + a.estimatedCount * 10) ||
              a.number - b.number ||
              a.id.localeCompare(b.id),
      );
  }, [index, source, baseline, problem, query, order]);
  const actualPage = Math.min(
      page,
      Math.max(0, Math.ceil(filtered.length / 40) - 1),
    ),
    shown = filtered.slice(actualPage * 40, (actualPage + 1) * 40),
    position = filtered.findIndex((h) => h.id === selected);
  function choose(id: string, resetFilters = false) {
    setSelected(id);
    setStep(id === ready?.id && ready.firstIssue >= 0 ? ready.firstIssue : 0);
    if (!resetFilters) {
      const at = filtered.findIndex((h) => h.id === id);
      if (at >= 0) setPage(Math.floor(at / 40));
    }
    setPlaying(false);
    setError('');
    if (resetFilters) {
      setSource('main');
      setBaseline('all');
      setProblem('all');
      setQuery('');
      setPage(0);
    }
    window.history.replaceState(null, '', `?hand=${encodeURIComponent(id)}`);
  }
  function jump(n: number) {
    setPlaying(false);
    setStep(n);
    window.history.replaceState(
      null,
      '',
      `?hand=${encodeURIComponent(selected)}&step=${n}`,
    );
  }
  const issues =
    ready?.frames
      .map((f, i) => ({ f, i }))
      .filter(({ f }) => f.findings.some((x) => x.kind !== 'review')) || [];
  const currentIsJev = !!frame?.decision;
  const paid =
    frame?.action &&
    frame.seat !== undefined &&
    frame.snapshot.players[frame.seat]
      ? frame.action.type === 'call'
        ? frame.snapshot.legal?.call || 0
        : frame.action.type === 'raise'
          ? (frame.action.amount || 0) - frame.snapshot.players[frame.seat].bet
          : frame.action.type === 'allin'
            ? frame.snapshot.players[frame.seat].stack
            : 0
      : 0;
  const price = frame?.snapshot.legal?.call || 0;
  return (
    <main className="replay-app">
      <header className="replay-header">
        <Link className="brand" href="/review">
          <b>♠</b> jev<span>poker</span>
        </Link>
        <span className="replay-section-name">逐手复盘</span>
        <div className="replay-header-right">
          <span className="replay-muted">jev-1.13.0 · 2026.09.18</span>
          <Link href="/" className="replay-link">
            去牌桌 <ArrowRight size={16} />
          </Link>
        </div>
      </header>
      <div className="replay-intro">
        <div>
          <h1>Jev 的每一手牌</h1>
          <p>真实牌局记录。分析只使用行动时的信息，输牌本身不等于打错。</p>
        </div>
        <div className="replay-counts">
          <div>
            <b>{index?.validHands ?? '—'}</b>
            <span>有效对战手数</span>
          </div>
          <div>
            <b>{index?.hands.length ?? '—'}</b>
            <span>可回放记录</span>
          </div>
          <div>
            <b>
              {index
                ? index.findingCounts.certain + index.findingCounts.estimated
                : '—'}
            </b>
            <span>问题动作 · 含重复题</span>
          </div>
        </div>
      </div>
      {error && (
        <div className="replay-error" role="alert">
          {error}
          <button onClick={() => window.location.reload()}>重新加载</button>
        </div>
      )}
      <div className="replay-featured">
        <span>先看这几手</span>
        <button onClick={() => choose(interesting[0], true)}>
          98 bb 的不合算跟注 <ArrowRight size={14} />
        </button>
        <button onClick={() => choose(interesting[1], true)}>
          皇家同花顺公共牌，却弃牌 <ArrowRight size={14} />
        </button>
        <button onClick={() => choose(interesting[2], true)}>
          四条公共牌的误判 <ArrowRight size={14} />
        </button>
      </div>
      <div className="replay-workspace">
        <aside className="replay-browser" aria-label="选择牌局">
          <div className="replay-filter-head">
            <h2>
              牌局档案 <span>{filtered.length}</span>
            </h2>
            <button
              className="replay-icon-button"
              title="重置筛选"
              aria-label="重置筛选"
              onClick={() => {
                setQuery('');
                setSource('main');
                setBaseline('all');
                setProblem('all');
                setOrder('issues');
                setPage(0);
              }}
            >
              <RotateCcw size={16} />
            </button>
          </div>
          <label className="replay-search">
            <Search size={16} />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
              placeholder="搜牌号、底牌，如 9s8h"
              aria-label="搜索牌局"
            />
          </label>
          <div className="replay-filters">
            <NativeSelect
              aria-label="记录来源"
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                setPage(0);
              }}
            >
              <NativeSelectOption value="main">
                正式评测与诊断
              </NativeSelectOption>
              <NativeSelectOption value="pilot">试跑与诊断</NativeSelectOption>
              <NativeSelectOption value="diagnostic">
                全部诊断题
              </NativeSelectOption>
              <NativeSelectOption value="all">全部记录</NativeSelectOption>
            </NativeSelect>
            <NativeSelect
              aria-label="对手策略"
              value={baseline}
              onChange={(e) => {
                setBaseline(e.target.value);
                setPage(0);
              }}
            >
              <NativeSelectOption value="all">所有对手</NativeSelectOption>
              <NativeSelectOption value="mc56">MC56</NativeSelectOption>
              <NativeSelectOption value="random">随机策略</NativeSelectOption>
              <NativeSelectOption value="calling">
                只过牌 / 跟注
              </NativeSelectOption>
              <NativeSelectOption value="diagnostic">诊断题</NativeSelectOption>
            </NativeSelect>
            <NativeSelect
              aria-label="问题筛选"
              value={problem}
              onChange={(e) => {
                setProblem(e.target.value);
                setPage(0);
              }}
            >
              <NativeSelectOption value="all">全部局面</NativeSelectOption>
              <NativeSelectOption value="issues">已发现问题</NativeSelectOption>
              <NativeSelectOption value="certain">确定错误</NativeSelectOption>
              <NativeSelectOption value="estimated">
                赔率问题
              </NativeSelectOption>
              <NativeSelectOption value="loss">输钱的牌</NativeSelectOption>
              <NativeSelectOption value="unfinished">
                连接中断
              </NativeSelectOption>
            </NativeSelect>
            <NativeSelect
              aria-label="排序方式"
              value={order}
              onChange={(e) => {
                setOrder(e.target.value);
                setPage(0);
              }}
            >
              <NativeSelectOption value="issues">问题优先</NativeSelectOption>
              <NativeSelectOption value="number">按牌号</NativeSelectOption>
              <NativeSelectOption value="loss">亏损优先</NativeSelectOption>
            </NativeSelect>
          </div>
          <div className="replay-hand-list">
            {!index ? (
              <p className="replay-empty">正在读取评测记录…</p>
            ) : !shown.length ? (
              <p className="replay-empty">没有符合条件的牌局，试试调整筛选。</p>
            ) : (
              shown.map((h) => (
                <button
                  key={h.id}
                  aria-pressed={selected === h.id}
                  onClick={() => choose(h.id)}
                  className={`replay-hand-row ${selected === h.id ? 'selected' : ''}`}
                >
                  <span className="hand-row-top">
                    <b>
                      {h.kind === 'diagnostic'
                        ? '诊断题'
                        : `#${String(h.number).padStart(3, '0')} · ${h.seats} 人桌`}
                    </b>
                    <span
                      className={
                        (h.netBB ?? 0) < 0
                          ? 'negative'
                          : (h.netBB ?? 0) > 0
                            ? 'positive'
                            : 'replay-muted'
                      }
                    >
                      {!h.complete
                        ? '中断'
                        : h.netBB === null
                          ? '—'
                          : `${signed(h.netBB)} bb`}
                    </span>
                  </span>
                  <span className="hand-row-middle">
                    <span className="hand-mini-cards">
                      {h.hole.map((c) => (
                        <Card key={c} card={c} small />
                      ))}
                    </span>
                    <span>
                      {h.label}
                      <small>
                        {h.kind === 'match'
                          ? `Jev 座位 ${h.jevSeat + 1}`
                          : `重复 ${h.number}`}
                        {h.run === 'pilot' ? ' · 试跑' : ''}
                      </small>
                    </span>
                  </span>
                  <span className="hand-row-tags">
                    {h.issueCount > 0 && (
                      <Badge tone="danger">确定错误 {h.issueCount}</Badge>
                    )}
                    {h.estimatedCount > 0 && (
                      <Badge tone="warning">赔率问题 {h.estimatedCount}</Badge>
                    )}
                    {!h.issueCount && !h.estimatedCount && (
                      <span className="replay-muted">
                        {h.decisions} 次 Jev 决策
                      </span>
                    )}
                    {h.kind === 'match' && !h.included && (
                      <Badge>未计入统计</Badge>
                    )}
                  </span>
                </button>
              ))
            )}
          </div>
          <div className="replay-pagination">
            <button
              aria-label="上一页牌局"
              disabled={actualPage === 0}
              onClick={() => setPage(actualPage - 1)}
            >
              <ChevronLeft size={17} />
            </button>
            <span>
              {filtered.length ? actualPage + 1 : 0} /{' '}
              {Math.max(1, Math.ceil(filtered.length / 40))}
            </span>
            <button
              aria-label="下一页牌局"
              disabled={(actualPage + 1) * 40 >= filtered.length}
              onClick={() => setPage(actualPage + 1)}
            >
              <ChevronRight size={17} />
            </button>
          </div>
        </aside>
        <section className="replay-main" aria-label="牌局回放">
          {ready && frame ? (
            <>
              <div className="replay-hand-header">
                <div>
                  <div className="replay-eyebrow">
                    {ready.run === 'pilot' ? '试跑' : '正式评测'} /{' '}
                    {ready.kind === 'diagnostic' ? '诊断题' : ready.label}
                  </div>
                  <h2>{handTitle(ready)}</h2>
                </div>
                <div className="replay-hand-nav">
                  <button
                    className="replay-icon-button"
                    disabled={position <= 0}
                    aria-label="上一手"
                    title="上一手"
                    onClick={() => choose(filtered[position - 1].id)}
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <button
                    className="replay-icon-button"
                    disabled={position < 0 || position >= filtered.length - 1}
                    aria-label="下一手"
                    title="下一手"
                    onClick={() => choose(filtered[position + 1].id)}
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              </div>
              <div className="replay-table">
                <div className="replay-table-meta">
                  <Badge tone="teal">{streets[frame.snapshot.street]}</Badge>
                  <span>
                    {frame.kind === 'action'
                      ? '行动前局面'
                      : frame.kind === 'result'
                        ? '筹码已结算'
                        : '牌局状态'}{' '}
                    · 单位 bb
                  </span>
                </div>
                <div className="replay-seats">
                  {frame.snapshot.players
                    .filter((p) => p.id !== ready.jevSeat)
                    .map((p) => (
                      <div
                        key={p.id}
                        className={`replay-seat ${frame.snapshot.actor === p.id ? 'acting' : ''} ${p.status === 'folded' ? 'folded' : ''}`}
                      >
                        <div className="seat-name">
                          <b>座位 {p.id + 1}</b>
                          {p.id === frame.snapshot.button && (
                            <span title="庄家">D</span>
                          )}
                          <small>{status[p.status]}</small>
                        </div>
                        <div className="seat-cards">
                          {p.hole.map((c, i) => (
                            <Card key={i} card={c} hidden={!reveal} small />
                          ))}
                        </div>
                        <div className="seat-stack">
                          {money(p.stack)} <span>bb</span>
                        </div>
                        {p.bet > 0 && (
                          <div className="seat-bet">本轮 {money(p.bet)} bb</div>
                        )}
                      </div>
                    ))}
                </div>
                <div className="replay-board">
                  <span className="replay-pot-label">
                    {frame.kind === 'result' ? '结算底池' : '底池'}
                  </span>
                  <div className="replay-pot">
                    {money(frame.snapshot.pot)} <small>bb</small>
                  </div>
                  <div className="replay-community">
                    {Array.from({ length: 5 }, (_, i) => (
                      <Card key={i} card={frame.snapshot.board[i]} />
                    ))}
                  </div>
                </div>
                <div
                  className={`replay-hero ${frame.snapshot.actor === ready.jevSeat ? 'acting' : ''}`}
                >
                  <div>
                    <Badge tone="gold">Jev · 座位 {ready.jevSeat + 1}</Badge>
                    <div className="hero-cards">
                      {frame.snapshot.players[ready.jevSeat].hole.map((c) => (
                        <Card key={c} card={c} />
                      ))}
                    </div>
                  </div>
                  <div className="hero-details">
                    <strong>
                      {money(frame.snapshot.players[ready.jevSeat].stack)}{' '}
                      <small>bb</small>
                    </strong>
                    <span>
                      {frame.snapshot.rank || '两张底牌'} ·{' '}
                      {status[frame.snapshot.players[ready.jevSeat].status]}
                    </span>
                    <span>
                      本轮已投入{' '}
                      {money(frame.snapshot.players[ready.jevSeat].bet)} bb
                    </span>
                  </div>
                </div>
                <div className="replay-table-footer">
                  <label htmlFor="review-reveal">
                    <Eye size={16} />
                    <span>看对手底牌</span>
                    <Switch
                      id="review-reveal"
                      size="sm"
                      checked={reveal}
                      onCheckedChange={setReveal}
                      aria-label="显示对手底牌"
                    />
                  </label>
                  <span>
                    {reveal
                      ? '复盘视角；Jev 当时不知道这些牌'
                      : '当前按 Jev 当时的可见信息显示'}
                  </span>
                </div>
              </div>
              <div className="replay-transport">
                <div className="replay-current">
                  <span className={`event-dot ${currentIsJev ? 'jev' : ''}`} />
                  <strong>{frame.title}</strong>
                  <span>
                    {step + 1} / {ready.frames.length}
                  </span>
                </div>
                <Slider
                  value={[step]}
                  min={0}
                  max={Math.max(1, ready.frames.length - 1)}
                  step={1}
                  onValueChange={(v) => jump(Array.isArray(v) ? v[0] : v)}
                  aria-label="回放进度"
                />
                <div className="replay-transport-buttons">
                  <button
                    className="replay-control"
                    aria-label="上一步"
                    disabled={step === 0}
                    onClick={() => jump(Math.max(0, step - 1))}
                  >
                    <ArrowLeft size={17} />
                  </button>
                  <button
                    className="replay-control play"
                    onClick={() => {
                      if (step >= ready.frames.length - 1) setStep(0);
                      setPlaying(!playing);
                    }}
                  >
                    {playing ? <Pause size={17} /> : <Play size={17} />}{' '}
                    {playing ? '暂停' : '自动回放'}
                  </button>
                  <button
                    className="replay-control"
                    aria-label="下一步"
                    disabled={step >= ready.frames.length - 1}
                    onClick={() =>
                      jump(Math.min(ready.frames.length - 1, step + 1))
                    }
                  >
                    <ArrowRight size={17} />
                  </button>
                  <button
                    className="replay-control issue-jump"
                    disabled={!issues.length}
                    onClick={() =>
                      jump((issues.find(({ i }) => i > step) || issues[0]).i)
                    }
                  >
                    <SkipForward size={16} /> 跳到问题
                  </button>
                </div>
              </div>
              <div className="replay-timeline">
                <h3>
                  完整行动线 <span>点击任一步查看当时局面</span>
                </h3>
                {ready.frames.map((f, i) => (
                  <button
                    key={i}
                    className={`timeline-row ${step === i ? 'active' : ''} ${f.kind === 'deal' ? 'deal' : ''}`}
                    onClick={() => jump(i)}
                    aria-current={step === i ? 'step' : undefined}
                  >
                    <span className="timeline-number">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="timeline-street">
                      {streets[f.snapshot.street]}
                    </span>
                    <span className="timeline-title">{f.title}</span>
                    {f.findings.some((x) => x.kind === 'certain') ? (
                      <Badge tone="danger">错误</Badge>
                    ) : f.findings.some((x) => x.kind === 'estimated') ? (
                      <Badge tone="warning">赔率问题</Badge>
                    ) : f.decision ? (
                      <span className="timeline-model">JEV</span>
                    ) : null}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="replay-loading">
              <span>正在装入牌局…</span>
              <p>记录包含完整发牌和决策过程。</p>
            </div>
          )}
        </section>
        <aside className="replay-analysis" aria-label="决策分析">
          {ready && frame ? (
            <>
              <div className="analysis-heading">
                <h2>
                  {currentIsJev
                    ? 'Jev 决策分析'
                    : frame.kind === 'result'
                      ? '这一手的结果'
                      : '当前步骤'}
                </h2>
                {currentIsJev && (
                  <Badge>#{(frame.actionIndex ?? 0) + 1} 次行动</Badge>
                )}
              </div>
              {frame.kind === 'failure' ? (
                <div className="replay-issue review">
                  <h3>连接中断，未作决策</h3>
                  <p>{frame.error}</p>
                </div>
              ) : frame.kind === 'result' ? (
                <div className="replay-result">
                  <span>
                    {ready.kind === 'diagnostic'
                      ? '诊断题不计入对战收益'
                      : 'Jev 本手净收益'}
                  </span>
                  <strong
                    className={(ready.netBB ?? 0) < 0 ? 'negative' : 'positive'}
                  >
                    {ready.netBB === null ? '—' : `${signed(ready.netBB)} bb`}
                  </strong>
                  <p>
                    {issues.length
                      ? `本手有 ${issues.length} 个动作被定位到问题。点击行动线查看证据。`
                      : '没有检出本次规则能验证的错误。输赢不代表这一手所有动作都正确或错误。'}
                  </p>
                </div>
              ) : currentIsJev ? (
                <>
                  <div className="replay-decision">
                    <span>模型选择</span>
                    <strong>{frame.title.replace(/^Jev /, '')}</strong>
                    <div>
                      <span>
                        confidence{' '}
                        {(100 * (frame.decision?.confidence || 0)).toFixed(0)}%
                      </span>
                      <span>
                        {frame.latencyMs ?? frame.decision?.latencyMs} ms
                      </span>
                    </div>
                    <small>confidence 是选择置信度，不是手牌胜率。</small>
                  </div>
                  <div className="replay-odds">
                    <div>
                      <span>需跟注</span>
                      <b>{money(price)} bb</b>
                    </div>
                    <div>
                      <span>跟注保本权益</span>
                      <b>
                        {price
                          ? `${((price / (frame.snapshot.pot + price)) * 100).toFixed(1)}%`
                          : '可免费过牌'}
                      </b>
                    </div>
                    <div>
                      <span>本次投入</span>
                      <b>{money(paid)} bb</b>
                    </div>
                  </div>
                </>
              ) : (
                <p className="replay-analysis-note">
                  {frame.kind === 'deal'
                    ? '本步只展示新发出的公共牌。继续前进，查看下一次行动。'
                    : frame.kind === 'start'
                      ? '大小盲已投入。选择后面的 Jev 行动查看判断依据。'
                      : '这是基线对手的行动。下一次 Jev 决策会使用更新后的公开信息。'}
                </p>
              )}
              {frame.findings.map((finding, i) => (
                <Issue key={i} finding={finding} />
              ))}
              {currentIsJev && !frame.findings.length && (
                <div className="replay-no-issue">
                  <Info size={20} />
                  <div>
                    <b>未检出可验证的错误</b>
                    <p>
                      不代表此动作最优。这里没有专业求解器，不对每个下注给出虚构的评分。
                    </p>
                  </div>
                </div>
              )}
              {issues.length > 0 && (
                <div className="replay-hand-issues">
                  <h3>本手问题导航</h3>
                  {issues.map(({ f, i }) => (
                    <button key={i} onClick={() => jump(i)}>
                      <span>步骤 {i + 1}</span>
                      {f.findings.find((x) => x.kind !== 'review')?.title}
                      <ArrowRight size={14} />
                    </button>
                  ))}
                </div>
              )}
              {frame.probabilities && (
                <details className="replay-details">
                  <summary>模型返回的各动作概率</summary>
                  <p>
                    这是 API
                    的选择分布，不是扑克胜率，也不是建议按比例随机行动。
                  </p>
                  {Object.entries(frame.probabilities)
                    .sort((a, b) => b[1] - a[1])
                    .map(([label, value]) => (
                      <div className="probability-row" key={label}>
                        <span>{label}</span>
                        <span>{(value * 100).toFixed(0)}%</span>
                        <i style={{ width: `${value * 100}%` }} />
                      </div>
                    ))}
                </details>
              )}
              {frame.request !== undefined && (
                <details className="replay-details">
                  <summary>查看 Jev 当时的真实输入 / 输出</summary>
                  <p>记录未包含认证密钥。对手底牌不在 state 中。</p>
                  <h4>请求体</h4>
                  <pre>{JSON.stringify(frame.request, null, 2)}</pre>
                  <h4>返回结果</h4>
                  <pre>{JSON.stringify(frame.response, null, 2)}</pre>
                </details>
              )}
              {ready.kind === 'diagnostic' && (
                <p className="replay-source-note">{ready.diagnosticNote}</p>
              )}
              {ready.kind === 'match' && !ready.included && (
                <p className="replay-source-note">
                  此牌所在的交换座位组没有完整完成，整组不计入收益统计。
                </p>
              )}
              <p className="replay-source-note">
                问题说明是离线分析；Jev
                没有返回自然语言推理，不能据此声称知道模型“为什么这样想”。
              </p>
            </>
          ) : (
            <p className="replay-analysis-note">
              选择一手牌，查看每次决策和分析。
            </p>
          )}
        </aside>
      </div>
      <details className="replay-method">
        <summary>怎么看这些问题标注与评测结果</summary>
        <div>
          <h3>证据分三层</h3>
          <p>
            <b>确定错误：</b>
            免费过牌却弃牌，或穷举所有未知底牌后仍能证明弃牌损失收益。
          </p>
          <p>
            <b>赔率问题：</b>
            仅针对本实验动作与底牌无关的随机对手，估算全下跟注的权益与赔率；不会把随机范围套给
            MC56 或跟注策略。
          </p>
          <p>
            <b>复核提示：</b>
            大额投入只是值得查看，不自动等于错误。没有标注也不等于最优。
          </p>
          {index?.method.map((t) => (
            <p key={t}>{t}</p>
          ))}
          <h3>正式对战净收益 / 每 100 手</h3>
          <div className="replay-results-grid">
            {index?.conditions.map((c) => (
              <div key={c.condition}>
                <span>
                  {
                    {
                      hu_random: '单挑随机策略',
                      hu_calling: '单挑跟注策略',
                      hu_mc56: '单挑 MC56',
                      six_mc56: '六人桌 MC56',
                    }[c.condition]
                  }
                </span>
                <b>{signed(c.bbPer100)} bb</b>
                <small>
                  {c.hands} 手 · 95% 区间 {signed(c.ci95[0])} 至{' '}
                  {signed(c.ci95[1])}
                </small>
              </div>
            ))}
          </div>
          <p>
            这些是简单基线；样本区间跨零时，不能确定长期优劣。未评测专业求解器或人类等级。
          </p>
        </div>
      </details>
      <footer className="replay-footer">
        <span>Jev Poker · 评测日期 2026-09-18 · 纯历史回放，不调用模型</span>
        <a
          href="https://github.com/FoundationExperiments/jevpoker/blob/main/evaluations/2026-09-18/REPORT.md"
          target="_blank"
          rel="noreferrer"
        >
          原始评测报告 <ArrowRight size={14} />
        </a>
      </footer>
    </main>
  );
}
