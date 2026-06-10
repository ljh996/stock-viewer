# stock-viewer 项目说明

## 项目架构总览

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              stock-viewer                                            │
│  Vue 3 + Vite (前端)  ←→  Express (后端代理)  ←→  第三方数据源                       │
│                              │                                                       │
│                     ┌────────▼────────┐                                              │
│                     │   缓存层        │                                              │
│                     │  Redis 6379     │  ✅ ioredis + 内存降级 (2026-06-03)          │
│                     │  或 内存 Map    │                                              │
│                     └────────┬────────┘                                              │
│                              │                                                       │
│                     ┌────────▼────────┐                                              │
│                     │  MySQL 持久化   │  ✅ mysql2 + 降级 (2026-06-04)               │
│                     │  端口 3306      │                                              │
│                     └────────┬────────┘                                              │
│                              │                                                       │
│                     Python AkShare 微服务 (可选)                                      │
│                              ↓                                                       │
│                         SQLite 本地缓存                                               │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

| 层 | 技术栈 | 端口 | 职责 |
|----|--------|------|------|
| **前端** | Vue 3 + Vite + Axios + 纯 CSS | 5173 (dev) / 3000 (prod) | 行情展示、交互操作、AI 分析面板、技术指标可视化 |
| **后端代理** | Express + iconv-lite + cors | 3000 | API 代理层，解决 CORS、数据清洗、自动重试/降级、调用 DeepSeek、用户数据 API |
| **Redis 缓存层** | ioredis + 内存降级 | 6379 | 行情缓存(30s)、K线缓存(5min)、AI结果缓存(1h)、搜索缓存(1h)，Redis不可用时自动降级到内存 Map |
| **MySQL 持久化** | mysql2 (mysql2/promise) | 3306 | 自选股、自定义热门股、仓位管理、回测记录、用户偏好持久化（双写策略，带 localStorage 降级） |
| **部署** | Nginx 反向代理 → Express → 阿里云 | 80/443 | 生产环境 HTTPS + PM2 进程守护 |

---

## 一、技术方案详解

### 1.1 数据流架构

```
┌──────────────┐     ┌─────────────────┐     ┌───────────────────┐
│  用户浏览器   │────▶│  Express 后端    │────▶│  新浪财经 API      │
│  Vue 3 SPA   │◀────│  (API 代理层)    │◀────│  东方财富 API      │
└──────────────┘     │  port 3000       │     │  DeepSeek API     │
                     └────────┬────────┘     └───────────────────┘
                              │
                     ┌────────▼────────┐
                     │  Python 微服务   │────▶ SQLite (缓存)
                     │  Flask + AkShare│
                     │  port 3081      │
                     └─────────────────┘
```

**核心设计理念：多层降级（Graceful Degradation）**

每个数据请求都有 2-3 层备用方案，确保任意数据源不可用时系统仍能正常运行：

| 功能 | 缓存层 | 首选路径 | 第一降级 | 第二降级 |
|------|--------|---------|---------|---------|
| A 股行情 | ✅ Redis/内存 30s | 新浪财经直连 | 自动走代理重试 | — |
| 美股行情 | ✅ Redis/内存 30s | 新浪 `gb_` 接口 | 代理隧道 CONNECT | — |
| K 线历史 | ✅ Redis/内存 5min | 新浪 K 线 API | — | — |
| 涨停数据 | ✅ Redis/内存 60s | Python AkShare → SQLite | 东方财富 HTTP API | 新浪 API 筛选 |
| 股票搜索 | ✅ Redis/内存 1h | 本地内置数据库 | 新浪 suggest API | — |
| AI 分析 | ✅ Redis/内存 1h | DeepSeek API | 本地规则引擎(JS) | — |
| 涨停情绪 AI | ✅ Redis/内存 1h | DeepSeek API | — | — |

### 1.6 缓存层（新增，2026-06-03）

**架构**
```
Express 路由
  │
  ├─ getOrFetch(key, fetchFn, ttl)
  │     │
  │     ├─ Redis 连接成功 → 读写 Redis (端口 6379)
  │     │
  │     └─ Redis 不可用 → 自动降级到内存 Map (TTL 自动清理)
  │
  └─ fetchFn 抛出异常 → 不缓存，异常透传
```

**缓存策略**

