const express = require('express')
const cors = require('cors')
const iconv = require('iconv-lite')
const https = require('https')
const http = require('http')
const { URL } = require('url')
const net = require('net')
const tls = require('tls')
const path = require('path')

const app = express()
const PORT = 3000

app.use(cors())
app.use(express.json())

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

// ==================== 美股 API（多数据源降级） ====================

// 数据源1: stockprices.dev
async function fetchUSFromStockPrices(symbol) {
  const { ok, body } = await httpGetWithTimeout(`https://stockprices.dev/api/stocks/${encodeURIComponent(symbol)}`)
  if (!ok) throw new Error('stockprices.dev 请求失败')
  const d = JSON.parse(body)
  if (!d || !d.Ticker) throw new Error('未找到该股票')
  return {
    symbol: d.Ticker,
    name: d.Name || symbol,
    price: d.Price,
    change: d.ChangeAmount,
    changePercent: d.ChangePercentage,
    open: d.Open || d.Price,
    high: d.High || d.Price,
    low: d.Low || d.Price,
    volume: d.Volume || 0,
    previousClose: d.Price - d.ChangeAmount,
    currency: 'USD',
    market: 'US',
  }
}

// 数据源2: finnhub.io (免费，无需key)
async function fetchUSFromFinnhub(symbol) {
  const { ok, body } = await httpGetWithTimeout(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}`)
  if (!ok) throw new Error('finnhub 请求失败')
  const d = JSON.parse(body)
  if (!d || d.c === 0) throw new Error('finnhub 无数据')
  return {
    symbol,
    name: symbol,
    price: d.c,
    change: d.d,
    changePercent: d.dp,
    open: d.o,
    high: d.h,
    low: d.l,
    volume: 0,
    previousClose: d.pc,
    currency: 'USD',
    market: 'US',
  }
}

// 美股行情（自动降级）
app.get('/api/stock/us/:symbol', async (req, res) => {
  try {
    const symbol = String(req.params.symbol).toUpperCase()

    // 尝试数据源1
    let data
    try {
      data = await fetchUSFromStockPrices(symbol)
    } catch {
      console.log(`stockprices.dev 失败，降级到 finnhub: ${symbol}`)
      try {
        data = await fetchUSFromFinnhub(symbol)
      } catch {
        return res.status(404).json({ success: false, error: '未找到该股票，请检查代码是否正确' })
      }
    }

    res.json({ success: true, data })
  } catch (err) {
    console.error('美股行情请求失败:', err.message)
    res.status(500).json({ success: false, error: `获取美股数据失败: ${err.message}` })
  }
})

// 美股历史数据（Twelve Data，带降级）
app.get('/api/stock/us/:symbol/history', async (req, res) => {
  try {
    const symbol = String(req.params.symbol).toUpperCase()

    // 尝试 Twelve Data
    let history = []
    try {
      const { ok, body } = await httpGetWithTimeout(
        `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=1day&outputsize=30&apikey=demo`
      )
      if (ok) {
        const parsed = JSON.parse(body)
        const values = parsed.values || []
        history = values.map((v) => ({
          date: v.datetime,
          open: parseFloat(v.open),
          high: parseFloat(v.high),
          low: parseFloat(v.low),
          close: parseFloat(v.close),
          volume: parseInt(v.volume) || 0,
        })).filter((d) => d.close > 0)
      }
    } catch {
      console.log('Twelve Data 历史失败，尝试备用源')
    }

    // 降级：用 finnhub 获取 candle 数据
    if (history.length === 0) {
      try {
        const to = Math.floor(Date.now() / 1000)
        const from = to - 30 * 24 * 3600
        const { ok, body } = await httpGetWithTimeout(
          `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=D&from=${from}&to=${to}`
        )
        if (ok) {
          const d = JSON.parse(body)
          if (d.s === 'ok' && d.t) {
            history = d.t.map((t, i) => ({
              date: new Date(t * 1000).toISOString().split('T')[0],
              open: d.o[i],
              high: d.h[i],
              low: d.l[i],
              close: d.c[i],
              volume: d.v[i] || 0,
            })).filter((h) => h.close > 0)
          }
        }
      } catch {
        // ignore
      }
    }

    res.json({ success: true, data: history })
  } catch (err) {
    console.error('美股历史请求失败:', err.message)
    res.status(500).json({ success: false, error: `获取美股历史数据失败: ${err.message}` })
  }
})

// 美股搜索（按名称/代码模糊搜索）
app.get('/api/search/us/:keyword', async (req, res) => {
  try {
    const keyword = req.params.keyword.toUpperCase()
    // 用 stockprices.dev 尝试精确匹配
    try {
      const { ok, body } = await httpGetWithTimeout(`https://stockprices.dev/api/stocks/${encodeURIComponent(keyword)}`)
      if (ok) {
        const d = JSON.parse(body)
        if (d && d.Ticker) {
          return res.json({ success: true, data: [{ symbol: d.Ticker, name: d.Name || d.Ticker }] })
        }
      }
    } catch { /* ignore */ }

    // 降级：用 finnhub 搜索
    try {
      const { ok, body } = await httpGetWithTimeout(`https://finnhub.io/api/v1/search?q=${encodeURIComponent(keyword)}&token=demo`)
      if (ok) {
        const d = JSON.parse(body)
        const results = (d.result || []).slice(0, 10).map(r => ({
          symbol: r.symbol,
          name: r.description,
        }))
        return res.json({ success: true, data: results })
      }
    } catch { /* ignore */ }

    res.json({ success: true, data: [] })
  } catch (err) {
    res.status(500).json({ success: false, error: `搜索失败: ${err.message}` })
  }
})

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
    const kw = req.params.keyword.trim().toLowerCase()
    // 先按代码精确匹配
    let results = cnStockDB.filter(s => s.symbol === kw)
    // 再按名称模糊匹配
    if (results.length === 0) {
      results = cnStockDB.filter(s => s.name.includes(kw) || s.symbol.includes(kw))
    }
    // 如果是纯数字，也直接返回（可能是代码）
    if (results.length === 0 && /^\d{6}$/.test(kw)) {
      results = [{ symbol: kw, name: '未知股票' }]
    }
    res.json({ success: true, data: results.slice(0, 10) })
  } catch (err) {
    res.status(500).json({ success: false, error: `搜索失败: ${err.message}` })
  }
})

