const express = require('express')
const cors = require('cors')
const iconv = require('iconv-lite')
const https = require('https')
const http = require('http')
const { URL } = require('url')
const net = require('net')
const tls = require('tls')
const path = require('path')
const { initCache, getOrFetch } = require('./cache')
const { initDB } = require('./db')
const userRoutes = require('./routes/user')
const authRoutes = require('./routes/auth')
const { requireToken, createRateLimiter, checkTokenQuota } = require('./middleware/auth')

const app = express()
const PORT = 3000

app.use(cors())
app.use(express.json())

// 用户数据 API（MySQL 持久化）
app.use('/api/user', userRoutes)

// 用户认证 API（JWT 注册/登录）
app.use('/api/auth', authRoutes)

// 阶段 1: API Token 保护 AI 接口（防刷 DeepSeek 额度）
app.use('/api/ai', requireToken)

// 阶段 3: Rate Limiting（在 Token 验证之后）
// AI 接口限流：每分钟 20 次
const aiRateLimit = createRateLimiter({ windowMs: 60 * 1000, max: 20, prefix: 'ratelimit:ai:' })
const quoteRateLimit = createRateLimiter({ windowMs: 60 * 1000, max: 60, prefix: 'ratelimit:quote:' })
const searchRateLimit = createRateLimiter({ windowMs: 60 * 1000, max: 30, prefix: 'ratelimit:search:' })

app.use('/api/ai', aiRateLimit)
app.use('/api/limit-up/analysis', aiRateLimit)
app.use('/api/stock', quoteRateLimit)
app.use('/api/search', searchRateLimit)
app.use('/api/limit-up/today', quoteRateLimit)

// Token 每日配额检查（在 requireToken 之后，统计 AI 接口每日调用次数）
app.use('/api/ai', checkTokenQuota)
app.use('/api/limit-up/analysis', checkTokenQuota)

// /api/limit-up/analysis 也调 DeepSeek，单独保护
app.use('/api/limit-up/analysis', requireToken)

// 生产环境：托管前端静态文件
app.use(express.static(path.join(__dirname, '../client/dist')))

// ==================== 通用 HTTP 请求函数（支持代理） ====================
function getProxyUrl() {
  return process.env.HTTPS_PROXY || process.env.HTTP_PROXY ||
    process.env.https_proxy || process.env.http_proxy
}

function isInternalHost(hostname) {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '0.0.0.0'
}

function makeRequest(urlStr, options = {}, useProxy = false) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr)
    const isHttps = url.protocol === 'https:'
    const client = isHttps ? https : http

    const requestOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
        'Accept-Encoding': 'identity',
        ...(options.headers || {}),
      },
      timeout: options.timeout || 10000,
    }

    if (useProxy) {
      const proxyUrlStr = getProxyUrl()
      if (proxyUrlStr && !isInternalHost(url.hostname)) {
        const proxyUrl = new URL(proxyUrlStr)
        if (isHttps) {
          // CONNECT 隧道
          const agent = new https.Agent()
          agent.createConnection = (opts, cb) => {
            const socket = net.connect(parseInt(proxyUrl.port) || 7890, proxyUrl.hostname)
            socket.setTimeout(options.timeout || 10000)
            socket.once('connect', () => {
              socket.write(`CONNECT ${url.hostname}:${url.port || 443} HTTP/1.1\r\nHost: ${url.hostname}:${url.port || 443}\r\n\r\n`)
            })
            let buf = ''
            const onData = (data) => {
              buf += data.toString()
              if (buf.includes('\r\n\r\n')) {
                socket.removeListener('data', onData)
                if (buf.includes('200')) {
                  cb(null, socket)
                } else {
                  socket.destroy()
                  cb(new Error('代理 CONNECT 失败'))
                }
              }
            }
            socket.on('data', onData)
            socket.on('error', cb)
            socket.on('timeout', () => { socket.destroy(); cb(new Error('代理连接超时')) })
          }
          requestOptions.agent = agent
        } else {
          // HTTP 通过代理
          requestOptions.hostname = proxyUrl.hostname
          requestOptions.port = parseInt(proxyUrl.port) || 7890
          requestOptions.path = urlStr
          requestOptions.headers.Host = url.hostname
        }
      }
    }

    const req = client.request(requestOptions, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        const buf = Buffer.concat(chunks)
        let body = options.encoding === 'gbk' ? iconv.decode(buf, 'gbk') : buf.toString('utf-8')
        resolve({ ok: true, body })
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')) })
    req.end()
  })
}

function httpGet(urlStr, options = {}) {
  // 先尝试直连，如果失败则通过代理重试
  return makeRequest(urlStr, options, false).catch((directErr) => {
    const proxyUrlStr = getProxyUrl()
    if (proxyUrlStr && !isInternalHost(new URL(urlStr).hostname)) {
      console.log(`直连失败，尝试通过代理: ${directErr.message}`)
      return makeRequest(urlStr, options, true)
    }
    throw directErr
  })
}

// 带超时控制的请求（用于降级方案）
async function httpGetWithTimeout(urlStr, options = {}, timeout = 8000) {
  return httpGet(urlStr, { ...options, timeout })
}

// ==================== 美股 API（新浪财经 gb_ 接口） ====================