| 数据 | 缓存键 | TTL | 原因 |
|------|--------|-----|------|
| A 股行情 | `stock:cn:{symbol}` | 30s | 价格变化快，但个人使用 30s 刷新足够 |
| 美股行情 | `stock:us:{symbol}` | 30s | 同上 |
| A 股 K 线 | `stock:cn:{symbol}:history` | 5min | 历史数据盘中变化极小 |
| 美股 K 线 | `stock:us:{symbol}:history` | 5min | 同上 |
| A 股搜索 | `search:cn:{keyword}` | 1h | 内置股票列表几乎不变 |
| 美股搜索 | `search:us:{keyword}` | 1h | 同上 |
| 换手率/跌幅填充 | `cn:auto-fill:{symbol}` | 5min | 换手率变化慢 |
| 涨停今日 | `limitup:today` | 60s | 盘中涨停数变化，但无需秒级刷新 |
| 涨停历史 | `limitup:history:{date}` | 1h | 历史数据不变 |
| 涨停板块统计 | `limitup:stats:{date}` | 5min | 盘中变化慢 |
| 涨停检查 | `limitup:check:{symbol}` | 5min | K 线分析结果 |
| AI 体检 | `ai:health:{symbol}:{market}` | 1h | 省 DeepSeek API 费用 |
| AI 信号分析 | `ai:signal:{symbol}:{params}` | 1h | 同参数组合结果不变 |
| AI 涨停分析 | `ai:limitup:analysis` | 1h | 当日涨停分析不变 |

**文件**: `server/cache.js`

**降级表现**
- Redis 服务运行 → 所有缓存走 Redis（有独立服务、数据持久化）
- Redis 服务未启动 → 自动降级到内存 Map（零依赖，仍能缓存）
- 内存缓存随服务重启丢失，但项目功能不受影响

**环境变量**
- `REDIS_HOST` (默认 127.0.0.1)
- `REDIS_PORT` (默认 6379)
- `REDIS_PASSWORD` (可选)

### 1.7 MySQL 持久化层（新增，2026-06-04）

**目标**: 将用户数据从浏览器 `localStorage` 迁移到 MySQL，实现跨设备同步。

**架构**
```
Vue 前端 (App.vue / PositionManager.vue)
  │
  ├─ 写数据：双写策略（始终写 localStorage + 静默同步 MySQL）
  │     │
  │     ├─ localStorage → 离线可用，即时生效
  │     └─ API (X-Device-ID) → MySQL 异步同步，静默失败
  │
  ├─ 读数据：优先 API → MySQL，失败降级 localStorage
  │
  └─ device_id: localStorage 生成 UUID，所有请求携带 X-Device-ID 头
```

**7 张表**

| 表 | 用途 | 关联 |
|----|------|------|
| `users` | 用户表（device_id 匿名标识） | 被所有表 FK 引用 |
| `watchlists` | 自选股列表 | user_id → users.id |
| `custom_picks` | 自定义热门股（按市场分 CN/US） | user_id → users.id |
| `portfolios` | 仓位管理（当前模式/统计） | user_id → users.id |
| `portfolio_actions` | 仓位操作的买入/卖出记录 | user_id → users.id |
| `backtest_records` | 策略回测历史结果（含 JSON） | user_id → users.id |
| `user_preferences` | 用户偏好（主题/默认市场） | user_id → users.id |

**文件**
- `server/db.js` — MySQL 连接池模块 (mysql2/promise)
- `server/routes/user.js` — 14 个 RESTful CRUD 路由
- `server/schema.sql` — 建表 SQL
- `client/src/api/user.js` — 前端 API 封装 + device_id 自动生成

**降级表现**
- MySQL 运行 → 优先读写 MySQL，同步到 localStorage
- MySQL 不可用 → 只读写 localStorage，前端零影响
- 双写策略保证数据永不丢失

**环境变量**
- `DB_HOST` (默认 127.0.0.1)
- `DB_PORT` (默认 3306)
- `DB_USER` (默认 stockuser)
- `DB_PASSWORD` (默认 stock2024)
- `DB_NAME` (默认 stock)

### 1.2 前端技术方案 (Vue 3 SPA)

**技术选型**
- **框架**: Vue 3 Composition API（`export default { setup() }` 写法，未使用 `<script setup>` 语法糖）
- **构建**: Vite 6 + @vitejs/plugin-vue
- **HTTP**: Axios (baseURL 自动代理 `/api` → 后端 3000)
- **样式**: 纯 CSS + CSS 变量主题系统（无 UI 库依赖）
- **图表**: 纯 SVG 渲染（无第三方图表库）