app.get('/api/stock/cn/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params
    const prefix = symbol.startsWith('6') ? 'sh' : 'sz'
    const sinaSymbol = `${prefix}${symbol}`

    const { ok, body } = await httpGet(
      `https://hq.sinajs.cn/list=${sinaSymbol}`,
      { headers: { 'Referer': 'https://finance.sina.com.cn' }, encoding: 'gbk' }
    )

    if (!ok) {
      return res.status(500).json({ success: false, error: '获取A股数据失败' })
    }

    const match = body.match(/"([^"]+)"/)
    if (!match) {
      return res.status(500).json({ success: false, error: '无法解析A股数据，请检查股票代码' })
    }

    const parts = match[1].split(',')
    const name = parts[0]
    const open = parseFloat(parts[1])
    const prevClose = parseFloat(parts[2])
    const price = parseFloat(parts[3])
    const high = parseFloat(parts[4])
    const low = parseFloat(parts[5])
    const volume = parseFloat(parts[8])
    const change = price - prevClose
    const changePercent = (change / prevClose) * 100

    res.json({
      success: true,
      data: {
        symbol, name, price,
        change: parseFloat(change.toFixed(2)),
        changePercent: parseFloat(changePercent.toFixed(2)),
        open, high, low, volume,
        previousClose: prevClose,
        currency: 'CNY',
        market: 'CN',
      },
    })
  } catch (err) {
    console.error('A股行情请求失败:', err.message)
    res.status(500).json({ success: false, error: `获取A股数据失败: ${err.message}` })
  }
})