// 内置美股热门股票列表（用于搜索）
const usStockDB = [
  { symbol: 'AAPL', name: 'Apple (苹果)' }, { symbol: 'MSFT', name: 'Microsoft (微软)' },
  { symbol: 'GOOGL', name: 'Alphabet (谷歌)' }, { symbol: 'GOOG', name: 'Alphabet C (谷歌)' },
  { symbol: 'AMZN', name: 'Amazon (亚马逊)' }, { symbol: 'NVDA', name: 'NVIDIA (英伟达)' },
  { symbol: 'TSLA', name: 'Tesla (特斯拉)' }, { symbol: 'META', name: 'Meta (脸书)' },
  { symbol: 'BRK.B', name: 'Berkshire Hathaway (伯克希尔)' }, { symbol: 'BRK.A', name: 'Berkshire Hathaway A' },
  { symbol: 'JPM', name: 'JPMorgan Chase (摩根大通)' }, { symbol: 'V', name: 'Visa' },
  { symbol: 'JNJ', name: 'Johnson & Johnson (强生)' }, { symbol: 'WMT', name: 'Walmart (沃尔玛)' },
  { symbol: 'PG', name: 'Procter & Gamble (宝洁)' }, { symbol: 'MA', name: 'Mastercard (万事达)' },
  { symbol: 'UNH', name: 'UnitedHealth (联合健康)' }, { symbol: 'HD', name: 'Home Depot (家得宝)' },
  { symbol: 'BAC', name: 'Bank of America (美国银行)' }, { symbol: 'DIS', name: 'Walt Disney (迪士尼)' },
  { symbol: 'NFLX', name: 'Netflix (奈飞)' }, { symbol: 'ADBE', name: 'Adobe' },
  { symbol: 'CRM', name: 'Salesforce' }, { symbol: 'PEP', name: 'PepsiCo (百事可乐)' },
  { symbol: 'KO', name: 'Coca-Cola (可口可乐)' }, { symbol: 'AVGO', name: 'Broadcom (博通)' },
  { symbol: 'TMO', name: 'Thermo Fisher Scientific' }, { symbol: 'COST', name: 'Costco (好市多)' },
  { symbol: 'ABBV', name: 'AbbVie (艾伯维)' }, { symbol: 'CVX', name: 'Chevron (雪佛龙)' },
  { symbol: 'AMD', name: 'AMD (超威半导体)' }, { symbol: 'INTC', name: 'Intel (英特尔)' },
  { symbol: 'QCOM', name: 'Qualcomm (高通)' }, { symbol: 'IBM', name: 'IBM' },
  { symbol: 'ORCL', name: 'Oracle (甲骨文)' }, { symbol: 'CSCO', name: 'Cisco (思科)' },
  { symbol: 'MRK', name: 'Merck (默克)' }, { symbol: 'NKE', name: 'Nike (耐克)' },
  { symbol: 'BA', name: 'Boeing (波音)' }, { symbol: 'MCD', name: "McDonald's (麦当劳)" },
  { symbol: 'SBUX', name: 'Starbucks (星巴克)' }, { symbol: 'PYPL', name: 'PayPal' },
  { symbol: 'UBER', name: 'Uber' }, { symbol: 'SNAP', name: 'Snap' },
  { symbol: 'TSM', name: 'TSMC (台积电)' }, { symbol: 'BABA', name: 'Alibaba (阿里巴巴)' },
  { symbol: 'PDD', name: 'Pinduoduo (拼多多)' }, { symbol: 'JD', name: 'JD.com (京东)' },
  { symbol: 'BIDU', name: 'Baidu (百度)' }, { symbol: 'NIO', name: 'NIO (蔚来)' },
  { symbol: 'LI', name: 'Li Auto (理想汽车)' }, { symbol: 'XPEV', name: 'XPeng (小鹏汽车)' },
  { symbol: 'F', name: 'Ford (福特)' }, { symbol: 'GM', name: 'General Motors (通用汽车)' },
  { symbol: 'CAT', name: 'Caterpillar (卡特彼勒)' }, { symbol: 'GE', name: 'General Electric (通用电气)' },
  { symbol: 'XOM', name: 'Exxon Mobil (埃克森美孚)' }, { symbol: 'PFE', name: 'Pfizer (辉瑞)' },
  { symbol: 'GILD', name: 'Gilead Sciences (吉利德)' }, { symbol: 'AMGN', name: 'Amgen (安进)' },
  { symbol: 'T', name: 'AT&T' }, { symbol: 'VZ', name: 'Verizon (威瑞森)' },
  { symbol: 'TMUS', name: 'T-Mobile US' }, { symbol: 'AMAT', name: 'Applied Materials (应用材料)' },
  { symbol: 'MU', name: 'Micron (美光科技)' }, { symbol: 'NOW', name: 'ServiceNow' },
  { symbol: 'SHOP', name: 'Shopify' }, { symbol: 'SPOT', name: 'Spotify' },
  { symbol: 'ZM', name: 'Zoom' }, { symbol: 'PLTR', name: 'Palantir' },
  { symbol: 'RIVN', name: 'Rivian' }, { symbol: 'SPY', name: 'SPDR S&P 500 ETF' },
  { symbol: 'QQQ', name: 'Invesco QQQ Trust (纳斯达克ETF)' }, { symbol: 'DIA', name: 'SPDR Dow Jones ETF' },
  { symbol: 'IWM', name: 'iShares Russell 2000 ETF' }, { symbol: 'GLD', name: 'SPDR Gold Trust (黄金ETF)' },
  { symbol: 'SLV', name: 'iShares Silver Trust (白银ETF)' }, { symbol: 'USO', name: 'United States Oil Fund (原油ETF)' },
  { symbol: 'TQQQ', name: 'ProShares UltraPro QQQ (3倍做多纳指)' }, { symbol: 'SQQQ', name: 'ProShares UltraPro Short QQQ (3倍做空纳指)' },
]

// 美股行情（新浪财经 gb_ 接口，缓存 30 秒）
app.get('/api/stock/us/:symbol', async (req, res) => {
  try {
    const symbol = String(req.params.symbol).toUpperCase()

    const data = await getOrFetch(`stock:us:${symbol}`, async () => {
      const sinaSymbol = `gb_${symbol.toLowerCase()}`

      const { ok, body } = await httpGet(
        `https://hq.sinajs.cn/list=${sinaSymbol}`,
        { headers: { 'Referer': 'https://finance.sina.com.cn' }, encoding: 'gbk' }
      )
      if (!ok) throw new Error('请求新浪接口失败')

      const match = body.match(/"([^"]+)"/)
      if (!match) throw new Error('未找到该股票，请检查代码是否正确')

      const parts = match[1].split(',')
      if (!parts || parts.length < 7) throw new Error('股票数据格式异常')

      // 新浪 gb_ 格式: name, price, change%, time, $change, low, high, pre_low, pre_high, 52w_low, volume, ...
      const name = parts[0] || symbol
      const price = parseFloat(parts[1]) || 0
      const changeDollar = parts.length > 4 ? (parseFloat(parts[4]) || 0) : 0
      const prevClose = parts.length > 26 ? (parseFloat(parts[26]) || 0) : price - changeDollar
      const change = price - prevClose
      const changePercent = prevClose > 0 ? (change / prevClose) * 100 : (parseFloat(parts[2]) || 0)
      const dayLow = parseFloat(parts[5]) || Math.min(price, prevClose)
      const dayHigh = parseFloat(parts[6]) || Math.max(price, prevClose)
      const volume = parseInt(parts[10]) || 0

      // 用实时价校正 range
      const low = Math.min(dayLow, price)
      const high = Math.max(dayHigh, price)

      return {
        symbol, name, price,
        change: parseFloat(change.toFixed(2)),
        changePercent: parseFloat(changePercent.toFixed(2)),
        open: parseFloat(prevClose.toFixed(2)),
        high, low, volume,
        previousClose: parseFloat(prevClose.toFixed(2)),
        currency: 'USD',
        market: 'US',
      }
    }, 30) // 缓存 30 秒

    res.json({ success: true, data })
  } catch (err) {
    // 数据错误（未找到/格式异常）→ 不缓存，返回成功:false
    if (err.message.includes('未找到') || err.message.includes('格式异常')) {
      return res.json({ success: false, error: err.message })
    }
    // 网络错误 → 500
    console.error('美股行情请求失败:', err.message)
    res.status(500).json({ success: false, error: `获取美股数据失败: ${err.message}` })
  }
})