**组件架构**

```
App.vue (主入口)
├── 📈 行情查询 Tab (quote)
│   ├── 搜索栏 (A股/美股切换 + 模糊搜索 + 自动补全)
│   ├── 热门股票快捷按钮 (localStorage 持久化)
│   ├── 股票详情卡片 (价格、涨跌幅、OHLCV 8项数据)
│   ├── 🤖 AIHealthCheck.vue (6 维度 AI 体检 + 雷达图)
│   ├── 🤖 SignalAlert.vue (AI 买卖信号分析 + 参数自动填充)
│   ├── HistoryChart.vue (SVG 折线/面积图, 近30日走势)
│   └── 历史数据明细表格
│
├── 🔥 涨停分析 Tab (limitup) — 仅 A 股
│   ├── LimitUpPanel.vue
│   │   ├── 今日涨停 (含质量评分、连板数、行业)
│   │   ├── 最近5日涨停历史 (日期选择器)
│   │   ├── 板块统计 (价格分组钻取)
│   │   └── 🤖 AI 分析 (DeepSeek 涨停情绪分析)
│   └── 点击个股 → 跳转行情查询 Tab
│
├── (其他可选组件)
│   ├── TechnicalIndicators.vue (MA/MACD/RSI/布林带 SVG 图表)
│   ├── StrategyPanel.vue (6 大量化选股策略)
│   ├── BacktestPanel.vue (策略回测 + 权益曲线)
│   ├── RiskCheck.vue (选股风控检查清单)
│   ├── PositionManager.vue (持仓管理)
│   └── TradingRules.vue (交易规则手册)
│
└── 主题切换 (浅色/深色，localStorage 持久化)
```

**前端关键设计**
- 所有 HTTP 请求带超时(15s) + 最多 2 次自动重试
- 状态管理用 Vue `ref`/`computed`，无 Pinia/Vuex（轻量化）
- SVG 图表全部手写，无 ECharts/Chart.js 依赖
- CSS 变量主题系统：浅色 "简约白" 和深色 "科技风"
- 加载骨架屏 (Skeleton) + 空状态 + 错误重试 三态覆盖

### 1.3 后端技术方案 (Express 代理层)

**API 路由映射**

| 路由 | 功能 | 数据源 |
|------|------|--------|
| `GET /api/stock/us/:symbol` | 美股实时行情 | 新浪 `hq.sinajs.cn/list=gb_{symbol}` |
| `GET /api/stock/us/:symbol/history` | 美股 30 日 K 线 | 新浪 US_MinKService |
| `GET /api/search/us/:keyword` | 美股搜索 | 内置 80+ 热门股 + 新浪 suggest |
| `GET /api/stock/cn/:symbol` | A 股实时行情 | 新浪 `hq.sinajs.cn/list={sh/sz}{code}` |
| `GET /api/stock/cn/:symbol/history` | A 股 30 日 K 线 | 新浪 CN_MarketData |
| `GET /api/stock/cn/:symbol/auto-fill` | A 股信号参数自动填充 | 腾讯换手率 + 新浪 120 日历史 |
| `GET /api/search/cn/:keyword` | A 股搜索 | 内置 30+ 热门股 + 新浪 suggest |
| `GET /api/limit-up/today` | 今日涨停数据 | Python → 东方财富 → 新浪 (三级降级) |
| `GET /api/limit-up/history` | 历史涨停数据 | Python → 东方财富 |
| `GET /api/limit-up/stats` | 涨停板块统计 | Python → 本地计算 |
| `GET /api/limit-up/check/:symbol` | 个股涨停历史检查 | 新浪 30 日 K 线分析 |
| `GET /api/limit-up/analysis` | 🤖 AI 涨停情绪分析 | DeepSeek API |
| `POST /api/ai/health-check` | 🤖 AI 个股 6 维度体检 | DeepSeek API |
| `POST /api/ai/signal-analysis` | 🤖 AI 买卖信号分析 | DeepSeek API |
| `GET /api/strategy/:name` | 量化选股策略 (6 种) | 代理→Python |
| `POST /api/backtest` | 策略回测 | 代理→Python |
| `GET /api/health` | 健康检查 | — |

**代理自动降级机制**