app.get('/api/stock/cn/:symbol/history', async (req, res) => {
  try {
    const { symbol } = req.params
    const prefix = symbol.startsWith('6') ? 'sh' : 'sz'
    const sinaSymbol = `${prefix}${symbol}`

    const { ok, body } = await httpGet(
      `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${sinaSymbol}&scale=240&ma=no&datalen=30`,
      { headers: { 'Referer': 'https://finance.sina.com.cn' }, encoding: 'gbk' }
    )

    if (!ok) {
      return res.status(500).json({ success: false, error: '获取A股历史数据失败' })
    }

    let data
    try { data = JSON.parse(body) } catch { return res.json({ success: true, data: [] }) }
    if (!Array.isArray(data)) return res.json({ success: true, data: [] })

    const history = data.map((item) => ({
      date: item.day,
      open: parseFloat(item.open),
      high: parseFloat(item.high),
      low: parseFloat(item.low),
      close: parseFloat(item.close),
      volume: parseFloat(item.volume),
    }))

    res.json({ success: true, data: history })
  } catch (err) {
    console.error('A股历史请求失败:', err.message)
    res.status(500).json({ success: false, error: `获取A股历史数据失败: ${err.message}` })
  }
})

// ==================== 涨停板数据 ====================

app.get('/api/limit-up/today', async (req, res) => {
  // 尝试 Python AKShare 接口
  try {
    const { ok, body } = await httpGetWithTimeout(`${PYTHON_API}/api/limit-up/today`, {}, 30000)
    if (ok) {
      const data = JSON.parse(body)
      if (data && data.success && data.data) {
        return res.json(data)
      }
    }
  } catch (e) {
    console.log('Python 涨停服务不可用，降级到新浪:', e.message)
  }

  // 优先用东方财富专门的涨停API（数据更全）
  try {
    const today = new Date().toISOString().slice(0, 10)
    const eastStocks = await getLimitUpByDate(today)
    if (eastStocks.length > 0) {
      return res.json({ success: true, data: eastStocks })
    }
  } catch (e) {
    console.log('东方财富涨停接口失败:', e.message)
  }

  // 降级：用新浪接口筛选涨停股（扩大取数范围，避免截断）
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
            symbol: s.code,
            name: s.name,
            price: parseFloat(s.trade),
            change_percent: parseFloat(s.changepercent),
            turnover_rate: parseFloat(s.turnoverratio || 0),
            change_amount: parseFloat(s.pricechange || 0),
            volume: parseFloat(s.volume || 0),
            limit_up_count: 1,
            score: null,
            industry: null,
          }))
      }
    }
  } catch (e) {
    console.log('新浪接口降级失败:', e.message)
  }

  res.json({ success: true, data: stocks })
})

// 历史涨停数据
app.get('/api/limit-up/history', async (req, res) => {
  const { date } = req.query
  if (!date) {
    return res.status(400).json({ success: false, error: '请指定日期参数 date=YYYY-MM-DD' })
  }

  // 尝试 Python AKShare
  try {
    const { ok, body } = await httpGetWithTimeout(`${PYTHON_API}/api/limit-up/history?date=${date}`, {}, 30000)
    if (ok) {
      const data = JSON.parse(body)
      if (data && data.success && data.data) {
        return res.json(data)
      }
    }
  } catch (e) {
    console.log('Python 历史涨停不可用，降级到东方财富:', e.message)
  }

  // 降级：东方财富 + 新浪
  try {
    const stocks = await getLimitUpByDate(date)
    return res.json({ success: true, data: stocks })
  } catch (e) {
    console.log('历史涨停降级失败:', e.message)
  }

  res.json({ success: true, data: [] })
})