// 美股历史数据（新浪 US K-line 接口，缓存 5 分钟）
app.get('/api/stock/us/:symbol/history', async (req, res) => {
  try {
    const symbol = String(req.params.symbol).toUpperCase()

    const history = await getOrFetch(`stock:us:${symbol}:history`, async () => {
      const { ok, body } = await httpGet(
        `https://stock.finance.sina.com.cn/usstock/api/json_v2.php/US_MinKService.getDailyK?symbol=${symbol}`,
        { headers: { 'Referer': 'https://finance.sina.com.cn' }, encoding: 'gbk' }
      )
      if (!ok) throw new Error('获取美股历史数据失败')

      let data
      try { data = JSON.parse(body) } catch { return [] }
      if (!Array.isArray(data)) return []

      return data.slice(-30).map((item) => ({
        date: item.d || item.day,
        open: parseFloat(item.o || item.open),
        high: parseFloat(item.h || item.high),
        low: parseFloat(item.l || item.low),
        close: parseFloat(item.c || item.close),
        volume: parseInt(item.v || item.volume) || 0,
      })).filter((d) => d.close > 0)
    }, 300) // 缓存 5 分钟

    res.json({ success: true, data: history })
  } catch (err) {
    console.error('美股历史请求失败:', err.message)
    res.status(500).json({ success: false, error: `获取美股历史数据失败: ${err.message}` })
  }
})

// 美股搜索（内置热门股票列表 + 新浪 suggest 补充，缓存 1 小时）
app.get('/api/search/us/:keyword', async (req, res) => {
  try {
    const keyword = req.params.keyword.trim()
    const kwUpper = keyword.toUpperCase()

    const results = await getOrFetch(`search:us:${kwUpper}`, async () => {
      // 1. 先从内置列表匹配
      let results = usStockDB.filter(s =>
        s.symbol.includes(kwUpper) || s.name.toUpperCase().includes(kwUpper)
      )

      // 2. 如果没找到，尝试新浪 suggest（type=12 为美股）
      if (results.length === 0) {
        try {
          const { ok, body } = await httpGet(
            `https://suggest3.sinajs.cn/suggest/type=12&key=${encodeURIComponent(keyword)}`,
            { headers: { 'Referer': 'https://finance.sina.com.cn' }, encoding: 'gbk' }
          )
          if (ok && body) {
            const m = body.match(/"([^"]+)"/)
            if (m) {
              const items = m[1].split(';')
              for (const item of items) {
                const fields = item.split(',')
                if (fields.length >= 4) {
                  const name = fields[0]
                  const code = fields[2]
                  if (code && name) {
                    results.push({ symbol: code, name })
                  }
                }
              }
            }
          }
        } catch (e) {
          console.log('新浪 suggest 美股搜索失败:', e.message)
        }
      }

      return results.slice(0, 10)
    }, 3600) // 缓存 1 小时

    return res.json({ success: true, data: results })
  } catch (err) {
    console.error('美股搜索失败:', err.message)
    res.status(500).json({ success: false, error: `搜索失败: ${err.message}` })
  }
})

// ==================== A股 API（新浪财经） ====================

// ==================== A股 API（新浪财经） ====================

// A股搜索（按名称模糊匹配，使用内置热门股票列表）
const cnStockDB = [
  { symbol: '600519', name: '贵州茅台' }, { symbol: '000858', name: '五粮液' },
  { symbol: '601318', name: '中国平安' }, { symbol: '000001', name: '平安银行' },
  { symbol: '600036', name: '招商银行' }, { symbol: '002594', name: '比亚迪' },
  { symbol: '600900', name: '长江电力' }, { symbol: '601899', name: '紫金矿业' },
  { symbol: '000333', name: '美的集团' }, { symbol: '600276', name: '恒瑞医药' },
  { symbol: '002714', name: '牧原股份' }, { symbol: '601012', name: '隆基绿能' },
  { symbol: '000651', name: '格力电器' }, { symbol: '600809', name: '山西汾酒' },
  { symbol: '002475', name: '立讯精密' }, { symbol: '601166', name: '兴业银行' },
  { symbol: '600887', name: '伊利股份' }, { symbol: '000568', name: '泸州老窖' },
  { symbol: '002304', name: '洋河股份' }, { symbol: '601888', name: '中国中免' },
  { symbol: '300750', name: '宁德时代' }, { symbol: '603259', name: '药明康德' },
  { symbol: '002352', name: '顺丰控股' }, { symbol: '601398', name: '工商银行' },
  { symbol: '600030', name: '中信证券' }, { symbol: '000002', name: '万科A' },
  { symbol: '601166', name: '兴业银行' }, { symbol: '600585', name: '海螺水泥' },
  { symbol: '002415', name: '海康威视' }, { symbol: '601857', name: '中国石油' },
]