```
httpGet(url, options)
  ├── 1. makeRequest(url, false)  // 直连
  │     └── 成功 → 返回
  │     └── 失败 → 2
  ├── 2. 检查是否有代理配置 (HTTPS_PROXY)
  │     └── 有代理且非内网 → makeRequest(url, true)  // 走代理
  │     └── 无代理 → 抛出直连错误
  └── 3. 代理请求
        ├── HTTPS: CONNECT 隧道 (net.connect → socket)
        └── HTTP: 修改 hostname/port/path + Host 头
```

### 1.4 Python 微服务方案 (Flask + AKShare)

**架构**

```
Python 微服务 (port 3081)
├── Flask REST API
├── AKShare (开源 A 股数据接口)
├── SQLite 本地缓存 (stock_cache.db)
├── 后台数据同步线程 (启动时自动执行)
└── 6 大量化选股策略引擎
```

**数据表设计**

| 表名 | 存储内容 | 更新频率 | 数据量 |
|------|---------|---------|-------|
| `stock_quote` | 全 A 股实时行情 (PE/PB/市值/换手率) | 每日 | ~5000 行 |
| `financial_data` | 财务数据 (营收/利润/毛利率) | 季度 | ~200 行 |
| `limit_up_pool` | 每日涨停池 (含连板/封单/行业) | 每日 | ~100 行/天 |
| `limit_up_stats` | 板块统计 (行业聚合) | 每日 | ~30 行/天 |

**6 大量化选股策略**

| 策略 | 类型 | 核心条件 | 评分维度 |
|------|------|---------|---------|
| conservative (保守型) | 低估值蓝筹 | PE<15, PB<3, 市值>200亿 | PE+PB+市值 |
| garp (中立型) | GARP 均衡 | PEG<1.2, 净利润增速>15%, 毛利率>30% | PEG+增速+毛利率 |
| momentum (激进型) | 动量爆发 | 净利润增速>50%, 换手率3-25% | 增速+换手 |
| potential (潜力型) | 高增长潜力 | 净利润增速>50%, 市值>100亿 | 增速+毛利率+市值 |
| limitback (涨停回马枪) | 技术型 | 近7天涨停+今日回调+放量 | 涨停天数+换手+增速 |
| ma-bullish (均线多头) | 技术型 | 涨幅>0, 换手>1%, PE<50 | 涨幅+换手+市值 |

**涨停质量评分算法** (0-100)

```
总分 = 封板时间(0-30) + 封单金额(0-30) + 换手率(0-20) + 连板数(0-20)

封板时间评分:
  ≤5min → 30 | ≤15min → 25 | ≤30min → 20 | ≤60min → 15 | >60min → 10

封单金额评分:
  >5亿 → 30 | >2亿 → 25 | >1亿 → 20 | >5000万 → 15 | <5000万 → 10

换手率评分:
  5-20% → 20 | 3-25% → 15 | 1-30% → 10 | 其他 → 5

连板数评分:
  ≥5板 → 20 | ≥3板 → 15 | ≥2板 → 12 | 1板 → 8
```

### 1.5 部署方案

```
用户 HTTPS 请求
      ↓
阿里云服务器 (47.116.51.148)
      ↓
Nginx (反向代理 443→3000, SSL 终结)
      ↓
Express (端口 3000, PM2 守护)
 ├── 静态文件: /client/dist (前端 SPA)
 ├── API 代理: /api/* (实时数据)
 └── Python 服务: 3081 (可选，当前未运行)
```

**部署命令**
```bash
# 构建前端 + 启动生产服务器
cd /opt/stock-viewer && npm run start

# 启动 Python 微服务 (可选, 需安装 Python 依赖)
cd /opt/stock-viewer/python && python api.py
```

---

## 二、AI 在项目中的具体应用

本项目集成 **DeepSeek API** 实现三个 AI 分析功能，所有 AI 功能均有**本地降级方案**，API 不可用时自动回退到规则引擎。

### 2.1 AI 股票体检 (AIHealthCheck.vue)

**位置**: 行情查询 Tab → 股票详情下方
**调用**: `POST /api/ai/health-check`

**AI 分析 Prompt 设计**

```
你是一位顶级AI投顾分析师。请对以下A股/美股进行6维度风险扫描分析。

【股票数据】
- 代码, 名称, 当前价, 涨跌幅, 开盘/最高/最低/昨收, 成交量, 振幅, 市场

6个维度:
1. sentiment(市场情绪): 判断当前市场情绪状态
2. trend(趋势结构): 分析价格趋势健康度
3. liquidity(流动性): 评估成交量与流动性
4. volatility(波动性): 分析价格波动风险
5. capital(资金博弈): 判断资金流向与博弈情况
6. valuation(估值安全): 评估估值合理性

每个维度输出: score(0-100风险分), level(high/warn/low), brief, analysis, suggestion, reason
综合输出: aiScore(0-100), conclusionTitle/Desc/Tags, advice, confidence(0-100)
```

