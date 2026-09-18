# Jev Poker

本地网页德州扑克：2–9 人、1 位人类玩家，另外 n−1 位使用同一个 Jev 模型独立决策。无限注、每人 2,000 初始筹码、10/20 固定盲注。筹码仅用于模拟。

## 启动

需要 Node.js 22.18+（当前已用 Node 26 验证）。

```bash
cd ~/nworkspace/experimental/jevpoker
npm install
npm run dev
```

打开 **http://localhost:4318/**。已安装依赖时只需 `npm run dev`。服务仅绑定本机。

- 选择牌桌人数和决策模式，点击「入座开局」。
- 人类始终是「你」席位，手动弃牌、过牌、跟注、加注或全下；AI 自动逐位行动。
- 手结束后可继续下一手，筹码和庄家位置会延续。人类破产或只剩一名有筹码的玩家时，本桌结束。
- 「按当前设置开新桌」重置筹码。进行中的手不可修改桌子设置。
- 刷新网页能恢复同一浏览器的牌桌。不同浏览器会话独立。状态只在本地服务内存中；空闲超过 4 小时、服务重启或开发热更新可能清空。

## 注册并接入真正的 Jev

已核对官方文档（2026-09-18）：

1. 打开 [TypeSafe 控制台](https://console.typesafe.ai) 登录，在 dashboard 获取 API key。
2. 如果账号尚未获得访问权限，去 [TypeSafe 官网](https://typesafe.ai/) 点击 **Join Waitlist**。开通与额度以你的控制台为准。
3. 在项目目录执行：

```bash
cp .dev.vars.example .dev.vars
```

4. 用编辑器打开 `.dev.vars`，填写：

```dotenv
TYPESAFE_API_KEY=你的密钥
JEV_MODEL=jev-latest
TYPESAFE_BASE_URL=https://api.typesafe.ai
```

5. 重启 `npm run dev`，刷新网页。状态显示「API key 已配置」后，选择 **Jev · TypeSafe API** 并开桌。这里的「已配置」仅表示服务读取到了密钥，实际权限在首次决策时校验。

密钥只由服务端读取，`.dev.vars` 已被 Git 忽略，不使用 `NEXT_PUBLIC_` / `VITE_` 密钥变量，不会返回给网页。

**未提供有效 key 的当前交付状态：官方 HTTP 协议已经实现，并通过模拟传输测试；未进行真实 Jev 推理调用。** 本地练习可以立即玩，但它不是 Jev。真实 API 调用可能消耗账号额度。

官方来源：[Quick Start](https://docs.typesafe.ai/introduction/quickstart)、[TypeScript SDK](https://github.com/typesafe-ai/typesafe-sdk-js)。当前适配器按文档使用 `POST /v1/systemone`、Bearer 认证、`model: jev-latest`、`choice` 问题与 `answers.poker_action`。

## 两种对手

- **Jev**：由引擎生成合法候选操作（弃牌/过牌/跟注、最小加注、半底池加注、底池加注、全下），Jev 从候选项中选择。AI 加注额度采用这个离散集合；人类可输入合法整数金额。每次只请求当前行动席位。
- **本地练习**：56 次随机补牌估算权益，结合底池赔率和少量随机策略。用于无 key 试玩，不宣称达到专业德扑水平。

每个决策请求只包含该席位自己的两张底牌、公共牌、各方筹码、公开下注与历史；不包含其他玩家底牌、未发牌的牌堆或其他 AI 的置信度。网页仅接收人类底牌，在摊牌时公开未弃牌玩家的底牌。

Jev 请求超时、401/403/429、非法返回会暂停该手并显示错误。**不会悄悄切换练习算法，也不会替用户自动弃牌。** 点击「刷新牌局 / 重试」会恢复该行动点并重试。置信度是模型对动作判断的置信度，不是这手牌的胜率。

## 实现与验证

- `lib/poker/engine.ts`：服务端权威牌局，安全随机洗牌、烧牌、7 选 5 比牌、最小加注、短码全下后重新开注规则、多层边池、平局及零头筹码、单挑位置。
- `lib/poker/decisions.ts`：Jev 适配器与本地练习策略。
- `lib/poker/service.ts`：HttpOnly 会话、同源检查、版本校验与决策锁，避免重复点击或多个标签导致重复下注/模型调用。
- `app/page.tsx`：中文响应式牌桌和交互，支持键盘操作，尊重减少动画偏好。
- 使用 Sites 生成的 Vinext / React / Cloudflare 本地开发运行时。此项目未注册或部署到任何公开站点。

```bash
npm test
npm run lint
npm run typecheck
npm run build
# 开发服务已启动时，验证真实 HTTP 回合（只调用本地练习算法）
node scripts/http-smoke.mjs
```

测试覆盖所有牌型、A2345、小盲/大盲行动顺序、非法操作、全下边池、未跟注筹码返还、平分零头、短码与累计短码重新开注、隐藏信息、多个桌面人数的随机牌局筹码守恒、Jev 协议与失败暂停、会话隔离和并发重复请求。

尚未使用真实 key 测试 Jev 权限、推理延迟或打牌水平；模型表现不是扑克求解器质量保证。测试当前采用引擎、协议和 HTTP 级验证，未进行自动浏览器交互测试。

`npm run lint` 检查项目维护的 app、lib、tests、scripts 和配置文件；未修改的生成式 UI 组件保留上游代码。