app.get('/api/search/cn/:keyword', async (req, res) => {
  try {
    const kw = req.params.keyword.trim()
    const kwLower = kw.toLowerCase()

    const results = await getOrFetch(`search:cn:${kwLower}`, async () => {
      // 1. 先按代码精确匹配
      let results = cnStockDB.filter(s => s.symbol === kwLower)
      // 2. 再按名称模糊匹配
      if (results.length === 0) {
        results = cnStockDB.filter(s => s.name.includes(kw) || s.symbol.includes(kwLower))
      }

      // 3. 本地没有则请求新浪 suggest API 实时搜索
      if (results.length === 0) {
        try {
          const { ok, body } = await httpGet(
            `https://suggest3.sinajs.cn/suggest/type=11&key=${encodeURIComponent(kw)}`,
            { headers: { 'Referer': 'https://finance.sina.com.cn' }, encoding: 'gbk' }
          )
          if (ok && body) {
            const m = body.match(/"([^"]+)"/)
            if (m) {
              const items = m[1].split(';')
              for (const item of items) {
                const fields = item.split(',')
                if (fields.length >= 4) {
                  const name = fields[0]
                  const code = fields[2]
                  if (code && /^\d{6}$/.test(code) && name) {
                    results.push({ symbol: code, name })
                  }
                }
              }
            }
          }
        } catch (e) {
          console.log('新浪 suggest 搜索失败:', e.message)
        }
      }

      // 4. 如果是纯数字但没搜到，当未知代码处理
      if (results.length === 0 && /^\d{6}$/.test(kw)) {
        results = [{ symbol: kw, name: '未知股票' }]
      }

      return results.slice(0, 10)
    }, 3600) // 缓存 1 小时

    res.json({ success: true, data: results })
  } catch (err) {
    res.status(500).json({ success: false, error: `搜索失败: ${err.message}` })
  }
})

// A 股实时行情（新浪财经，缓存 30 秒）
app.get('/api/stock/cn/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params

    const data = await getOrFetch(`stock:cn:${symbol}`, async () => {
      const prefix = symbol.startsWith('6') ? 'sh' : 'sz'
      const sinaSymbol = `${prefix}${symbol}`

      const { ok, body } = await httpGet(
        `https://hq.sinajs.cn/list=${sinaSymbol}`,
        { headers: { 'Referer': 'https://finance.sina.com.cn' }, encoding: 'gbk' }
      )
      if (!ok) throw new Error('获取A股数据失败')

      const match = body.match(/"([^"]+)"/)
      if (!match) throw new Error('未找到该股票数据，请检查股票代码是否正确')

      const parts = match[1].split(',')
      if (!parts || parts.length < 3) throw new Error('股票数据格式异常，该代码可能无效')

      const name = parts[0] || '未知'
      const open = parseFloat(parts[1]) || 0
      const prevClose = parseFloat(parts[2]) || 0
      const price = parseFloat(parts[3]) || prevClose || open
      const high = parseFloat(parts[4]) || price
      const low = parseFloat(parts[5]) || price
      const volume = parseFloat(parts[8]) || 0
      const change = price - prevClose
      const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0

      return {
        symbol, name, price,
        change: parseFloat(change.toFixed(2)),
        changePercent: parseFloat(changePercent.toFixed(2)),
        open, high, low, volume,
        previousClose: prevClose,
        currency: 'CNY',
        market: 'CN',
      }
    }, 30) // 缓存 30 秒

    res.json({ success: true, data })
  } catch (err) {
    if (err.message.includes('未找到') || err.message.includes('格式异常') || err.message.includes('无效')) {
      return res.json({ success: false, error: err.message })
    }
    console.error('A股行情请求失败:', err.message)
    res.status(500).json({ success: false, error: `获取A股数据失败: ${err.message}` })
  }
})

// A股信号参数自动填充（换手率、跌幅等，缓存 5 分钟）
app.get('/api/stock/cn/:symbol/auto-fill', async (req, res) => {
  try {
    const { symbol } = req.params

    const data = await getOrFetch(`cn:auto-fill:${symbol}`, async () => {
      const prefix = symbol.startsWith('6') ? 'sh' : 'sz'
      const sinaSymbol = `${prefix}${symbol}`

      // 1. 获取换手率（腾讯接口）
      let turnoverRate = null
      try {
        const { ok, body } = await httpGetWithTimeout(
          `https://qt.gtimg.cn/q=${sinaSymbol}`,
          { headers: { 'Referer': 'https://qt.gtimg.cn' }, encoding: 'gbk' }, 8000
        )
        if (ok && body) {
          const m = body.match(/"([^"]+)"/)
          if (m) {
            const fields = m[1].split('~')
            if (fields.length > 39 && fields[38] && parseFloat(fields[38]) > 0) {
              turnoverRate = parseFloat(fields[38])
            }
          }
        }
      } catch (e) {
        console.log('腾讯换手率获取失败:', e.message)
      }

      // 2. 获取120日历史数据，计算从最高点跌幅
      let dropFromHigh = null
      try {
        const { ok, body } = await httpGetWithTimeout(
          `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${sinaSymbol}&scale=240&ma=no&datalen=120`,
          { headers: { 'Referer': 'https://finance.sina.com.cn' }, encoding: 'gbk' }, 10000
        )
        if (ok) {
          let data
          try { data = JSON.parse(body) } catch { data = [] }
          if (Array.isArray(data) && data.length > 0) {
            const currentPrice = parseFloat(data[data.length - 1].close) || 0
            let maxPrice = 0
            for (const d of data) {
              const h = parseFloat(d.high) || 0
              if (h > maxPrice) maxPrice = h
            }
            if (maxPrice > 0 && currentPrice > 0) {
              dropFromHigh = parseFloat(((maxPrice - currentPrice) / maxPrice * 100).toFixed(1))
            }
          }
        }
      } catch (e) {
        console.log('历史数据获取失败:', e.message)
      }

      // 3. 获取上证指数120日数据，计算大盘跌幅
      let marketDrop = null
      try {
        const { ok, body } = await httpGetWithTimeout(
          'https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=sh000001&scale=240&ma=no&datalen=120',
          { headers: { 'Referer': 'https://finance.sina.com.cn' }, encoding: 'gbk' }, 10000
        )
        if (ok) {
          let data
          try { data = JSON.parse(body) } catch { data = [] }
          if (Array.isArray(data) && data.length > 0) {
            const currentIndex = parseFloat(data[data.length - 1].close) || 0
            let maxIndex = 0
            for (const d of data) {
              const h = parseFloat(d.high) || 0
              if (h > maxIndex) maxIndex = h
            }
            if (maxIndex > 0 && currentIndex > 0) {
              marketDrop = parseFloat(((maxIndex - currentIndex) / maxIndex * 100).toFixed(1))
            }
          }
        }
      } catch (e) {
        console.log('指数数据获取失败:', e.message)
      }

      return { turnoverRate, dropFromHigh, marketDrop, isNewStock: false }
    }, 300) // 缓存 5 分钟

    res.json({ success: true, data })
  } catch (err) {
    console.error('自动填充失败:', err.message)
    res.status(500).json({ success: false, error: `自动填充失败: ${err.message}` })
  }
})