**返回格式**: 结构化 JSON（前端直接解析渲染）

**前端展示**
- 6 个风险维度卡片（可展开查看详细分析）
- Canvas 雷达图 (手绘, 无第三方库)
- AI 综合评分环形进度条 (SVG ring)
- 结论区 + 投资建议 + 可信度

**降级方案**: DeepSeek API 不可用时，前端 `fallbackAnalysis()` 根据涨跌幅、振幅、成交量等本地数据，用规则引擎生成各维度评分:
- 涨跌幅大 → 情绪维度 score 高
- 成交量小 → 流动性维度 score 高
- 振幅大 → 波动性维度 score 高
- 综合加权得出 aiScore 和结论

### 2.2 AI 买卖信号分析 (SignalAlert.vue)

**位置**: 行情查询 Tab → AI 体检下方
**调用**: `POST /api/ai/signal-analysis`

**前端自动填充**
- 查询股票时自动调用 `/api/stock/cn/:symbol/auto-fill`
- 后端聚合 3 个数据源:
  1. 腾讯接口 → 今日换手率
  2. 新浪 120 日 K 线 → 从最高点跌幅
  3. 上证指数 120 日 K 线 → 大盘从高点跌幅
- 用户也可手动修改参数

**AI 分析 Prompt**
```
分析买入信号(含超跌到位、换手率适中、涨幅适度等)
分析卖出信号(含换手率过高、涨幅过大等)
输出: 综合建议(action/reason/confidence) + 风险等级(low/medium/high)
```

**降级方案**: 前端 `fallbackSignalAnalysis()` 基于规则判断:
- `大盘跌幅≥20%` + `个股跌幅≥50%` → 底部买入信号
- `换手率≥30%` → 风险信号
- `涨幅>9%` → 涨幅过大信号

### 2.3 AI 涨停情绪分析 (LimitUpPanel.vue → analysis Tab)

**位置**: 涨停分析 Tab → AI 分析
**调用**: `GET /api/limit-up/analysis`

**AI 分析 Prompt**
```
根据今日涨停数据(总数、价格分布、前30只明细)分析:
1. 市场情绪判断 (强势/中性/弱势)
2. 资金偏好 (低价/中价/高价股)
3. 操作建议 (短线/中线)
4. 风险提示
```

**降级方案**: API 不可用时显示"AI 引擎暂不可用"提示

### 2.4 AI 集成架构总结

```
┌──────────────────────────────────────────────────┐
│                 DeepSeek API                      │
│          api.deepseek.com/v1/chat/completions     │
└──────────────────┬───────────────────────────────┘
                   │ HTTPS POST (JSON)
                   ▼
┌──────────────────────────────────────────────────┐
│              Express 后端 (server/index.js)        │
│                                                   │
│  POST /api/ai/health-check    → 股票 6 维体检     │
│  POST /api/ai/signal-analysis → 买卖信号分析      │
│  GET  /api/limit-up/analysis  → 涨停情绪分析      │
│                                                   │
│  环境变量: DEEPSEEK_API_KEY                       │
│  Model: deepseek-chat                             │
│  Temperature: 0.7                                 │
└──────────────────┬───────────────────────────────┘
                   │ JSON 响应
                   ▼
┌──────────────────────────────────────────────────┐
│              前端 Vue 3 组件                       │
│                                                   │
│  AIHealthCheck.vue                                │
│    ├── 调用 /api/ai/health-check                  │
│    ├── 成功 → 渲染 6 维度 + 雷达图 + 评分         │
│    └── 失败 → fallbackAnalysis() 本地规则          │
│                                                   │
│  SignalAlert.vue                                  │
│    ├── 自动填充 → 调用 /api/ai/signal-analysis    │
│    ├── 成功 → 渲染买卖信号列表 + 建议卡            │
│    └── 失败 → fallbackSignalAnalysis() 本地规则    │
│                                                   │
│  LimitUpPanel.vue                                 │
│    └── analysis Tab → AI 涨停情绪分析文本          │
└──────────────────────────────────────────────────┘
```

