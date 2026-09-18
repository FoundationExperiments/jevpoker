import type { Metadata } from 'next';
import Replay from './replay';
import index from '@/public/replays/index.json';
import firstHand from '@/public/replays/hands/main-hu-random-8-s0.json';
import type { ReplayIndex, ReplayHand } from '@/lib/replay/types';
import './review.css';
export const metadata: Metadata = {
  title: 'Jev Poker · 逐手复盘',
  description:
    '逐步回放 Jev 的真实德扑评测，查看底牌、公共牌、每次决策与有证据的问题分析。',
};
export default function ReviewPage() {
  return (
    <Replay
      key={index.generatedAt}
      initialIndex={index as ReplayIndex}
      initialHand={firstHand as ReplayHand}
    />
  );
}