// A 股历史 K 线（新浪财经，缓存 5 分钟）
app.get('/api/stock/cn/:symbol/history', async (req, res) => {
  try {
    const { symbol } = req.params

    const history = await getOrFetch(`stock:cn:${symbol}:history`, async () => {
      const prefix = symbol.startsWith('6') ? 'sh' : 'sz'
      const sinaSymbol = `${prefix}${symbol}`

      const { ok, body } = await httpGet(
        `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${sinaSymbol}&scale=240&ma=no&datalen=30`,
        { headers: { 'Referer': 'https://finance.sina.com.cn' }, encoding: 'gbk' }
      )
      if (!ok) throw new Error('获取A股历史数据失败')

      let data
      try { data = JSON.parse(body) } catch { return [] }
      if (!Array.isArray(data)) return []

      return data.map((item) => ({
        date: item.day,
        open: parseFloat(item.open),
        high: parseFloat(item.high),
        low: parseFloat(item.low),
        close: parseFloat(item.close),
        volume: parseFloat(item.volume),
      }))
    }, 300) // 缓存 5 分钟

    res.json({ success: true, data: history })
  } catch (err) {
    console.error('A股历史请求失败:', err.message)
    res.status(500).json({ success: false, error: `获取A股历史数据失败: ${err.message}` })
  }
})

// ==================== 涨停板数据（缓存 60 秒） ====================

app.get('/api/limit-up/today', async (req, res) => {
  try {
    const data = await getOrFetch('limitup:today', async () => {
      // 尝试 Python AKShare 接口
      try {
        const { ok, body } = await httpGetWithTimeout(`${PYTHON_API}/api/limit-up/today`, {}, 30000)
        if (ok) {
          const data = JSON.parse(body)
          if (data && data.success && data.data) return data.data
        }
      } catch (e) {
        console.log('Python 涨停服务不可用，降级到新浪:', e.message)
      }

      // 优先用东方财富专门的涨停API（数据更全）
      try {
        const today = new Date().toISOString().slice(0, 10)
        const eastStocks = await getLimitUpByDate(today)
        if (eastStocks.length > 0) return eastStocks
      } catch (e) {
        console.log('东方财富涨停接口失败:', e.message)
      }

      // 降级：用新浪接口筛选涨停股
      let stocks = []
      try {
        const { ok: ok2, body: body2 } = await httpGetWithTimeout(
          'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?page=1&num=5000&sort=changepercent&asc=0&node=hs_a&symbol=&_s_r_a=page',
          { headers: { 'Referer': 'https://finance.sina.com.cn' }, encoding: 'gbk' }, 15000
        )
        if (ok2) {
          let data
          try { data = JSON.parse(body2) } catch { data = [] }
          if (Array.isArray(data)) {
            stocks = data
              .filter(s => parseFloat(s.changepercent) >= 9.9)
              .map(s => ({
                symbol: s.code, name: s.name, price: parseFloat(s.trade),
                change_percent: parseFloat(s.changepercent),
                turnover_rate: parseFloat(s.turnoverratio || 0),
                change_amount: parseFloat(s.pricechange || 0),
                volume: parseFloat(s.volume || 0),
                limit_up_count: 1, score: null, industry: null,
              }))
          }
        }
      } catch (e) {
        console.log('新浪接口降级失败:', e.message)
      }

      return stocks
    }, 60) // 缓存 60 秒

    res.json({ success: true, data })
  } catch (err) {
    console.error('涨停数据请求失败:', err.message)
    res.status(500).json({ success: false, error: `获取涨停数据失败: ${err.message}` })
  }
})

// 历史涨停数据（缓存 1 小时）
app.get('/api/limit-up/history', async (req, res) => {
  const { date } = req.query
  if (!date) {
    return res.status(400).json({ success: false, error: '请指定日期参数 date=YYYY-MM-DD' })
  }

  try {
    const stocks = await getOrFetch(`limitup:history:${date}`, async () => {
      // 尝试 Python AKShare
      try {
        const { ok, body } = await httpGetWithTimeout(`${PYTHON_API}/api/limit-up/history?date=${date}`, {}, 30000)
        if (ok) {
          const data = JSON.parse(body)
          if (data && data.success && data.data) return data.data
        }
      } catch (e) {
        console.log('Python 历史涨停不可用，降级到东方财富:', e.message)
      }

      // 降级：东方财富 + 新浪
      try {
        return await getLimitUpByDate(date)
      } catch (e) {
        console.log('历史涨停降级失败:', e.message)
      }

      return []
    }, 3600) // 缓存 1 小时

    res.json({ success: true, data: stocks })
  } catch (err) {
    console.error('历史涨停请求失败:', err.message)
    res.status(500).json({ success: false, error: `获取历史涨停数据失败: ${err.message}` })
  }
})

// 涨停板块统计（缓存 5 分钟）
app.get('/api/limit-up/stats', async (req, res) => {
  const { date } = req.query

  try {
    const stats = await getOrFetch(`limitup:stats:${date || 'today'}`, async () => {
      // 尝试 Python AKShare
      try {
        const { ok, body } = await httpGetWithTimeout(`${PYTHON_API}/api/limit-up/stats?date=${date || ''}`, {}, 30000)
        if (ok) {
          const data = JSON.parse(body)
          if (data && data.success && data.data) return data.data
        }
      } catch (e) {
        console.log('Python 涨停统计不可用:', e.message)
      }

      // 降级：获取当天数据后做简单统计
      try {
        const today = date || new Date().toISOString().slice(0, 10)
        const stocks = await getLimitUpByDate(today)
        const groups = {}
        for (const s of stocks) {
          const key = s.price < 10 ? '低价股 (<10元)' : s.price < 30 ? '中价股 (10-30元)' : '高价股 (>30元)'
          if (!groups[key]) groups[key] = { industry: key, count: 0, stocks: [] }
          groups[key].count++
          groups[key].stocks.push(s)
        }
        return Object.values(groups)
      } catch (e) {
        console.log('涨停统计降级失败:', e.message)
      }

      return []
    }, 300) // 缓存 5 分钟

    res.json({ success: true, data: stats })
  } catch (err) {
    console.error('涨停统计请求失败:', err.message)
    res.status(500).json({ success: false, error: `获取涨停统计失败: ${err.message}` })
  }
})