// 涨停板块统计
app.get('/api/limit-up/stats', async (req, res) => {
  const { date } = req.query

  // 尝试 Python AKShare
  try {
    const { ok, body } = await httpGetWithTimeout(`${PYTHON_API}/api/limit-up/stats?date=${date || ''}`, {}, 30000)
    if (ok) {
      const data = JSON.parse(body)
      if (data && data.success && data.data) {
        return res.json(data)
      }
    }
  } catch (e) {
    console.log('Python 涨停统计不可用:', e.message)
  }

  // 降级：获取当天数据后做简单统计
  try {
    const today = date || new Date().toISOString().slice(0, 10)
    const stocks = await getLimitUpByDate(today)
    // 按价格区间分组
    const groups = {}
    for (const s of stocks) {
      const key = s.price < 10 ? '低价股 (<10元)' : s.price < 30 ? '中价股 (10-30元)' : '高价股 (>30元)'
      if (!groups[key]) groups[key] = { industry: key, count: 0, stocks: [] }
      groups[key].count++
      groups[key].stocks.push(s)
    }
    const stats = Object.values(groups)
    return res.json({ success: true, data: stats })
  } catch (e) {
    console.log('涨停统计降级失败:', e.message)
  }

  res.json({ success: true, data: [] })
})

// ==================== DeepSeek AI 分析 ====================

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY

app.get('/api/limit-up/analysis', async (req, res) => {
  try {
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
      return res.json({ success: false, error: '暂无涨停数据，无法进行分析' })
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
      const analysis = response.choices[0].message.content
      return res.json({ success: true, data: analysis })
    }
    res.json({ success: false, error: 'DeepSeek API 返回异常' })
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
  // 东方财富涨停股接口
  try {
    const url = `https://push2ex.eastmoney.com/getTopicZTPool?ut=7eea3edcaed734bea9teledata&dpt=wz.ztzt&Ession=&date=${dateStr.replace(/-/g, '')}&_=${Date.now()}`
    const { ok, body } = await httpGetWithTimeout(url, {
      headers: { 'Referer': 'https://data.eastmoney.com' }
    }, 10000)
    if (ok) {
      const parsed = JSON.parse(body)
      const list = (parsed.data && parsed.data.pool) || []
      if (Array.isArray(list) && list.length > 0) {
        stocks = list.map(s => ({
          symbol: String(s.c || '').padStart(6, '0'),
          name: s.n || '',
          price: parseFloat(s.p || 0),
          change_percent: parseFloat(s.zdp || 0),
          turnover_rate: parseFloat(s.hs || 0),
          change_amount: parseFloat(s.zde || 0),
          amount: parseFloat(s.amount || 0),
          limit_up_count: 1, score: null, industry: null,
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

app.get('/api/limit-up/check/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params
    const prefix = symbol.startsWith('6') ? 'sh' : 'sz'
    const sinaSymbol = `${prefix}${symbol}`

    const { ok, body } = await httpGet(
      `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${sinaSymbol}&scale=240&ma=no&datalen=30`,
      { headers: { 'Referer': 'https://finance.sina.com.cn' }, encoding: 'gbk' }
    )
    if (!ok) return res.status(500).json({ success: false, error: '获取历史数据失败' })

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

    res.json({
      success: true,
      data: {
        symbol, limitUpDays,
        firstLimitUp: limitUpDays.length > 0 ? limitUpDays[0] : null,
        totalLimitUp: limitUpDays.length,
        limitPercent,
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

for (const [key, name] of Object.entries(strategyRoutes)) {
  app.get(`/api/strategy/${key}`, async (req, res) => {
    try {
      const result = await proxyToPython(`/api/strategy/${key}`, 120000)
      res.json(result)
    } catch (err) {
      console.error(`${name}策略失败:`, err.message)
      res.status(500).json({ success: false, error: err.message })
    }
  })
}

// 策略回测（代理到 Python 服务）
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

app.listen(PORT, () => {
  console.log(`服务器启动成功: http://localhost:${PORT}`)
})