---

## 三、实现过程详解

### 3.1 开发阶段

**阶段 1: 核心行情功能** (MVP)
1. 搭建 Express + Vue 3 + Vite 脚手架
2. 实现 A 股/美股实时行情 API（新浪财经）
3. 实现 A 股/美股 30 日 K 线 API
4. 实现内置股票搜索 + 新浪 suggest 补全
5. 前端行情展示卡片 + SVG 折线图
6. 自选股管理（localStorage 持久化）
7. 双主题切换（浅色/深色）

**阶段 2: 涨停分析系统**
1. 接入 Python AkShare 获取涨停池数据
2. 实现东方财富 HTTP API 作为降级方案
3. 实现新浪 API 二级降级
4. 涨停质量评分算法
5. 涨停板块统计 + 价格分组钻取
6. 近 5 日涨停历史查看

**阶段 3: AI 集成**
1. 接入 DeepSeek API (OpenAI 兼容接口)
2. 设计 6 维度分析 Prompt 并实现前端渲染
3. 设计买卖信号分析 Prompt + 参数自动填充
4. 涨停情绪分析
5. 每项 AI 功能配套本地降级规则引擎

**阶段 4: 量化策略系统**
1. Python Flask 微服务 + SQLite 缓存
2. 全 A 股行情同步（2400 只股票分页爬取）
3. 6 大量化选股策略实现 (SQL 评分排序)
4. 涨停回马枪策略（结合涨停池 + 行情）
5. 策略回测引擎（模拟权益曲线 + 夏普比率）

**阶段 5: 美股数据迁移**
1. 因 Twelve Data 免费 demo key 过期，迁移到新浪 `gb_` 接口
2. 实现 HTTP CONNECT 隧道代理（翻墙访问美股 API）
3. 内置 80+ 热门美股数据库，补充新浪 suggest 搜索

### 3.2 关键技术决策

| 决策 | 选择 | 原因 |
|------|------|------|
| 图表库 | 手写 SVG | 避免 ECharts 大体积依赖, 功能刚好够用 |
| UI 框架 | 无，纯 CSS | 轻量化，CSS 变量主题系统，无学习成本 |
| 状态管理 | Vue ref/computed | 页面复杂度低, Pinia 没必要 |
| 后端数据源 | HTTPS 代理转发 | 避免前端 CORS，且能处理 GBK 编码 |
| 美股代理 | CONNECT 隧道 | 解决 HTTPS 请求的代理转发 |
| 缓存 | SQLite | 轻量，无需 MySQL/Redis，适合单机部署 |
| 缓存 | Redis + 内存降级 | 替代 SQLite，提升缓存性能，自动降级保障可用性 |
| 用户数据 | MySQL + localStorage 双写 | 跨设备同步，MySQL 挂了零影响 |
| 降级 | 多层降级链 | 保证任意数据源挂掉时核心功能可用 |

### 3.3 边界情况处理

**所有组件覆盖以下状态**:
- **Loading 态**: 骨架屏 / 加载动画 / 进度条
- **Empty 态**: 空状态提示 + 操作引导
- **Error 态**: 错误信息 + 重试按钮
- **Success 态**: 正常数据渲染
- **超时重试**: 15s 超时 + 最多 2 次自动重试

**特殊场景**:
- 非交易时间段 → "暂无涨停数据" + "当前非交易时间"
- 美股 API 被墙 → 自动直连→代理降级
- GBK 编码 → `iconv-lite` 解码
- 涨停 check 20cm 和 10cm → 根据代码前缀自动判断
- 新浪数据字段位置 → 硬编码字段索引 (26 个字段)
- 换手率获取不到 → 前端参数留空，用户可手动填写

---

## 四、本地开发

### 4.1 环境变量

创建 `local-config.ps1`（已 .gitignore）:
```powershell
$env:DEEPSEEK_API_KEY = "你的DeepSeek Key"
$env:DEPLOY_HOST = "服务器IP"
$env:DEPLOY_USER = "root"
$env:DEPLOY_PASSWORD = "密码"
```

### 4.2 启动