// ==================== DeepSeek AI 分析（结果缓存 1 小时，省 API 费用） ====================

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY

// AI 个股健康检查（缓存 1 小时，按 symbol + market 去重）
app.post('/api/ai/health-check', async (req, res) => {
  try {
    const stock = req.body
    if (!stock || !stock.symbol) {
      return res.status(400).json({ success: false, error: '缺少股票数据' })
    }

    const result = await getOrFetch(
      `ai:health:${stock.symbol}:${stock.market || 'CN'}`,
      async () => {
        const changePercent = (stock.changePercent || 0).toFixed(2)
        const dayRange = ((stock.high || 0) - (stock.low || 0)).toFixed(2)
        const rangePct = stock.previousClose > 0
          ? (((stock.high || 0) - (stock.low || 0)) / stock.previousClose * 100).toFixed(2)
          : 'N/A'
        const volumeStr = (stock.volume || 0) > 10000
          ? (stock.volume / 10000).toFixed(0) + '万'
          : (stock.volume || 0) + '手'

        const prompt = `你是一位顶级AI投顾分析师。请对以下A股/美股进行6维度风险扫描分析。

【股票数据】
- 代码: ${stock.symbol}
- 名称: ${stock.name || stock.symbol}
- 当前价: ${stock.price}
- 涨跌幅: ${changePercent}%
- 开盘价: ${stock.open || 'N/A'}
- 最高价: ${stock.high || 'N/A'}
- 最低价: ${stock.low || 'N/A'}
- 昨收: ${stock.previousClose || 'N/A'}
- 成交量: ${volumeStr}
- 日内振幅: ${rangePct}%
- 市场: ${stock.market || 'A股'}

请从以下6个维度进行分析，每个维度给出：score(0-100数值越大风险越高)、level(high/warn/low)、brief(一句话概述)、analysis(详细AI分析)、suggestion(操作建议)、reason(数据依据)。

6个维度:
1. sentiment(市场情绪): 判断当前市场情绪状态
2. trend(趋势结构): 分析价格趋势健康度
3. liquidity(流动性): 评估成交量与流动性
4. volatility(波动性): 分析价格波动风险
5. capital(资金博弈): 判断资金流向与博弈情况
6. valuation(估值安全): 评估估值合理性

然后给出:
- aiScore: 综合评分(0-100, 越高越危险)
- conclusionTitle: 结论标题
- conclusionDesc: 结论描述
- conclusionTags: 标签数组(3个)
- advice: 投资建议正文
- confidence: AI可信度数值(0-100)

请严格按照以下JSON格式返回(不要加markdown标记):
{
  "dimensions": [
    {"key":"sentiment","score":数字,"level":"high/warn/low","brief":"...","analysis":"...","suggestion":"...","reason":"..."},
    ...
  ],
  "aiScore": 数字,
  "conclusionTitle": "...",
  "conclusionDesc": "...",
  "conclusionTags": ["...","...","..."],
  "advice": "...",
  "confidence": 数字
}`

        const response = await httpsPost(
          'https://api.deepseek.com/v1/chat/completions',
          {
            model: 'deepseek-chat',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.7,
            max_tokens: 3000,
          },
          { 'Authorization': `Bearer ${DEEPSEEK_API_KEY}` }
        )

        if (!response || !response.choices || response.choices.length === 0) {
          throw new Error('AI 分析返回异常')
        }

        const content = response.choices[0].message.content
        try {
          return JSON.parse(content)
        } catch {
          throw new Error('AI 返回格式异常，请重试')
        }
      },
      3600 // 缓存 1 小时
    )

    return res.json({ success: true, data: result })
  } catch (err) {
    console.error('AI健康检查失败:', err.message)
    res.status(500).json({ success: false, error: `AI分析失败: ${err.message}` })
  }
})

// AI 买卖信号分析（缓存 1 小时，按 symbol + 参数去重）
app.post('/api/ai/signal-analysis', async (req, res) => {
  try {
    const { stock, turnoverRate, dropFromHigh, marketDrop, isNewStock } = req.body
    if (!stock || !stock.symbol) {
      return res.status(400).json({ success: false, error: '缺少股票数据' })
    }

    const result = await getOrFetch(
      `ai:signal:${stock.symbol}:${turnoverRate || 0}:${dropFromHigh || 0}:${marketDrop || 0}:${isNewStock ? 1 : 0}`,
      async () => {
        const prompt = `你是一位顶级AI投顾，擅长技术面买卖信号分析。请根据以下数据给出专业的买卖信号研判。

【股票信息】
- 代码: ${stock.symbol} ${stock.name || ''}
- 当前价: ${stock.price}
- 涨跌幅: ${(stock.changePercent || 0).toFixed(2)}%

【用户输入的辅助参数】
${turnoverRate != null ? `- 今日换手率: ${turnoverRate}%` : '- 换手率: 未提供'}
${dropFromHigh != null ? `- 个股从最高点跌幅: ${dropFromHigh}%` : '- 个股跌幅: 未提供'}
${marketDrop != null ? `- 大盘从高点跌幅: ${marketDrop}%` : '- 大盘跌幅: 未提供'}
- 是否次新股: ${isNewStock ? '是' : '否'}

请从以下角度进行AI研判，返回JSON格式：

1. buySignals: 买入信号列表，每个信号包含:
   - name: 信号名称
   - met: 是否满足(true/false)
   - detail: 具体说明
   - reason: 数据依据

2. sellSignals: 卖出/风险信号列表，同上格式

3. advice: 综合建议对象:
   - action: 操作建议文字
   - reason: 核心理由
   - confidence: 可信度(0-100)

4. riskLevel: 风险评估 (low/medium/high)

【分析原则】
- 基于客观数据，不要臆测
- 专业、简洁、有实操价值
- 换手率≥30%是明确的风险信号
- 大盘跌幅≥20% + 个股跌幅≥50% 是重要的底部买入信号

请严格按以下JSON格式返回(不要加markdown标记):
{
  "buySignals": [{"name":"...","met":true/false,"detail":"...","reason":"..."}],
  "sellSignals": [{"name":"...","met":true/false,"detail":"...","reason":"..."}],
  "advice": {"action":"...","reason":"...","confidence":数字},
  "riskLevel": "low/medium/high"
}`

        const response = await httpsPost(
          'https://api.deepseek.com/v1/chat/completions',
          {
            model: 'deepseek-chat',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.7,
            max_tokens: 2000,
          },
          { 'Authorization': `Bearer ${DEEPSEEK_API_KEY}` }
        )

        if (!response || !response.choices || response.choices.length === 0) {
          throw new Error('AI 分析返回异常')
        }

        const content = response.choices[0].message.content
        try {
          return JSON.parse(content)
        } catch {
          throw new Error('AI 返回格式异常，请重试')
        }
      },
      3600 // 缓存 1 小时
    )

    return res.json({ success: true, data: result })
  } catch (err) {
    console.error('AI信号分析失败:', err.message)
    res.status(500).json({ success: false, error: `AI分析失败: ${err.message}` })
  }
})

