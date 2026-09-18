import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Jev Poker · 与决策模型打一桌德扑',
  description: '2–9 人无限注德州扑克。1 位玩家手动决策，其余席位由 Jev 驱动。',
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" className="dark">
      <body>{children}</body>
    </html>
  );
}
