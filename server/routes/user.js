/**
 * 用户数据 API 路由
 *
 * 将用户数据从浏览器 localStorage 迁移到 MySQL
 * MySQL 不可用时自动降级（由前端 fallback 到 localStorage）
 */

const express = require('express')
const router = express.Router()
const db = require('../db')

// ==================== 工具 ====================

/**
 * 获取请求中的 device_id，所有接口都依赖它
 */
function getDeviceId(req) {
  return req.headers['x-device-id'] || req.query.device_id || null
}

/**
 * 中间件：确保 device_id 存在，解析用户
 */
async function resolveUser(req, res, next) {
  const deviceId = getDeviceId(req)
  if (!deviceId) {
    // 没有 device_id → MySQL 不可用，前端会用 localStorage 降级
    req.user = null
    return next()
  }
  req.user = await db.getOrCreateUser(deviceId)
  next()
}

router.use(resolveUser)

// ==================== 自选股 Watchlist ====================

// GET /api/user/watchlist → 获取自选股列表
router.get('/watchlist', async (req, res) => {
  if (!req.user) return res.json({ success: false, error: 'device_id required', fallback: true })
  const rows = await db.query(
    'SELECT symbol, name, market, sort_order FROM watchlists WHERE user_id = ? ORDER BY sort_order ASC, added_at ASC',
    [req.user.id]
  )
  res.json({ success: true, data: rows || [] })
})

// POST /api/user/watchlist → 添加自选股
router.post('/watchlist', async (req, res) => {
  if (!req.user) return res.json({ success: false, error: 'device_id required', fallback: true })
  const { symbol, name, market } = req.body
  if (!symbol) return res.status(400).json({ success: false, error: '缺少 symbol' })

  // 获取当前最大 sort_order
  const maxRow = await db.queryOne(
    'SELECT MAX(sort_order) as maxOrder FROM watchlists WHERE user_id = ?',
    [req.user.id]
  )
  const nextOrder = (maxRow?.maxOrder ?? -1) + 1

  await db.insert(
    'INSERT INTO watchlists (user_id, symbol, name, market, sort_order) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order)',
    [req.user.id, symbol, name || '', market || 'CN', nextOrder]
  )
  res.json({ success: true })
})

// DELETE /api/user/watchlist/:symbol → 删除自选股
router.delete('/watchlist/:symbol', async (req, res) => {
  if (!req.user) return res.json({ success: false, error: 'device_id required', fallback: true })
  await db.execute(
    'DELETE FROM watchlists WHERE user_id = ? AND symbol = ?',
    [req.user.id, req.params.symbol]
  )
  res.json({ success: true })
})

// PUT /api/user/watchlist/reorder → 批量排序
router.put('/watchlist/reorder', async (req, res) => {
  if (!req.user) return res.json({ success: false, error: 'device_id required', fallback: true })
  const { symbols } = req.body // 有序数组
  if (!Array.isArray(symbols)) return res.status(400).json({ success: false, error: '需要 symbols 数组' })

  for (let i = 0; i < symbols.length; i++) {
    await db.execute(
      'UPDATE watchlists SET sort_order = ? WHERE user_id = ? AND symbol = ?',
      [i, req.user.id, symbols[i]]
    )
  }
  res.json({ success: true })
})

// ==================== 自定义热门股 Custom Picks ====================

// GET /api/user/picks?market=US → 获取自定义热门股
router.get('/picks', async (req, res) => {
  if (!req.user) return res.json({ success: false, error: 'device_id required', fallback: true })
  const market = req.query.market
  let rows
  if (market) {
    rows = await db.query(
      'SELECT id, symbol, name, market, sort_order FROM custom_picks WHERE user_id = ? AND market = ? ORDER BY sort_order ASC, added_at ASC',
      [req.user.id, market]
    )
  } else {
    rows = await db.query(
      'SELECT id, symbol, name, market, sort_order FROM custom_picks WHERE user_id = ? ORDER BY sort_order ASC, added_at ASC',
      [req.user.id]
    )
  }
  res.json({ success: true, data: rows || [] })
})

// POST /api/user/picks → 添加自定义热门股
router.post('/picks', async (req, res) => {
  if (!req.user) return res.json({ success: false, error: 'device_id required', fallback: true })
  const { symbol, name, market } = req.body
  if (!symbol) return res.status(400).json({ success: false, error: '缺少 symbol' })

  const maxRow = await db.queryOne(
    'SELECT MAX(sort_order) as maxOrder FROM custom_picks WHERE user_id = ? AND market = ?',
    [req.user.id, market || 'CN']
  )
  const nextOrder = (maxRow?.maxOrder ?? -1) + 1

  await db.insert(
    'INSERT INTO custom_picks (user_id, symbol, name, market, sort_order) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order)',
    [req.user.id, symbol, name || '', market || 'CN', nextOrder]
  )
  res.json({ success: true })
})

// DELETE /api/user/picks/:id → 删除自定义热门股
router.delete('/picks/:id', async (req, res) => {
  if (!req.user) return res.json({ success: false, error: 'device_id required', fallback: true })
  await db.execute('DELETE FROM custom_picks WHERE id = ? AND user_id = ?', [req.params.id, req.user.id])
  res.json({ success: true })
})