// AI 涨停情绪分析（缓存 1 小时）
app.get('/api/limit-up/analysis', async (req, res) => {
  try {
    const result = await getOrFetch('ai:limitup:analysis', async () => {
      // 获取当天涨停数据
      let stocks = []
      try {
        stocks = await getTodayLimitUp()
      } catch { /* ignore */ }

      if (stocks.length === 0) {
        try {
          const today = new Date().toISOString().slice(0, 10)
          stocks = await getLimitUpByDate(today)
        } catch { /* ignore */ }
      }

      if (stocks.length === 0) {
        return null // null 不缓存，下次继续尝试
      }

      // 汇总信息
      const lowPrice = stocks.filter(s => s.price < 10)
      const midPrice = stocks.filter(s => s.price >= 10 && s.price < 30)
      const highPrice = stocks.filter(s => s.price >= 30)

      const topStocks = stocks.slice(0, 30).map((s, i) =>
        `${i+1}. ${s.name}(${s.symbol}) 涨幅${s.change_percent}% 价格${s.price}元 换手${s.turnover_rate}%`
      ).join('\n')

      const prompt = `你是一位A股资深市场分析师。请对今天A股涨停情况进行专业分析。

【今日涨停概况】
- 涨停总数：${stocks.length}只
- 低价股（<10元）：${lowPrice.length}只
- 中价股（10-30元）：${midPrice.length}只
- 高价股（>30元）：${highPrice.length}只

【涨停个股明细（前30只）】
${topStocks}

请从以下角度进行分析：
1. 市场情绪判断：今日涨停数量反映什么市场情绪？是强势、中性还是弱势？
2. 资金偏好：资金更倾向于低价股、中价股还是高价股？这说明什么？
3. 操作建议：基于当前情况，对短线和中线投资者分别给出建议
4. 风险提示：当前市场需要关注哪些风险因素？

请用中文回答，保持专业客观，控制在500字以内。`

      const response = await httpsPost(
        'https://api.deepseek.com/v1/chat/completions',
        {
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7,
          max_tokens: 1500,
        },
        { 'Authorization': `Bearer ${DEEPSEEK_API_KEY}` }
      )

      if (response.choices && response.choices.length > 0) {
        return response.choices[0].message.content
      }
      throw new Error('DeepSeek API 返回异常')
    }, 3600) // 缓存 1 小时

    if (!result) {
      return res.json({ success: false, error: '暂无涨停数据，无法进行分析' })
    }

    return res.json({ success: true, data: result })
  } catch (err) {
    console.error('DeepSeek 分析失败:', err.message)
    res.status(500).json({ success: false, error: `AI分析失败: ${err.message}` })
  }
})