```powershell
# 安装依赖
cd D:\agentAIdemo\stock-viewer\stock-viewer
npm run install:all

# 1. 启动 MySQL（如未运行）
# 首次安装: winget install --id Oracle.MySQL
# 初始化: "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqld" --initialize-insecure --datadir=D:\MySQL\data
"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqld" --defaults-file=D:\MySQL\my.cnf

# 2. 启动 Redis（如未运行）
redis-server

# 3. 启动后端 (带代理)
$env:HTTPS_PROXY="http://127.0.0.1:7890"
node server/index.js

# 4. 启动前端 (另一个终端)
cd client && npx vite --host 0.0.0.0 --port 5173

# 或一键启动（需先启动 MySQL + Redis）
npm run dev

# 启动 Python 微服务 (可选)
cd python && python api.py
```

> **启动顺序**: MySQL (3306) → Redis (6379) → Express (3000) → Vite (5173)

### 4.3 生产构建

```bash
# 构建 + 启动
npm run start

# 部署到阿里云
python deploy.py
```

---

## 五、项目文件清单

```
stock-viewer/
├── CLAUDE.md                    ← 本文档
├── package.json                 # 根配置 (concurrently)
├── README.md                    # 简要说明
├── deploy.py / deploy.ps1 / deploy.sh  # 部署脚本
├── local-config.ps1             # 本地环境变量 (已 gitignore)
│
├── server/
│   ├── index.js                 # Express 后端 (~1260 行)
│   ├── cache.js                 # Redis + 内存双重缓存层（新增 2026-06-03）
│   ├── db.js                    # MySQL 连接池模块（新增 2026-06-04）
│   ├── schema.sql               # 建表 SQL（7 张表）
│   ├── routes/
│   │   └── user.js              # 用户数据 API 路由（14 个端点）
│       ├── HTTP 请求工具 (直连+代理)
│       ├── 美股 API (新浪 gb_)
│       ├── A 股 API (新浪)
│       ├── 涨停数据 API (三级降级)
│       ├── AI DeepSeek 集成 (3个端点)
│       ├── 策略代理 (→ Python 微服务)
│       └── 用户数据 API (→ MySQL)
│
├── client/
│   ├── index.html               # 入口
│   ├── vite.config.js           # Vite 配置
│   ├── package.json             # 前端依赖
│   ├── src/
│   │   ├── main.js              # Vue 入口
│   │   ├── App.vue              # 主组件 (路由/搜索/详情)
│   │   ├── style.css            # 全局样式 + 明暗主题
│   │   ├── api/
│   │   │   ├── stock.js         # Axios API 封装（行情/策略）
│   │   │   └── user.js          # 用户数据 API 封装（新增 2026-06-04）
│   │   ├── utils/
│   │   │   └── indicators.js    # 技术指标计算 (SMA/EMA/MACD/RSI/布林带)
│   │   └── components/
│   │       ├── AIHealthCheck.vue     # 🤖 AI 股票体检 (6维度 + 雷达图)
│   │       ├── SignalAlert.vue       # 🤖 AI 买卖信号分析
│   │       ├── LimitUpPanel.vue      # 涨停分析面板
│   │       ├── HistoryChart.vue      # SVG 走势图
│   │       ├── TechnicalIndicators.vue  # MA/MACD/RSI/布林带图表
│   │       ├── StrategyPanel.vue     # 量化选股策略面板
│   │       ├── BacktestPanel.vue     # 策略回测面板
│   │       ├── RiskCheck.vue         # 选股风控检查
│   │       ├── PositionManager.vue   # 持仓管理
│   │       └── TradingRules.vue      # 交易规则手册
│   └── dist/                    # 构建输出
│
└── python/
    ├── api.py                   # Flask 微服务 (~1200 行)
    ├── requirements.txt         # Python 依赖
    └── stock_cache.db           # SQLite 缓存 (自动生成)
```

---

## 六、待办事项

### 🔴 优先级：Token 鉴权 + API 安全（已完成 2026-06-08）

- [x] **API Token** — 静态 Token 保护 AI 接口，防止未授权调用 DeepSeek
- [x] **JWT 登录** — 用户名/密码注册登录，JWT 签发与验证，7 天过期
- [x] **Rate Limiting** — AI 接口限流(20次/分钟)、行情接口限流(60次/分钟)、Token 每日配额(100次/天默认)

### 🟡 次要：Python 微服务升级

- [ ] Python AkShare 微服务 → MySQL + Redis（SQLite 迁移）
- [ ] 涨停质量评分可接入 AI 辅助评分

### 🟢 长期

- [ ] 美股历史数据量偏少（仅 30 天），增加更多历史数据源
- [ ] 考虑添加实时 WebSocket 推送替代轮询