// PUT /api/user/picks/reorder → 批量排序
router.put('/picks/reorder', async (req, res) => {
  if (!req.user) return res.json({ success: false, error: 'device_id required', fallback: true })
  const { market, symbols } = req.body
  if (!Array.isArray(symbols)) return res.status(400).json({ success: false, error: '需要 symbols 数组' })

  for (let i = 0; i < symbols.length; i++) {
    await db.execute(
      'UPDATE custom_picks SET sort_order = ? WHERE user_id = ? AND symbol = ? AND market = ?',
      [i, req.user.id, symbols[i], market || 'CN']
    )
  }
  res.json({ success: true })
})

// ==================== 仓位管理 Portfolios ====================

// GET /api/user/portfolio → 获取仓位管理数据
router.get('/portfolio', async (req, res) => {
  if (!req.user) return res.json({ success: false, error: 'device_id required', fallback: true })

  const portfolio = await db.queryOne(
    'SELECT current_mode, year_stock_count, month_trade_count, current_holding FROM portfolios WHERE user_id = ?',
    [req.user.id]
  )

  const actions = await db.query(
    'SELECT id, type, symbol, action_date, created_at FROM portfolio_actions WHERE user_id = ? ORDER BY created_at DESC LIMIT 100',
    [req.user.id]
  )

  res.json({
    success: true,
    data: {
      portfolio: portfolio || { current_mode: 'empty', year_stock_count: 0, month_trade_count: 0, current_holding: 0 },
      actions: actions || [],
    },
  })
})

// POST /api/user/portfolio → 更新仓位管理设置和动作
router.post('/portfolio', async (req, res) => {
  if (!req.user) return res.json({ success: false, error: 'device_id required', fallback: true })
  const { current_mode, year_stock_count, month_trade_count, current_holding } = req.body

  await db.insert(
    `INSERT INTO portfolios (user_id, current_mode, year_stock_count, month_trade_count, current_holding)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       current_mode = VALUES(current_mode),
       year_stock_count = VALUES(year_stock_count),
       month_trade_count = VALUES(month_trade_count),
       current_holding = VALUES(current_holding)`,
    [req.user.id, current_mode || 'empty', year_stock_count || 0, month_trade_count || 0, current_holding || 0]
  )
  res.json({ success: true })
})

// POST /api/user/portfolio/action → 记录操作
router.post('/portfolio/action', async (req, res) => {
  if (!req.user) return res.json({ success: false, error: 'device_id required', fallback: true })
  const { type, symbol, date } = req.body
  if (!type || !symbol) return res.status(400).json({ success: false, error: '缺少必要参数' })

  const id = await db.insert(
    'INSERT INTO portfolio_actions (user_id, type, symbol, action_date) VALUES (?, ?, ?, ?)',
    [req.user.id, type, symbol, date || new Date().toLocaleDateString('zh-CN')]
  )
  res.json({ success: true, data: { id } })
})

// DELETE /api/user/portfolio/action/:id → 删除操作
router.delete('/portfolio/action/:id', async (req, res) => {
  if (!req.user) return res.json({ success: false, error: 'device_id required', fallback: true })
  await db.execute('DELETE FROM portfolio_actions WHERE id = ? AND user_id = ?', [req.params.id, req.user.id])
  res.json({ success: true })
})

// ==================== 回测记录 Backtest Records ====================

// GET /api/user/backtests → 获取回测历史
router.get('/backtests', async (req, res) => {
  if (!req.user) return res.json({ success: false, error: 'device_id required', fallback: true })
  const rows = await db.query(
    'SELECT id, strategy, initial_capital, period, total_return, annual_return, max_drawdown, sharpe, created_at FROM backtest_records WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
    [req.user.id]
  )
  res.json({ success: true, data: rows || [] })
})

// POST /api/user/backtests → 保存回测结果
router.post('/backtests', async (req, res) => {
  if (!req.user) return res.json({ success: false, error: 'device_id required', fallback: true })
  const { strategy, initial_capital, period, total_return, annual_return, max_drawdown, sharpe, result_json } = req.body
  if (!strategy) return res.status(400).json({ success: false, error: '缺少策略名称' })

  const id = await db.insert(
    `INSERT INTO backtest_records (user_id, strategy, initial_capital, period, total_return, annual_return, max_drawdown, sharpe, result_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.user.id, strategy, initial_capital || 0, period || 30, total_return || 0, annual_return || 0, max_drawdown || 0, sharpe || 0, result_json ? JSON.stringify(result_json) : null]
  )
  res.json({ success: true, data: { id } })
})

// ==================== 用户偏好 User Preferences ====================

// GET /api/user/preferences → 获取偏好
router.get('/preferences', async (req, res) => {
  if (!req.user) return res.json({ success: false, error: 'device_id required', fallback: true })
  const pref = await db.queryOne(
    'SELECT theme, default_market FROM user_preferences WHERE user_id = ?',
    [req.user.id]
  )
  res.json({ success: true, data: pref || { theme: 'light', default_market: 'CN' } })
})

// PUT /api/user/preferences → 更新偏好
router.put('/preferences', async (req, res) => {
  if (!req.user) return res.json({ success: false, error: 'device_id required', fallback: true })
  const { theme, default_market } = req.body

  await db.insert(
    `INSERT INTO user_preferences (user_id, theme, default_market)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE
       theme = VALUES(theme),
       default_market = VALUES(default_market)`,
    [req.user.id, theme || 'light', default_market || 'CN']
  )
  res.json({ success: true })
})

module.exports = router