// HTTPS POST 请求（用于调用 DeepSeek API）
function httpsPost(urlStr, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr)
    const body = JSON.stringify(data)
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...headers,
      },
    }
    const req = https.request(options, (res) => {
      let responseBody = ''
      res.on('data', chunk => responseBody += chunk)
      res.on('end', () => {
        try { resolve(JSON.parse(responseBody)) }
        catch { reject(new Error('JSON解析失败')) }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

// 同步状态
app.get('/api/sync/status', async (req, res) => {
  try {
    const { ok, body } = await httpGetWithTimeout(`${PYTHON_API}/api/sync/status`, {}, 10000)
    if (ok) {
      try { res.json(JSON.parse(body)); return } catch {}
    }
  } catch (e) {
    console.log('Python 同步状态不可用:', e.message)
  }
  res.json({ success: false, syncing: false, message: '数据同步服务未启动（Python AkShare 微服务未运行）' })
})

async function getTodayLimitUp() {
  // 优先用东方财富专门的涨停API
  try {
    const today = new Date().toISOString().slice(0, 10)
    const eastStocks = await getLimitUpByDate(today)
    if (eastStocks.length > 0) return eastStocks
  } catch { /* ignore */ }

  let stocks = []
  try {
    const { ok, body } = await httpGetWithTimeout(
      'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?page=1&num=5000&sort=changepercent&asc=0&node=hs_a&symbol=&_s_r_a=page',
      { headers: { 'Referer': 'https://finance.sina.com.cn' }, encoding: 'gbk' }, 15000
    )
    if (ok) {
      let data
      try { data = JSON.parse(body) } catch { data = [] }
      if (Array.isArray(data)) {
        stocks = data
          .filter(s => parseFloat(s.changepercent) >= 9.9)
          .map(s => ({
            symbol: s.code, name: s.name, price: parseFloat(s.trade),
            change_percent: parseFloat(s.changepercent),
            turnover_rate: parseFloat(s.turnoverratio || 0),
            change_amount: parseFloat(s.pricechange || 0),
            volume: parseFloat(s.volume || 0),
            limit_up_count: 1, score: null, industry: null,
          }))
      }
    }
  } catch { /* ignore */ }
  return stocks
}

async function getLimitUpByDate(dateStr) {
  let stocks = []
  // 东方财富涨停股接口（参数同步自 AKShare stock_zt_pool_em）
  try {
    const url = `https://push2ex.eastmoney.com/getTopicZTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=10000&sort=fbt:asc&date=${dateStr.replace(/-/g, '')}`
    const { ok, body } = await httpGetWithTimeout(url, {
      headers: { 'Referer': 'https://quote.eastmoney.com' }
    }, 15000)
    if (ok) {
      const parsed = JSON.parse(body)
      const pool = parsed.data && parsed.data.pool
      const list = Array.isArray(pool) ? pool : []
      if (list.length > 0) {
        stocks = list.map(s => ({
          symbol: String(s.c || '').padStart(6, '0'),
          name: s.n || '',
          price: parseFloat((parseFloat(s.p || 0) / 1000).toFixed(2)),
          change_percent: parseFloat(s.zdp || 0),
          turnover_rate: parseFloat(s.hs || 0),
          change_amount: parseFloat((parseFloat(s.zde || 0) / 1000).toFixed(2)),
          amount: parseFloat(s.amount || 0),
          limit_up_count: parseInt(s.boa || 1) || 1,
          score: null,
          industry: s.yw || null,
        }))
      }
    }
  } catch { /* ignore */ }

  // 降级：如果东方财富没数据，尝试新浪
  if (stocks.length === 0) {
    try {
      const { ok, body } = await httpGetWithTimeout(
        'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?page=1&num=5000&sort=changepercent&asc=0&node=hs_a&symbol=&_s_r_a=page',
        { headers: { 'Referer': 'https://finance.sina.com.cn' }, encoding: 'gbk' }, 15000
      )
      if (ok) {
        let data
        try { data = JSON.parse(body) } catch { data = [] }
        if (Array.isArray(data)) {
          stocks = data
            .filter(s => parseFloat(s.changepercent) >= 9.9)
            .map(s => ({
              symbol: s.code, name: s.name, price: parseFloat(s.trade),
              change_percent: parseFloat(s.changepercent),
              turnover_rate: parseFloat(s.turnoverratio || 0),
              change_amount: parseFloat(s.pricechange || 0),
              volume: parseFloat(s.volume || 0),
              limit_up_count: 1, score: null, industry: null,
            }))
        }
      }
    } catch { /* ignore */ }
  }

  return stocks
}

// 个股涨停历史检查（缓存 5 分钟）
app.get('/api/limit-up/check/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params

    const data = await getOrFetch(`limitup:check:${symbol}`, async () => {
      const prefix = symbol.startsWith('6') ? 'sh' : 'sz'
      const sinaSymbol = `${prefix}${symbol}`

      const { ok, body } = await httpGet(
        `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${sinaSymbol}&scale=240&ma=no&datalen=30`,
        { headers: { 'Referer': 'https://finance.sina.com.cn' }, encoding: 'gbk' }
      )
      if (!ok) throw new Error('获取历史数据失败')

      let data
      try { data = JSON.parse(body) } catch { data = [] }
      if (!Array.isArray(data)) data = []

      const isChiNext = symbol.startsWith('3') || symbol.startsWith('30')
      const isStar = symbol.startsWith('688')
      const limitPercent = (isChiNext || isStar) ? 19.9 : 9.9

      const limitUpDays = []
      for (const d of data) {
        const open = parseFloat(d.open)
        const close = parseFloat(d.close)
        if (open > 0) {
          const changePercent = ((close - open) / open) * 100
          if (changePercent >= limitPercent) {
            limitUpDays.push({
              date: d.day, open, close,
              changePercent: parseFloat(changePercent.toFixed(2)),
              volume: parseFloat(d.volume),
            })
          }
        }
      }

      return { symbol, limitUpDays, limitPercent }
    }, 300) // 缓存 5 分钟

    res.json({
      success: true,
      data: {
        ...data,
        firstLimitUp: data.limitUpDays.length > 0 ? data.limitUpDays[0] : null,
        totalLimitUp: data.limitUpDays.length,
      },
    })
  } catch (err) {
    console.error('涨停检查失败:', err.message)
    res.status(500).json({ success: false, error: `涨停检查失败: ${err.message}` })
  }
})

// ==================== 策略选股（调用 Python AkShare 微服务） ====================

const PYTHON_API = 'http://127.0.0.1:3081'

// 代理策略请求到 Python 服务
async function proxyToPython(path, method = 'GET', body = null, timeout = 30000) {
  try {
    if (method === 'POST' && body) {
      const https = require('https')
      const http = require('http')
      const url = new URL(`${PYTHON_API}${path}`)
      const lib = url.protocol === 'https:' ? https : http
      
      return new Promise((resolve, reject) => {
        const req = lib.request({
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: url.pathname,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          timeout: timeout,
        }, (res) => {
          let data = ''
          res.on('data', chunk => data += chunk)
          res.on('end', () => {
            try { resolve(JSON.parse(data)) }
            catch { reject(new Error('JSON解析失败')) }
          })
        })
        req.on('error', reject)
        req.on('timeout', () => { req.destroy(); reject(new Error('超时')) })
        req.write(JSON.stringify(body))
        req.end()
      })
    } else {
      const { ok, body } = await httpGetWithTimeout(`${PYTHON_API}${path}`, {}, timeout)
      if (!ok) throw new Error('Python 服务不可用')
      return JSON.parse(body)
    }
  } catch (err) {
    throw new Error(`Python 服务请求失败: ${err.message}`)
  }
}

// 策略路由映射
const strategyRoutes = {
  conservative: '保守型：低估值蓝筹',
  garp: '中立型：GARP质量均衡',
  momentum: '激进型：动量爆发成长',
  potential: '潜力型：高增长潜力',
  limitback: '涨停回马枪',
  'ma-bullish': '均线多头排列',
}

// 策略数据缓存 30 分钟（数据每日更新一次）
for (const [key, name] of Object.entries(strategyRoutes)) {
  app.get(`/api/strategy/${key}`, async (req, res) => {
    try {
      const result = await getOrFetch(`express:strategy:${key}`, async () => {
        return await proxyToPython(`/api/strategy/${key}`, 120000)
      }, 1800) // 30 分钟缓存
      res.json(result)
    } catch (err) {
      console.error(`${name}策略失败:`, err.message)
      res.status(500).json({ success: false, error: err.message })
    }
  })
}

// 策略回测（代理到 Python 服务，不缓存）
app.post('/api/backtest', async (req, res) => {
  try {
    const result = await proxyToPython('/api/backtest', 'POST', req.body)
    res.json(result)
  } catch (err) {
    console.error('回测失败:', err.message)
    res.status(500).json({ success: false, error: err.message })
  }
})

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'))
})

app.listen(PORT, async () => {
  await Promise.all([
    initCache(),
    initDB(),
  ])
  console.log(`服务器启动成功: http://localhost:${PORT}`)
})
