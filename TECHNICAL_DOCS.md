# stock-viewer 技术文档

> 全栈股票行情查看器 — Vue 3 + Express + MySQL + Redis + Python(AKShare)
> 最后更新：2026-06-10

---

## 目录

1. [项目概览](#1-项目概览)
2. [系统架构](#2-系统架构)
3. [数据源](#3-数据源)
4. [后端架构](#4-后端架构)
   - 4.1 Express 主服务
   - 4.2 缓存模块 (cache.js)
   - 4.3 数据库模块 (db.js)
   - 4.4 鉴权中间件 (auth.js)
   - 4.5 认证路由 (auth.js)
   - 4.6 用户数据路由 (user.js)
   - 4.7 Python 微服务 (api.py)
5. [数据库设计](#5-数据库设计)
6. [Redis 缓存策略](#6-redis-缓存策略)
7. [前端架构](#7-前端架构)
8. [API 端点全表](#8-api-端点全表)
9. [数据流详解](#9-数据流详解)
10. [部署指南](#10-部署指南)
11. [开发指南](#11-开发指南)
12. [启动顺序](#12-启动顺序)
13. [附录：关键文件清单](#13-附录关键文件清单)

---

## 1. 项目概览

### 功能特性

| 功能 | 说明 |
|------|------|
| **美股实时行情** | 新浪财经 `gb_` 接口，缓存 30s |
| **A股实时行情** | 新浪财经接口，缓存 30s |
| **K 线走势** | 近 30 日 OHLCV 数据，缓存 5min |
| **股票搜索** | 内置 80+ 美股 / 30+ A股 热门股票 + 新浪 suggest |
| **策略选股** | 6 种量化策略（保守/GARP/动量/潜力/涨停回马枪/均线多头） |
| **涨停板监控** | 今日涨停 + 历史查询 + 板块统计 + 质量评分 |
| **AI 分析** | DeepSeek 驱动的个股健康检查 + 买卖信号 + 涨停情绪分析 |
| **自选股管理** | MySQL 持久化 + localStorage 双写降级 |
| **仓位管理** | 空仓/轻仓/重仓/短线模式 + 操作记录 |
| **回测记录** | 策略回测结果持久化 |
| **用户偏好** | 主题/默认市场同步到 MySQL |
| **JWT 登录** | 注册/登录/Token 刷新/个人信息 |
| **API Token** | AI 接口防护 + 每日配额管理 |
| **Rate Limiting** | 按接口类型限流（行情 60rpm / 搜索 30rpm / AI 20rpm） |
| **双主题** | 科技风（深色）+ 简约白（浅色），CSS 变量驱动 |

### 技术栈

```
Frontend:    Vue 3 (Composition API) + Vite + Axios + 纯 CSS
Backend:     Express.js 4.x + ioredis + mysql2 + jsonwebtoken + bcryptjs
Microservice: Python 3 + Flask + AKShare + pymysql + redis-py
Database:    MySQL 8.4 (InnoDB)
Cache:       Redis 7+ (RESP2)
AI:          DeepSeek Chat API
Data:        新浪财经 (Sina) + 东方财富 (EastMoney) + 腾讯 (Tencent) + AKShare
```

---

## 2. 系统架构

```
┌────────────────────────────────────────────────────────────────────┐
│                        Browser (用户)                              │
│  Vue 3 SPA → http://localhost:5173 (dev) / localhost:3000 (prod)  │
└──────────────────────────┬─────────────────────────────────────────┘
                           │ HTTP / JSON
                           ▼
┌────────────────────────────────────────────────────────────────────┐
│                     Express 服务器 :3000                           │
│                                                                     │
│  ┌──────────────────────┐  ┌──────────────────────────────────┐   │
│  │  静态文件服务          │  │  API 中间件链                    │   │
│  │  (client/dist)        │  │                                  │   │
│  └──────────────────────┘  │  cors → json → rateLimit → auth   │   │
│                            │    ↓                              │   │
│  ┌──────────────────────┐  │  ┌──────────────────────────┐    │   │
│  │  缓存模块 cache.js    │  │  │  路由层                   │    │   │
│  │  ┌─── Redis ───┐     │  │  │  /api/stock/*   行情     │    │   │
│  │  │  自动降级    │     │  │  │  /api/search/*  搜索     │    │   │
│  │  └─── Memory ──┘     │  │  │  /api/limit-up/* 涨停    │    │   │
│  └──────────────────────┘  │  │  /api/ai/*       AI分析  │    │   │
│                            │  │  /api/strategy/* 策略    │    │   │
│  ┌──────────────────────┐  │  │  /api/auth/*     认证    │    │   │
│  │  数据库模块 db.js     │  │  │  /api/user/*     用户数据│    │   │
│  │  ┌─── MySQL 8.4 ───┐ │  │  └──────────────────────────┘    │   │
│  │  │  自动降级         │ │  └──────────────────────────────────┘   │
│  │  └──────────────────┘ │                                         │
│  └──────────────────────┘                                         │
└──────────────────────────┬─────────────────────────────────────────┘
                           │ HTTP (127.0.0.1:3081)
                           ▼
┌────────────────────────────────────────────────────────────────────┐
│                    Python 微服务 :3081                              │
│                                                                     │
│  Flask + AKShare + pymysql + redis-py                              │
│                                                                     │
│  功能:                                                              │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ • 全A股行情同步（新浪 → MySQL，2399+ 只）                    │  │
│  │ • 涨停池同步（AKShare 东方财富 → MySQL）                     │  │
│  │ • 财务数据同步（AKShare 新浪财报 → MySQL）                   │  │
│  │ • 6 种策略选股（MySQL 查询 + 评分排序）                      │  │
│  │ • 策略回测模拟（蒙特卡洛 + 权益曲线）                         │  │
│  │ • 涨停质量评分（封板时间/金额/换手率/连板）                  │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  缓存策略: Redis python:strategy:* 键 30min TTL                    │
│  数据源: MySQL stock 数据库（与 Express 共享）                     │
└────────────────────────────────────────────────────────────────────┘
```

### 组件间关系

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  用户浏览器   │────▶│  Express :3000    │────▶│  新浪/东方财富    │
│  Vue 3 SPA   │     │  (API 代理 + 缓存)  │     │  (HTTP 数据源)   │
└─────────────┘     │                  │     └─────────────────┘
                    │                  │     ┌─────────────────┐
                    │                  │────▶│  DeepSeek API   │
                    │                  │     │  (AI 分析)       │
                    │                  │     └─────────────────┘
                    │                  │     ┌─────────────────┐
                    │                  │────▶│  Python :3081    │
                    │                  │     │  (策略 + 同步)    │
                    └───────┬──────────┘     └────────┬────────┘
                            │                         │
                    ┌───────▼──────────┐     ┌────────▼────────┐
                    │  Redis :6379     │     │  MySQL :3306     │
                    │  (缓存降级内存)    │     │  (stock 数据库)   │
                    └──────────────────┘     └─────────────────┘
```

---

## 3. 数据源

### 行情数据

| 数据 | 来源 | 接口地址 | 备注 |
|------|------|----------|------|
| **美股实时行情** | 新浪财经 | `hq.sinajs.cn/list=gb_{symbol}` | GBK 编码，字段格式特殊 |
| **美股历史 K 线** | 新浪财经 | `stock.finance.sina.com.cn/usstock/api/json_v2.php/US_MinKService.getDailyK` | 返回完整数据，取近 30 日 |
| **美股搜索** | 内置 80+ 热门股 | + 新浪 suggest3 (type=12) | 本地匹配失败再请求新浪 |
| **A股实时行情** | 新浪财经 | `hq.sinajs.cn/list={sh/sz}{code}` | GBK 编码 |
| **A股历史 K 线** | 新浪财经 | `money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData` | 支持任意天数 |
| **A股搜索** | 内置 30+ 热门股 | + 新浪 suggest3 (type=11) | 6 位代码精确匹配 |
| **换手率** | 腾讯财经 | `qt.gtimg.cn/q={sh/sz}{code}` | 字段 `~` 分隔 |

### 涨停数据

| 数据 | 来源 | 接口地址 | 备注 |
|------|------|----------|------|
| **今日涨停** | Python → 东方财富 | `push2ex.eastmoney.com/getTopicZTPool` | AKShare `stock_zt_pool_em` |
| **今日涨停降级** | 新浪 | `vip.stock.finance.sina.com.cn/.../Market_Center.getHQNodeData` | 遍历全 A 筛选涨≥9.9% |

### 财务数据

| 数据 | 来源 | 接口地址 | 备注 |
|------|------|----------|------|
| **利润表** | Python → AKShare | `ak.stock_financial_report_sina(stock, symbol='利润表')` | 最近 2 期财报 |

### AI 分析

| 服务 | 接口 | 模型 | Token 限制 |
|------|------|------|-----------|
| 健康检查 | `POST /api/ai/health-check` | `deepseek-chat` | max_tokens=3000 |
| 买卖信号 | `POST /api/ai/signal-analysis` | `deepseek-chat` | max_tokens=2000 |
| 涨停分析 | `GET /api/limit-up/analysis` | `deepseek-chat` | max_tokens=1500 |

---

## 4. 后端架构

### 4.1 Express 主服务 (`server/index.js`)

单一入口，约 1295 行，职责：

```
server/index.js
├── 路由注册（中间件链）
│   ├── cors()                          # 跨域
│   ├── express.json()                  # JSON 解析
│   ├── /api/user/*         → user.js  # 用户数据 CRUD
│   ├── /api/auth/*         → auth.js  # 注册/登录/JWT
│   ├── /api/ai/*           → requireToken + rateLimit + quotaCheck
│   ├── /api/limit-up/*     → rateLimit
│   ├── /api/stock/*        → rateLimit
│   ├── /api/search/*       → rateLimit
│   ├── /api/strategy/*     → proxyToPython + getOrFetch 缓存
│   ├── /api/backtest       → proxyToPython POST
│   ├── /api/health         → 服务健康
│   ├── /api/sync/status    → Python 同步状态
│   └── /*                  → SPA fallback (index.html)
│
├── 行情路由（内联实现）
│   ├── GET /api/stock/us/:symbol          # 美股实时
│   ├── GET /api/stock/us/:symbol/history  # 美股 K 线
│   ├── GET /api/search/us/:keyword        # 美股搜索
│   ├── GET /api/stock/cn/:symbol          # A股实时
│   ├── GET /api/stock/cn/:symbol/history  # A股 K 线
│   ├── GET /api/stock/cn/:symbol/auto-fill # 自动填充参数
│   └── GET /api/search/cn/:keyword        # A股搜索
│
├── 涨停路由（内联实现）
│   ├── GET /api/limit-up/today           # 今日涨停
│   ├── GET /api/limit-up/history?date=   # 历史涨停
│   ├── GET /api/limit-up/stats?date=     # 板块统计
│   ├── GET /api/limit-up/check/:symbol   # 个股涨停检查
│   └── GET /api/limit-up/analysis        # AI 涨停分析
│
├── AI 路由（内联实现）
│   ├── POST /api/ai/health-check         # 健康检查
│   └── POST /api/ai/signal-analysis      # 买卖信号
│
└── 工具函数
    ├── makeRequest()          # HTTP 请求（支持代理）
    ├── httpGet()             # GET 封装（直连→代理自动降级）
    ├── httpsPost()           # POST (DeepSeek API)
    ├── proxyToPython()       # 代理到 Python 微服务
    ├── getTodayLimitUp()     # 今日涨停（降级链）
    └── getLimitUpByDate()    # 历史涨停（降级链）
```

#### HTTP 代理机制

```javascript
httpGet(url)
  ├── 直连请求 (timeout: 10s)
  │   ├── 成功 → 返回响应
  │   └── 失败 ↓
  └── 代理重试（检测 HTTPS_PROXY/HTTP_PROXY 环境变量）
      ├── HTTPS → CONNECT 隧道
      └── HTTP  → 全路径代理
```

### 4.2 缓存模块 (`server/cache.js`)

```
initCache()
  ├── Redis (ioredis, lazyConnect)
  │   ├── 成功 → _redis 赋值，日志 ✅
  │   └── 失败 ↓
  └── MemoryCache（内存 Map）
      ├── 30s 定时清理过期项
      ├── Redis 连接断开自动降级
      └── 零外部依赖

getOrFetch(key, fetchFn, ttlSeconds)
  ├── 1. get(key) → 有缓存 → 直接返回
  ├── 2. fetchFn() → 取新数据
  │   ├── fetchFn 抛异常 → 不缓存，异常透传
  │   └── fetchFn 返回 null/undefined → 不缓存
  └── 3. set(key, data, ttl) → 写入缓存
```

#### 缓存键前缀

| 类型 | 键模式 | TTL |
|------|--------|-----|
| 美股行情 | `stock:us:{symbol}` | 30s |
| 美股 K 线 | `stock:us:{symbol}:history` | 5min |
| 美股搜索 | `search:us:{keyword}` | 1h |
| A股行情 | `stock:cn:{symbol}` | 30s |
| A股 K 线 | `stock:cn:{symbol}:history` | 5min |
| A股搜索 | `search:cn:{keyword}` | 1h |
| 换手率填充 | `cn:auto-fill:{symbol}` | 5min |
| 涨停今日 | `limitup:today` | 60s |
| 涨停历史 | `limitup:history:{date}` | 1h |
| 涨停板块统计 | `limitup:stats:{date}` | 5min |
| 涨停检查 | `limitup:check:{symbol}` | 5min |
| AI 健康检查 | `ai:health:{symbol}:{market}` | 1h |
| AI 买卖信号 | `ai:signal:{symbol}:{params}` | 1h |
| AI 涨停分析 | `ai:limitup:analysis` | 1h |
| Express 策略 | `express:strategy:{name}` | 30min |
| Python 策略 | `python:strategy:{name}` | 30min |

### 4.3 数据库模块 (`server/db.js`)

MySQL 8.4 连接池，mysql2/promise 驱动。

```javascript
DB_CONFIG = {
  host:     process.env.DB_HOST || '127.0.0.1',
  port:     process.env.DB_PORT || '3306',
  user:     process.env.DB_USER || 'stockuser',
  password: process.env.DB_PASSWORD || 'stock2024',
  database: process.env.DB_NAME || 'stock',
  connectionLimit: 10,
}
```

| 方法 | 功能 | 失败行为 |
|------|------|----------|
| `initDB()` | 创建连接池 + ping 验证 | 设置 _enabled=false |
| `isReady()` | 检查连接池可用 | - |
| `query(sql, params)` | 多行查询 | 返回 null |
| `queryOne(sql, params)` | 单行查询 | 返回 null |
| `insert(sql, params)` | 插入返回 insertId | 返回 null |
| `execute(sql, params)` | 更新/删除，返回 affectedRows | 返回 null |
| `getOrCreateUser(deviceId)` | 按 device_id 查找或创建用户 | 返回 null |

### 4.4 鉴权中间件 (`server/middleware/auth.js`)

三层渐进式安全防护：

```
请求 → [Rate Limiting] → [API Token / JWT] → [Daily Quota] → 路由
```

#### 阶段 1: API Token（静态）

```
Header: x-api-token: stock-viewer-default-token
用途：/api/ai/* 和 /api/limit-up/analysis 路由保护
防刷 DeepSeek API 额度
```
可通过环境变量 `API_TOKEN` 自定义。

#### 阶段 2: JWT 鉴权

| 中间件 | 行为 |
|--------|------|
| `authJWT` | 强制：从 `Authorization: Bearer <token>` 解析，失败返回 401 |
| `optionalAuthJWT` | 可选：有 token 则解析用户信息，无 token 继续执行 |

JWT payload 结构：
```json
{
  "userId": 1,
  "username": "user",
  "role": "user",
  "iat": ...,
  "exp": ...
}
```
有效期 7 天，通过 `JWT_SECRET` 和 `JWT_EXPIRES_IN` 环境变量配置。

#### 阶段 3: Rate Limiting

| 限流器 | 速率 | 应用路由 |
|--------|------|----------|
| `aiRateLimit` | 20 次/分钟 | `/api/ai/*` |
| `quoteRateLimit` | 60 次/分钟 | `/api/stock/*`, `/api/limit-up/today` |
| `searchRateLimit` | 30 次/分钟 | `/api/search/*` |

限流基于 IP (`req.ip`)，响应头：
```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 42
X-RateLimit-Reset: 1718038400
```

#### Token 配额（AI 接口专用）

按 Token 值分配每日 AI 调用配额，通过 `TOKEN_QUOTA_<name>=<aiDaily>,<rpm>` 环境变量配置。

| Token | 每日 AI 调用 | 每分钟请求 |
|-------|-------------|-----------|
| `stock-viewer-default-token` | 100 | 60 |
| 自定义 | 通过环境变量 | 同上 |

响应头：
```
X-Quota-Limit: 100
X-Quota-Remaining: 87
```

### 4.5 认证路由 (`server/routes/auth.js`)

| 端点 | 方法 | 功能 | 参数 |
|------|------|------|------|
| `/api/auth/register` | POST | 注册 | `{username, password}` |
| `/api/auth/login` | POST | 登录 | `{username, password}` |
| `/api/auth/refresh` | POST | 刷新 Token | `Authorization: Bearer <token>` |
| `/api/auth/me` | GET | 用户信息 | `Authorization: Bearer <token>` |

密码存储：bcryptjs 加盐 10 轮哈希。用户名 2-30 字符，密码 ≥6 字符。

### 4.6 用户数据路由 (`server/routes/user.js`)

基于 `X-Device-ID` 头的匿名用户识别，MySQL 自动降级。

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/user/watchlist` | GET | 获取自选股 |
| `/api/user/watchlist` | POST | 添加自选股 |
| `/api/user/watchlist/:symbol` | DELETE | 删除自选股 |
| `/api/user/watchlist/reorder` | PUT | 批量排序 |
| `/api/user/picks?market=` | GET | 获取自定义热门股 |
| `/api/user/picks` | POST | 添加自定义股 |
| `/api/user/picks/:id` | DELETE | 删除自定义股 |
| `/api/user/picks/reorder` | PUT | 批量排序 |
| `/api/user/portfolio` | GET | 获取仓位管理 |
| `/api/user/portfolio` | POST | 更新仓位 |
| `/api/user/portfolio/action` | POST | 记录操作 |
| `/api/user/portfolio/action/:id` | DELETE | 删除操作 |
| `/api/user/backtests` | GET | 获取回测历史 |
| `/api/user/backtests` | POST | 保存回测 |
| `/api/user/preferences` | GET | 获取偏好 |
| `/api/user/preferences` | PUT | 更新偏好 |

**双写策略**：前端始终写入 localStorage，同时异步同步到 MySQL。MySQL 失败零影响。

### 4.7 Python 微服务 (`python/api.py`)

Flask + AKShare + pymysql + redis-py，约 1210 行。

#### 功能模块

```
python/api.py
├── Redis 缓存层 (get_or_fetch_cache / invalidate_cache)
├── MySQL 数据层 (query / query_one / execute / execute_many)
├── 数据同步
│   ├── sync_all_quotes()       # 全 A 股行情同步
│   ├── sync_limit_up(date)     # 涨停池同步
│   └── sync_financial_batch()  # 财务数据同步
├── 策略引擎
│   ├── strategy_conservative()   # 保守型
│   ├── strategy_garp()          # GARP 均衡
│   ├── strategy_momentum()      # 动量爆发
│   ├── strategy_potential()     # 潜力型
│   ├── strategy_limitback()     # 涨停回马枪
│   └── strategy_ma_bullish()    # 均线多头
├── 涨停评分 (calc_limit_up_score)
├── API 路由
│   ├── /api/health                # 健康检查
│   ├── /api/sync/status           # 同步状态
│   ├── /api/sync/quotes (POST)    # 触发行情同步
│   ├── /api/sync/financial (POST) # 触发财务同步
│   ├── /api/sync/limit-up (POST)  # 触发涨停同步
│   ├── /api/limit-up/today        # 今日涨停
│   ├── /api/limit-up/history      # 历史涨停
│   ├── /api/limit-up/stats        # 板块统计
│   ├── /api/strategy/:name        # 策略选股
│   └── /api/backtest (POST)       # 策略回测
└── 后台同步（启动时自动执行）
```

#### 策略评分体系

| 策略 | 维度 1 | 维度 2 | 维度 3 | 总分 |
|------|--------|--------|--------|------|
| 保守型 | PE 低 (35) | PB 低 (30) | 市值大 (35) | 100 |
| GARP | PEG 低 (40) | 净利润增速 (30) | 毛利率 (30) | 100 |
| 动量 | 净利润增速 (50) | 换手率适中 (50) | - | 100 |
| 潜力型 | 净利润增速 (50) | 毛利率 (30) | 市值 (20) | 100 |
| 涨停回马枪 | 涨停天数 (40) | 换手率 (30) | 净利润增速 (30) | 100 |
| 均线多头 | 涨跌幅 (40) | 换手率 (30) | 市值 (30) | 100 |

#### 涨停质量评分

```
calc_limit_up_score(row) 总分 100
├── 封板时间（越早越好）        30分
│   ├── 9:35 前封板       → 30
│   ├── 9:45 前封板       → 25
│   ├── 10:00 前封板      → 20
│   ├── 10:30 前封板      → 15
│   └── 之后封板          → 10
├── 封单金额                30分
│   ├── >5亿              → 30
│   ├── >2亿              → 25
│   ├── >1亿              → 20
│   ├── >5000万           → 15
│   └── ≤5000万           → 10
├── 换手率（适中最好）        20分
│   ├── 5%-20%            → 20
│   ├── 3%-25%            → 15
│   ├── 1%-30%            → 10
│   └── 其他              → 5
└── 连板数（越多越好）        20分
    ├── ≥5 连板            → 20
    ├── ≥3 连板            → 15
    ├── 2 连板             → 12
    └── 首板              → 8
```

#### Python 数据库操作封装

```python
def get_db():
    """获取 MySQL 连接（每次调用独立连接，自动关闭）"""
    return pymysql.connect(**DB_CONFIG, cursorclass=pymysql.cursors.DictCursor)

def query(sql, params=None):
    """查询多行，返回 [{dict}, ...]；失败返回 []"""

def query_one(sql, params=None):
    """查询单行，返回 dict 或 None"""

def execute(sql, params=None):
    """写操作，返回影响行数"""

def execute_many(sql, params_list):
    """批量写，每批 500 条"""
```

---

## 5. 数据库设计

数据库 `stock`，MySQL 8.4 InnoDB，utf8mb4。

### 业务表（Express → MySQL）

#### `users` — 用户表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT AUTO_INCREMENT PK | |
| username | VARCHAR(50) UNIQUE | 登录用户名（JWT 阶段添加） |
| password_hash | VARCHAR(255) | bcrypt 哈希 |
| role | ENUM('admin','user') | 权限角色 |
| device_id | VARCHAR(64) UNIQUE NOT NULL | 匿名设备标识 |
| last_login | DATETIME | 最后登录时间 |
| avatar_url | VARCHAR(255) | 头像 |
| created_at / updated_at | DATETIME | 时间戳 |

#### `watchlists` — 自选股

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT AUTO_INCREMENT PK | |
| user_id | INT FK → users | |
| symbol | VARCHAR(10) | 股票代码 |
| name | VARCHAR(100) | 股票名称 |
| market | ENUM('CN','US') | 市场 |
| sort_order | INT | 排序 |
| UNIQUE KEY | (user_id, symbol) | |

#### `custom_picks` — 自定义热门股

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT AUTO_INCREMENT PK | |
| user_id | INT FK → users | |
| symbol | VARCHAR(10) | |
| name | VARCHAR(100) | |
| market | ENUM('CN','US') | |
| sort_order | INT | |
| UNIQUE KEY | (user_id, symbol, market) | |

#### `portfolios` — 仓位管理

| 字段 | 类型 | 说明 |
|------|------|------|
| user_id | INT PK FK → users | |
| current_mode | ENUM('empty','light','heavy','short') | 当前模式 |
| year_stock_count | INT | 本年操作股数 |
| month_trade_count | INT | 本月交易次数 |
| current_holding | INT | 当前持仓数 |

#### `portfolio_actions` — 操作记录

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT AUTO_INCREMENT PK | |
| user_id | INT FK | |
| type | ENUM('buy','sell') | |
| symbol | VARCHAR(10) | |
| action_date | VARCHAR(10) | |

#### `backtest_records` — 回测记录

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT AUTO_INCREMENT PK | |
| user_id | INT FK | |
| strategy | VARCHAR(30) | |
| initial_capital | DECIMAL(12,2) | |
| period | INT | |
| total_return / annual_return | DECIMAL(8,2) | |
| max_drawdown / sharpe | DECIMAL | |
| result_json | JSON | 完整回测数据 |

#### `user_preferences` — 用户偏好

| 字段 | 类型 | 说明 |
|------|------|------|
| user_id | INT PK FK | |
| theme | ENUM('light','dark') | |
| default_market | ENUM('CN','US') | |

### 数据表（Python 微服务共用到 MySQL）

#### `stock_quote` — 全 A 股行情快照

| 字段 | 类型 | 说明 |
|------|------|------|
| symbol | VARCHAR(10) PK | 股票代码 |
| name | VARCHAR(50) | 名称 |
| price | DECIMAL(10,2) | 最新价 |
| change_percent | DECIMAL(6,2) | 涨跌幅 |
| pe | DECIMAL(10,2) | 市盈率 |
| pb | DECIMAL(10,2) | 市净率 |
| market_cap | DECIMAL(20,2) | 总市值 |
| turnover_rate | DECIMAL(6,2) | 换手率 |
| update_time | DATETIME | 更新时间 |
| INDEX | (market_cap), (pe) | |

预计数据量：5100+ 行（全 A 股），当前同步约 2399 只。

#### `financial_data` — 财务数据

| 字段 | 类型 | 说明 |
|------|------|------|
| symbol | VARCHAR(10) PK | |
| revenue | DECIMAL(20,2) | 营业收入 |
| cost | DECIMAL(20,2) | 营业成本 |
| net_profit | DECIMAL(20,2) | 净利润 |
| prev_net_profit | DECIMAL(20,2) | 上期净利润 |
| gp_margin | DECIMAL(6,2) | 毛利率 |
| np_growth | DECIMAL(6,2) | 净利润增速 |
| update_time | DATETIME | |

#### `limit_up_pool` — 涨停池

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT AUTO_INCREMENT PK | |
| date | VARCHAR(8) | 交易日期 YYYYMMDD |
| symbol | VARCHAR(10) | |
| name | VARCHAR(50) | |
| price | DECIMAL(10,2) | |
| change_percent | DECIMAL(6,2) | |
| turnover_rate | DECIMAL(6,2) | |
| limit_up_count | INT | 连板数 |
| seal_amount | DECIMAL(20,2) | 封单金额 |
| first_limit_time | VARCHAR(10) | 首次封板时间 HH:MM:SS |
| industry | VARCHAR(30) | 所属行业 |
| UNIQUE KEY | (date, symbol) | |

#### `limit_up_stats` — 涨停统计

| 字段 | 类型 | 说明 |
|------|------|------|
| date | VARCHAR(8) PK | |
| total_count | INT | 涨停总数 |
| industry_stats | JSON | 板块统计明细 |

### ER 图

```
┌─────────────┐     ┌──────────────┐     ┌──────────────────┐
│   users     │────▶│ watchlists   │     │ stock_quote      │
│ (id PK)     │     │ (user_id FK) │     │ (symbol PK)      │
├─────────────┤     └──────────────┘     └──────────────────┘
│ device_id   │     ┌──────────────┐     ┌──────────────────┐
│ username    │────▶│ custom_picks │     │ financial_data   │
│ password    │     │ (user_id FK) │     │ (symbol PK)      │
│ role        │     └──────────────┘     └──────────────────┘
└─────────────┘     ┌──────────────┐     ┌──────────────────┐
       │            │ portfolios   │     │ limit_up_pool    │
       │           │ (user_id FK) │     │ (date+symbol UK) │
       │            └──────────────┘     └──────────────────┘
       ▼            ┌──────────────┐     ┌──────────────────┐
┌─────────────┐     │ portfolio_   │     │ limit_up_stats   │
│ user_pref   │     │ actions      │     │ (date PK)        │
│ (user_id)   │     │ (user_id FK) │     └──────────────────┘
└─────────────┘     └──────────────┘
       │            ┌──────────────┐
       │           │ backtest_    │
       │           │ records      │
       │           │ (user_id FK) │
       │            └──────────────┘
```

---

## 6. Redis 缓存策略

### 双层架构

```
Express (ioredis)                Python (redis-py)
 ┌──────────────────┐            ┌──────────────────┐
 │ 行情/搜索/AI/策略   │            │ 策略结果           │
 │ express:strategy:*│            │ python:strategy:* │
 └──────────────────┘            └──────────────────┘
         │                               │
         ▼                               ▼
 ┌──────────────────────────────────────────┐
 │              Redis 服务器                   │
 │  所有缓存键独立前缀，无冲突                   │
 └──────────────────────────────────────────┘
```

### 缓存一致性

- Express `getOrFetch` 使用 `cache.js` 的通用模式
- Python `get_or_fetch_cache` 独立实现但逻辑相同
- **键隔离**：Express 用 `express:strategy:*`，Python 用 `python:strategy:*`，防止格式冲突
- **缓存失效**：Python 行情同步完成后自动 `invalidate_cache('strategy:*')`
- **自动降级**：Redis 不可用时，Express 降级到内存 Map，Python 跳过缓存

---

## 7. 前端架构

### 项目结构

```
client/
├── index.html              # 入口
├── vite.config.js          # Vite 配置（开发代理 :3000）
├── package.json            # Vue 3 + Axios + Vite
└── src/
    ├── main.js             # Vue 应用入口
    ├── App.vue             # 主组件（所有逻辑）
    ├── style.css           # 全局样式（双主题）
    ├── api/
    │   ├── stock.js        # 行情/搜索/AI/策略 API 封装
    │   └── user.js         # 用户数据 API 封装
    ├── utils/
    │   └── indicators.js   # 技术指标计算（MACD/RSI/KDJ/MA/BOLL）
    └── components/
        ├── AIHealthCheck.vue        # AI 健康检查面板
        ├── BacktestPanel.vue        # 策略回测面板
        ├── HistoryChart.vue         # SVG 走势图
        ├── LimitUpPanel.vue         # 涨停板面板
        ├── LoginDialog.vue          # 登录/注册对话框
        ├── PositionManager.vue      # 仓位管理面板
        ├── RiskCheck.vue            # AI 风险评估
        ├── SignalAlert.vue          # AI 买卖预警
        ├── StrategyPanel.vue        # 策略选股面板
        ├── TechnicalIndicators.vue  # 技术指标面板
        └── TradingRules.vue         # 交易规则面板
```

### 组件树

```
App.vue (根组件)
├── <header> 导航栏
│   ├── 标题 + 市场切换 (A股/美股)
│   ├── 登录按钮 / 已登录用户名
│   └── 主题切换 (🌙/☀️)
├── <nav> 顶部 Tab 栏
│   └── mainTabs: [行情, 策略, 涨停, 回测, 仓位, 体检, 信号, 指标, 规则]
├── <main> 内容区
│   ├── Tab: 行情 → 搜索 + 走势图(HistoryChart)
│   ├── Tab: 策略 → StrategyPanel
│   ├── Tab: 涨停 → LimitUpPanel
│   ├── Tab: 回测 → BacktestPanel
│   ├── Tab: 仓位 → PositionManager
│   ├── Tab: 体检 → AIHealthCheck
│   ├── Tab: 信号 → SignalAlert + RiskCheck
│   ├── Tab: 指标 → TechnicalIndicators
│   └── Tab: 规则 → TradingRules
└── <LoginDialog> (模态框)
```

### API 封装 (`client/src/api/stock.js`)

```javascript
// 行情
fetchUSStock(symbol)           // GET /api/stock/us/:symbol
fetchUSHistory(symbol)         // GET /api/stock/us/:symbol/history
fetchCNStock(symbol)           // GET /api/stock/cn/:symbol
fetchCNHistory(symbol)         // GET /api/stock/cn/:symbol/history

// 搜索
searchUS(keyword)              // GET /api/search/us/:keyword
searchCN(keyword)              // GET /api/search/cn/:keyword

// 涨停
fetchLimitUpToday()            // GET /api/limit-up/today
fetchLimitUpCheck(symbol)      // GET /api/limit-up/check/:symbol

// 策略
fetchStrategyConservative()    // GET /api/strategy/conservative
fetchStrategyGarp()            // GET /api/strategy/garp
fetchStrategyMomentum()        // GET /api/strategy/momentum
fetchStrategyPotential()       // GET /api/strategy/potential
fetchStrategyLimitback()       // GET /api/strategy/limitback
fetchStrategyMaBullish()       // GET /api/strategy/ma-bullish

// 回测
runBacktest(strategy, capital, period)  // POST /api/backtest
```

### 双主题实现 (`style.css`)

CSS 变量驱动，所有颜色定义在 `:root`（浅色）和 `[data-theme="dark"]`（深色）：

```css
:root {
  --bg-primary: #f0f2f5;
  --bg-card: #ffffff;
  --text-primary: #1a1a2e;
  --text-secondary: #555;
  --accent: #4a90d9;
  --up: #e74c3c;    /* A股红涨 */
  --down: #27ae60;  /* A股绿跌 */
  /* ... */
}

[data-theme="dark"] {
  --bg-primary: #0a0e1a;
  --bg-card: #141a2e;
  --text-primary: #e0e0e0;
  --text-secondary: #8892b0;
  --accent: #64ffda;
  --up: #ff4757;
  --down: #2ed573;
  /* ... */
}
```

---

## 8. API 端点全表

### 行情 API

| 方法 | 路径 | 说明 | 缓存 | 限流 |
|------|------|------|------|------|
| GET | `/api/stock/us/:symbol` | 美股实时行情 | 30s | 60rpm |
| GET | `/api/stock/us/:symbol/history` | 美股 K 线 | 5min | 60rpm |
| GET | `/api/search/us/:keyword` | 美股搜索 | 1h | 30rpm |
| GET | `/api/stock/cn/:symbol` | A股实时行情 | 30s | 60rpm |
| GET | `/api/stock/cn/:symbol/history` | A股 K 线 | 5min | 60rpm |
| GET | `/api/stock/cn/:symbol/auto-fill` | 换手率+跌幅填充 | 5min | 60rpm |
| GET | `/api/search/cn/:keyword` | A股搜索 | 1h | 30rpm |

### 涨停 API

| 方法 | 路径 | 说明 | 缓存 | 限流 |
|------|------|------|------|------|
| GET | `/api/limit-up/today` | 今日涨停 | 60s | 60rpm |
| GET | `/api/limit-up/history?date=` | 历史涨停 | 1h | 60rpm |
| GET | `/api/limit-up/stats?date=` | 板块统计 | 5min | 60rpm |
| GET | `/api/limit-up/check/:symbol` | 个股涨停历史 | 5min | 60rpm |
| GET | `/api/limit-up/analysis` | AI 涨停分析 | 1h | Token+配额 |

### AI API

| 方法 | 路径 | 说明 | 缓存 | 防护 |
|------|------|------|------|------|
| POST | `/api/ai/health-check` | AI 健康检查 | 1h | Token + 配额 + 20rpm |
| POST | `/api/ai/signal-analysis` | AI 买卖信号 | 1h | Token + 配额 + 20rpm |

### 策略 API

| 方法 | 路径 | 说明 | 缓存 |
|------|------|------|------|
| GET | `/api/strategy/conservative` | 保守型策略 | 30min |
| GET | `/api/strategy/garp` | GARP 均衡策略 | 30min |
| GET | `/api/strategy/momentum` | 动量策略 | 30min |
| GET | `/api/strategy/potential` | 潜力型策略 | 30min |
| GET | `/api/strategy/limitback` | 涨停回马枪 | 30min |
| GET | `/api/strategy/ma-bullish` | 均线多头 | 30min |
| POST | `/api/backtest` | 策略回测 | 不缓存 |

### 认证 API

| 方法 | 路径 | 说明 | 防护 |
|------|------|------|------|
| POST | `/api/auth/register` | 注册 | bcrypt 哈希 |
| POST | `/api/auth/login` | 登录 | bcrypt 验证 |
| POST | `/api/auth/refresh` | 刷新 Token | JWT 验证 |
| GET | `/api/auth/me` | 用户信息 | JWT 验证 |

### 用户数据 API

| 方法 | 路径 | 说明 | 防护 |
|------|------|------|------|
| GET | `/api/user/watchlist` | 自选股列表 | X-Device-ID |
| POST | `/api/user/watchlist` | 添加自选股 | X-Device-ID |
| DELETE | `/api/user/watchlist/:symbol` | 删除自选股 | X-Device-ID |
| PUT | `/api/user/watchlist/reorder` | 排序 | X-Device-ID |
| GET | `/api/user/picks` | 自定义热门股 | X-Device-ID |
| POST | `/api/user/picks` | 添加热门股 | X-Device-ID |
| DELETE | `/api/user/picks/:id` | 删除热门股 | X-Device-ID |
| PUT | `/api/user/picks/reorder` | 排序 | X-Device-ID |
| GET | `/api/user/portfolio` | 仓位管理 | X-Device-ID |
| POST | `/api/user/portfolio` | 更新仓位 | X-Device-ID |
| POST | `/api/user/portfolio/action` | 操作记录 | X-Device-ID |
| DELETE | `/api/user/portfolio/action/:id` | 删除操作 | X-Device-ID |
| GET | `/api/user/backtests` | 回测历史 | X-Device-ID |
| POST | `/api/user/backtests` | 保存回测 | X-Device-ID |
| GET | `/api/user/preferences` | 用户偏好 | X-Device-ID |
| PUT | `/api/user/preferences` | 更新偏好 | X-Device-ID |

### Python 微服务 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查（含 MySQL/Redis/同步状态） |
| GET | `/api/sync/status` | 同步状态 |
| POST | `/api/sync/quotes` | 触发行情同步 |
| POST | `/api/sync/financial` | 触发财务同步 |
| POST | `/api/sync/limit-up?date=` | 触发涨停同步 |
| GET | `/api/limit-up/today` | 今日涨停（含评分） |
| GET | `/api/limit-up/history?date=` | 历史涨停 |
| GET | `/api/limit-up/stats?date=` | 板块统计 |
| GET | `/api/strategy/:name` | 策略选股（Redis 缓存） |
| POST | `/api/backtest` | 策略回测 |

### 系统 API

| 方法 | 路径 | 说明 | 防护 |
|------|------|------|------|
| GET | `/api/health` | Express 健康检查 | 无 |
| GET | `/api/sync/status` | Python 同步状态 | 无 |

---

## 9. 数据流详解

### 美股行情查询流程

```
用户输入 "AAPL"
  │
  ├─① 前端: searchUS("AAPL") → GET /api/search/us/AAPL
  │     ↓
  ├─② Express: getOrFetch('search:us:AAPL', fetchFn, 3600)
  │     ├─ 先查 Redis → 有缓存？直接返回
  │     └─ 无缓存 ↓
  │     ├─ 内置 80+ 热门股匹配 → "AAPL"
  │     └─ 匹配失败 → 新浪 suggest3 API
  │     └─ 写入 Redis (1h TTL)
  │     ↓
  ├─③ 用户选择 "AAPL"，前端调用 fetchUSStock("AAPL")
  │     ↓
  ├─④ Express: getOrFetch('stock:us:AAPL', fetchFn, 30)
  │     ├─ Redis 缓存？有→返回
  │     └─ 无 → 请求 sinajs.cn/list=gb_aapl (GBK解码) → 解析字段
  │     └─ 写入 Redis (30s TTL)
  │     ↓
  └─⑤ 前端渲染：名称、价格、涨跌幅、涨跌额、最高/最低、成交量
```

### 策略选股流程

```
用户点击"保守型" Tab
  │
  ├─① 前端: fetchStrategyConservative() → GET /api/strategy/conservative
  │     ↓
  ├─② Express proxyToPython('/api/strategy/conservative')
  │     ↓
  ├─③ Python: get_or_fetch_cache('python:strategy:conservative', fetchFn, 1800)
  │     ├─ Redis 有缓存 → 直接返回
  │     └─ 无缓存 ↓
  │     ├─ 查 MySQL stock_quote: PE>0 PE<15 PB>0 PB<3 市值>200亿
  │     ├─ 评分排序 (PE低35分 + PB低30分 + 市值大35分)
  │     ├─ 写入 Redis (30min TTL)
  │     └─ 返回 {results: [...], elapsed: 0.023}
  │     ↓
  ├─④ Express: getOrFetch('express:strategy:conservative', proxyToPython, 1800)
  │     └─ 写入 Redis express:strategy:conservative (30min TTL)
  │     ↓
  └─⑤ 前端渲染：排名、代码、名称、PE、PB、市值、评分
```

### 涨停数据流（降级链）

```
GET /api/limit-up/today
  │
  ├─① Express: getOrFetch('limitup:today', fetchFn, 60)
  │     ├─ Redis 有缓存？→ 返回
  │     └─ 无缓存 ↓
  ├─② 降级链：
  │     ├─ 首选：Python 微服务 → AKShare 东方财富涨停池
  │     │   └─ 有数据？→ 返回评分结果
  │     ├─ 降级1：东方财富 HTTP API（push2ex.eastmoney.com）
  │     │   └─ 有数据？→ 解析 pool 列表
  │     └─ 降级2：新浪全A股接口筛选涨≥9.9%
  │         └─ 完成降级链
  └─③ 写入 Redis (60s TTL) → 返回标准化响应
```

### 用户数据双写策略

```
用户添加自选股 "AAPL"
  │
  ├─① 前端：立即写入 localStorage
  │     └─ UI 响应（用户感知为瞬间完成）
  │
  ├─② 异步: addWatchlist("AAPL", ...) → POST /api/user/watchlist
  │     ├─ X-Device-ID 头
  │     ├─ Express: resolveUser → getOrCreateUser(deviceId)
  │     │     ├─ MySQL 连接正常 → INSERT watchlists
  │     │     └─ MySQL 不可用 → 静默失败（前端无感知）
  │     └─ 返回 {success: true}
  │
  └─③ 前端忽略结果（不依赖 API 响应）
        └─ 即使用户离线，功能不受影响
```

---

## 10. 部署指南

### 环境要求

- **Node.js**: ≥18
- **Python**: ≥3.10
- **MySQL**: 8.4
- **Redis**: 7+ (RESP2 兼容)
- **服务器**: 阿里云 CentOS/Ubuntu

### 环境变量

```bash
# Express 服务
PORT=3000                          # 服务端口
DEEPSEEK_API_KEY=sk-xxx           # DeepSeek API Key
API_TOKEN=your-custom-token       # API 鉴权 Token
JWT_SECRET=your-jwt-secret        # JWT 签名密钥
JWT_EXPIRES_IN=7d                 # JWT 有效期
HTTPS_PROXY=http://127.0.0.1:7890 # HTTP 代理
HTTP_PROXY=http://127.0.0.1:7890  # HTTP 代理

# MySQL
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=stockuser
DB_PASSWORD=stock2024
DB_NAME=stock

# Redis
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=
```

### 部署步骤

```bash
# 1. 安装依赖
npm run install:all
pip install -r python/requirements.txt

# 2. 初始化数据库
mysql -u stockuser -p stock < server/schema.sql

# 3. 构建前端
npm run build

# 4. 确保基础设施运行
redis-server --daemonize yes
mysqld --defaults-file=/etc/my.cnf

# 5. 启动 Python 微服务
cd python
nohup python api.py > python.log 2>&1 &

# 6. 启动 Express 服务
cd ..
nohup node server/index.js > server.log 2>&1 &

# 7. 访问 http://localhost:3000
```

### deploy.py 说明

项目根目录的 `deploy.py` 是自动化部署脚本（本地→阿里云），功能包括：
- 构建前端 (`npm run build`)
- 上传 `client/dist/` 到服务器
- 上传 `server/index.js` 到服务器
- SSH 自动重启服务

---

## 11. 开发指南

### 快速启动

```bash
# 1. 启动基础设施
redis-server
"/c/Program Files/MySQL/MySQL Server 8.4/bin/mysqld" --defaults-file=/d/MySQL/my.cnf

# 2. 启动 Python 微服务
cd python
python api.py

# 3. 启动 Express + Vite（另一个终端）
npm run dev
# 前端 http://localhost:5173, API http://localhost:3000
```

### 项目命令

```bash
# 开发（Express + Vite 并行）
npm run dev

# 仅启动 Express
npm run dev:server

# 仅启动 Vite
npm run dev:client

# 生产构建
npm run build

# 生产启动（构建 + 启动）
npm run start

# 安装所有依赖
npm run install:all
```

### 技术指标 (`client/src/utils/indicators.js`)

内置计算函数：

| 函数 | 说明 |
|------|------|
| `calcMACD(data)` | MACD (12,26,9) |
| `calcRSI(data, period)` | RSI (6/12/24) |
| `calcKDJ(data)` | KDJ (9,3,3) |
| `calcMA(data, period)` | 移动平均线 |
| `calcBOLL(data, period)` | 布林带 (20) |

---

## 12. 启动顺序

```
┌─────────────────────────────────────────────────────────┐
│                    启动顺序（必须）                       │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  1. Redis ─────────────────> 端口 6379                  │
│     redis-server                                        │
│                                                         │
│  2. MySQL ────────────────> 端口 3306                   │
│     mysqld --defaults-file=...                          │
│                                                         │
│  3. Python 微服务 ─────────> 端口 3081                  │
│     cd python && python api.py                          │
│     ├─ 验证 MySQL + Redis 连接                          │
│     ├─ 后台同步线程启动                                  │
│     │   ├─ 全 A 股行情 → MySQL（~2399 只）              │
│     │   ├─ 近 5 天涨停 → MySQL                          │
│     │   └─ 前 200 只财务 → MySQL                        │
│     └─ 策略结果写入 Redis 缓存                           │
│                                                         │
│  4. Express 后端 ──────────> 端口 3000                  │
│     node server/index.js                                │
│     ├─ 连接 Redis + 内存降级                             │
│     ├─ 连接 MySQL + 自动降级                             │
│     ├─ 托管前端静态文件 (client/dist)                    │
│     └─ 所有路由就绪                                      │
│                                                         │
│  5. Vite 前端 (开发) ──────> 端口 5173                 │
│     cd client && npx vite --host                        │
│     └─ 代理 /api → localhost:3000                      │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 13. 附录：关键文件清单

### 后端 (server/)

| 文件 | 行数 | 职责 |
|------|------|------|
| `index.js` | ~1295 | 主入口、行情路由、涨停路由、AI 路由、策略代理 |
| `cache.js` | ~173 | Redis + 内存双层缓存 |
| `db.js` | ~139 | MySQL 连接池、CRUD 辅助 |
| `schema.sql` | ~140 | 全部 11 张表的 DDL |
| `middleware/auth.js` | ~192 | Token/JWT 鉴权 + Rate Limiting + 配额管理 |
| `routes/auth.js` | ~186 | 注册/登录/Token 刷新/用户信息 |
| `routes/user.js` | ~274 | 自选股/热门股/仓位/回测/偏好 CRUD |

### Python 微服务 (python/)

| 文件 | 行数 | 职责 |
|------|------|------|
| `api.py` | ~1210 | Flask 微服务：同步/策略/涨停/回测 |
| `requirements.txt` | 4 | pymysql, redis, flask, flask-cors, akshare |

### 前端 (client/src/)

| 文件 | 行数 | 职责 |
|------|------|------|
| `App.vue` | 大 | 根组件，9 个 Tab 的完整 UI |
| `style.css` | 大 | 全局样式，双主题 CSS 变量 |
| `api/stock.js` | ~114 | 行情/搜索/AI/策略 API 封装 |
| `api/user.js` | ~91 | 用户数据 API 封装 |
| `utils/indicators.js` | - | MACD/RSI/KDJ/MA/BOLL 计算 |
| `components/HistoryChart.vue` | - | SVG K 线走势图 |
| `components/StrategyPanel.vue` | - | 6 种策略选股面板 |
| `components/LimitUpPanel.vue` | - | 涨停板面板 |
| `components/LoginDialog.vue` | - | 登录/注册对话框 |
| `components/PositionManager.vue` | - | 仓位管理 |

### 配置文件

| 文件 | 说明 |
|------|------|
| `package.json` | 根包配置，concurrently 并行启动 |
| `client/package.json` | Vue 3 + Vite + Axios |
| `client/vite.config.js` | Vite 配置，开发代理到 :3000 |

---

*文档自动生成于 2026-06-10，基于 stock-viewer 项目代码。*
