# 股票行情查看器 📈

> Vue 3 + Express + MySQL + Redis + Python(AKShare) 全栈股票行情应用
> 生产地址：https://stock.matchamind.xyz

## 功能概览

| 功能 | 说明 |
|------|------|
| 🇺🇸 **美股行情** | 新浪财经实时报价（80+ 热门股），30s 缓存 |
| 🇨🇳 **A股行情** | 新浪财经实时报价（内置搜索），30s 缓存 |
| 📊 **K 线走势** | 近 30 日 OHLCV 走势图 + MACD/RSI/KDJ/BOLL |
| ⭐ **自选股** | 收藏管理 + MySQL 持久化 + localStorage 降级 |
| 🎯 **策略选股** | 6 种量化策略（MySQL 查询 + 评分排序 + Redis 缓存） |
| 🚀 **涨停板** | 今日涨停 + 历史查询 + 板块统计 + 质量评分 |
| 🤖 **AI 分析** | DeepSeek 驱动：健康检查 / 买卖信号 / 涨停情绪 |
| 🔐 **安全防护** | API Token + JWT 登录 + Rate Limiting + 配额管理 |
| 📋 **仓位管理** | 空仓/轻仓/重仓/短线 + 操作记录 |
| 📉 **回测模拟** | 蒙特卡洛模拟 + 权益曲线 / Sharpe / 最大回撤 |

## 快速开始

```bash
# 1. 安装依赖
npm run install:all

# 2. 初始化数据库
mysql -u stockuser -p stock < server/schema.sql

# 3. 启动基础设施（需先安装 Redis 和 MySQL）
redis-server
# ... 启动 MySQL

# 4. 启动 Python 微服务
cd python && python api.py &

# 5. 启动开发环境
npm run dev
# 前端 http://localhost:5173
# API  http://localhost:3000
```

## 技术栈

```
Frontend:    Vue 3 + Vite + Axios + 纯 CSS（双主题）
Backend:     Express 4 + ioredis + mysql2 + jsonwebtoken
Microservice: Python 3 + Flask + AKShare + pymysql + redis-py
Database:    MySQL 8.4 (InnoDB, 11 张表)
Cache:       Redis 7+ (RESP2, 自动降级到内存)
AI:          DeepSeek Chat API
Data:        新浪财经 + 东方财富 + 腾讯 + AKShare
```

## 项目结构

```
stock-viewer/
├── server/                  # Express 后端
│   ├── index.js             # 主入口 (~1295 行)
│   ├── cache.js             # Redis + 内存双缓存
│   ├── db.js                # MySQL 连接池
│   ├── schema.sql           # 11 张表 DDL
│   ├── middleware/
│   │   └── auth.js          # Token/JWT/RateLimit/配额
│   └── routes/
│       ├── auth.js          # 注册/登录/刷新
│       └── user.js          # 用户数据 CRUD
├── client/                  # Vue 3 前端
│   ├── src/
│   │   ├── App.vue          # 主组件 + 9 个 Tab
│   │   ├── style.css        # 双主题全局样式
│   │   ├── api/             # API 封装
│   │   ├── utils/           # 技术指标计算
│   │   └── components/      # 11 个功能组件
│   └── vite.config.js
├── python/                  # Python 微服务
│   ├── api.py               # Flask 服务 (~1210 行)
│   └── requirements.txt
├── deploy.py                # 阿里云自动部署
└── TECHINCAL_DOCS.md        # 完整技术文档 ← 点这里
```

## API 概览

| 端点 | 说明 | 缓存 |
|------|------|------|
| `GET /api/stock/us/:symbol` | 美股实时行情 | 30s |
| `GET /api/stock/cn/:symbol` | A股实时行情 | 30s |
| `GET /api/stock/:mkt/:symbol/history` | K 线数据 | 5min |
| `GET /api/strategy/:name` | 策略选股(6种) | 30min |
| `GET /api/limit-up/today` | 今日涨停 | 60s |
| `GET /api/limit-up/analysis` | AI 涨停分析 | 1h |
| `POST /api/ai/health-check` | AI 健康检查 | 1h |
| `POST /api/ai/signal-analysis` | AI 买卖信号 | 1h |
| `POST /api/auth/login` | JWT 登录 | - |
| `GET/POST/PUT/DELETE /api/user/*` | 用户数据 CRUD | - |

完整 API 文档见 **[TECHNICAL_DOCS.md → 第8节 API 端点全表](TECHNICAL_DOCS.md#8-api-端点全表)**

## 部署

```bash
# 生产构建
npm run build

# 部署到阿里云
python deploy.py
```

**详细信息**：[部署指南](TECHNICAL_DOCS.md#10-部署指南)

## 数据库

MySQL 8.4，数据库 `stock`，11 张 InnoDB 表：

| 表 | 用途 |
|------|------|
| `users` | 用户 + JWT |
| `watchlists` | 自选股 |
| `custom_picks` | 自定义热门股 |
| `portfolios` | 仓位管理 |
| `portfolio_actions` | 操作记录 |
| `backtest_records` | 回测记录 |
| `user_preferences` | 偏好设置 |
| `stock_quote` | A 股行情快照 (~2400 只) |
| `financial_data` | 财务数据 |
| `limit_up_pool` | 涨停池 |
| `limit_up_stats` | 涨停统计 |

## 技术文档

内容详解请查阅 **[TECHNICAL_DOCS.md](TECHNICAL_DOCS.md)**，包含：

1. [项目概览](TECHNICAL_DOCS.md#1-项目概览)
2. [系统架构](TECHNICAL_DOCS.md#2-系统架构) — 完整架构图
3. [数据源](TECHNICAL_DOCS.md#3-数据源) — 所有外部接口
4. [后端架构](TECHNICAL_DOCS.md#4-后端架构) — 每个模块详解
5. [数据库设计](TECHNICAL_DOCS.md#5-数据库设计) — 11 张表 + ER 图
6. [Redis 缓存策略](TECHNICAL_DOCS.md#6-redis-缓存策略) — 双层缓存 + 键隔离
7. [前端架构](TECHNICAL_DOCS.md#7-前端架构) — 组件树 + API 封装
8. [API 端点全表](TECHNICAL_DOCS.md#8-api-端点全表) — 37+ 个端点完整参考
9. [数据流详解](TECHNICAL_DOCS.md#9-数据流详解) — 4 个核心数据流
10. [部署指南](TECHNICAL_DOCS.md#10-部署指南) — 完整部署步骤
11. [开发指南](TECHNICAL_DOCS.md#11-开发指南) — 快速启动 + 命令列表
12. [启动顺序](TECHNICAL_DOCS.md#12-启动顺序) — 5 步启动顺序图
13. [关键文件清单](TECHNICAL_DOCS.md#13-附录关键文件清单) — 文件行数 + 职责

## 注意

- 美股数据来自新浪免费 `gb_` 接口，非交易日无数据
- AI 分析使用 DeepSeek API，需自行配置 `DEEPSEEK_API_KEY`
- 所有数据仅供参考，不构成投资建议
- 更多详情见 [TECHNICAL_DOCS.md](TECHNICAL_DOCS.md)
