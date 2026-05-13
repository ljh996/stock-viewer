# 股票行情查看器

Vue3 + Express 全栈股票数据获取应用。

## 功能特性

- 🇺🇸 **美股行情**：通过 stockprices.dev 获取实时报价
- 🇨🇳 **A股行情**：通过新浪财经获取实时报价（沪市/深市）
- 📊 **历史走势图**：SVG 折线图展示近30日走势
- 📋 **历史数据明细**：每日 OHLCV 数据表格
- ⭐ **自选股管理**：收藏股票，localStorage 持久化，一键刷新
- 🔍 **热门股票快捷按钮**：一键查看热门股票

## 技术栈

- **前端**：Vue 3 + Vite + 纯 CSS（无 UI 库依赖）
- **后端**：Express.js（API 代理层，解决 CORS）
- **数据源**：
  - 美股实时行情：stockprices.dev（免费，无需 API Key）
  - 美股历史数据：Twelve Data（免费 demo key）
  - A股实时行情：新浪财经（免费，无需 API Key）
  - A股历史数据：新浪财经（免费，无需 API Key）

## 快速开始

```bash
# 1. 安装依赖
npm run install:all

# 2. 启动开发环境（同时启动前后端）
npm run dev

# 3. 打开浏览器访问
# 前端：http://localhost:5173
# 后端 API：http://localhost:3000
```

## 项目结构

```
stock-viewer/
├── server/
│   └── index.js          # Express 后端（API 代理）
├── client/
│   ├── index.html         # 入口 HTML
│   ├── vite.config.js     # Vite 配置（含 proxy）
│   ├── src/
│   │   ├── main.js        # Vue 入口
│   │   ├── App.vue        # 主组件
│   │   ├── style.css      # 全局样式
│   │   ├── api/
│   │   │   └── stock.js   # API 请求封装
│   │   └── components/
│   │       └── HistoryChart.vue  # 走势图组件
│   └── package.json
└── package.json           # 根配置（含 concurrently）
```

## API 端点

| 端点 | 说明 |
|------|------|
| `GET /api/stock/us/:symbol` | 美股实时行情 |
| `GET /api/stock/us/:symbol/history` | 美股近30天历史 |
| `GET /api/stock/cn/:symbol` | A股实时行情 |
| `GET /api/stock/cn/:symbol/history` | A股近30天历史 |

## 生产部署

```bash
# 构建前端 + 启动生产服务器
npm run start
# 访问 http://localhost:3000
```

## 注意事项

- 美股数据来源 stockprices.dev 免费版不包含成交量(volume)字段
- A股数据来自新浪财经，返回 GBK 编码，后端自动转换为 UTF-8
- 所有数据仅供参考，不构成投资建议
