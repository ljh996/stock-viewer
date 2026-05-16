# stock-viewer 项目说明

## 项目结构
- `D:\agentAIdemo\stock-viewer\stock-viewer` — 项目根目录
- `server/index.js` — Express 后端 (端口 3000)
- `client/` — Vue 3 + Vite 前端 (开发端口 5173)
- `python/api.py` — Python AkShare 微服务 (端口 3081，未运行)

## 本地配置（敏感信息）
创建 `local-config.ps1`（已加入 .gitignore，不会上传），写入：

```powershell
$env:DEEPSEEK_API_KEY = "你的DeepSeek Key"
$env:DEPLOY_HOST = "你的服务器IP"
$env:DEPLOY_USER = "root"
$env:DEPLOY_PASSWORD = "你的服务器密码"
```

启动/部署时自动加载：
```powershell
# 方式1：手动加载
. ./local-config.ps1
node server/index.js

# 方式2：deploy.py 会自动读取 local-config.ps1
python deploy.py
```

## 本地启动
```powershell
# 后端 (带代理用于访问外网API)
cd D:\agentAIdemo\stock-viewer\stock-viewer\server
$env:HTTPS_PROXY="http://127.0.0.1:7890"
$env:HTTP_PROXY="http://127.0.0.1:7890"
node index.js

# 前端 (另一个终端)
cd D:\agentAIdemo\stock-viewer\stock-viewer\client
npx vite --host 0.0.0.0 --port 5173
```

## 生产部署 (阿里云)
- 域名: https://stock.matchamind.xyz
- PM2 管理: `pm2 start server/index.js --name stock-viewer`
- 项目路径: `/var/www/stock-viewer`
- Nginx 反代: 80/443 → 127.0.0.1:3000

## 已完成功能
- 涨停分析板块 (已修复Python不可用时的降级)
- 技术指标 (MACD/RSI/均线/布林带)
- A股/美股行情查询
- 策略选股面板
- httpGet 直连→代理自动降级
- 统计卡片点击展示具体涨停股 (价格分组钻取)
- DeepSeek AI 市场情绪分析 (/api/limit-up/analysis)
- DeepSeek AI 分析 (环境变量: DEEPSEEK_API_KEY)

## 待处理
- [ ] Python AkShare 微服务未运行

## 注意事项
- 后端外网API需代理: `HTTPS_PROXY=http://127.0.0.1:7890` (Sina/东方财富在国内可直连)
- GitHub 443端口被封，git push需开VPN
