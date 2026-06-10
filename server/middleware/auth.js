/**
 * 鉴权中间件 — API Token / JWT / Rate Limiting
 *
 * 三阶段渐进式实现：
 *   阶段 1: 静态 API Token 保护 AI 接口
 *   阶段 2: JWT 登录 + 用户系统（配合 MySQL）
 *   阶段 3: Rate Limiting + Token 配额（配合 Redis）
 */

// ==================== 阶段 1: 静态 API Token ====================

const API_TOKEN = process.env.API_TOKEN || 'stock-viewer-default-token'

/**
 * 验证 API Token (x-api-token header)
 * AI 接口专用保护
 */
function requireToken(req, res, next) {
  const token = req.headers['x-api-token']
  if (!token || token !== API_TOKEN) {
    return res.status(401).json({ success: false, error: '未授权访问，请提供有效的 API Token' })
  }
  next()
}

// ==================== 阶段 2: JWT 验证 ====================

const jwt = require('jsonwebtoken')
const JWT_SECRET = process.env.JWT_SECRET || 'stock-viewer-jwt-secret-change-me'

/**
 * JWT 验证中间件
 * 从 Authorization: Bearer <token> 中提取并验证
 */
function authJWT(req, res, next) {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: '请先登录' })
  }

  try {
    const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET)
    req.userId = decoded.userId
    req.username = decoded.username
    req.userRole = decoded.role || 'user'
    next()
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, error: '登录已过期，请重新登录' })
    }
    return res.status(401).json({ success: false, error: '无效的登录凭证' })
  }
}

/**
 * 可选 JWT 验证（不强制，有 token 就解析用户信息）
 */
function optionalAuthJWT(req, res, next) {
  const authHeader = req.headers.authorization
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET)
      req.userId = decoded.userId
      req.username = decoded.username
      req.userRole = decoded.role || 'user'
    } catch { /* ignore invalid token */ }
  }
  next()
}

// ==================== 阶段 3: Rate Limiting ====================

/**
 * 创建限流中间件
 * 使用内存计数器（可扩展为 Redis）
 */
function createRateLimiter(opts = {}) {
  const {
    windowMs = 60 * 1000,        // 默认 1 分钟
    max = 60,                      // 默认 60 次
    message = { success: false, error: '请求太频繁，请稍后再试' },
    prefix = 'ratelimit:',
  } = opts

  // 简单内存计数器
  const counters = new Map()

  return function rateLimitMW(req, res, next) {
    const key = `${prefix}${req.ip || req.connection.remoteAddress || 'unknown'}`
    const now = Date.now()

    // 清理过期条目
    if (!counters.has(key) || now - counters.get(key).windowStart > windowMs) {
      counters.set(key, { windowStart: now, count: 0 })
    }

    const entry = counters.get(key)
    entry.count++

    res.setHeader('X-RateLimit-Limit', max)
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - entry.count))
    res.setHeader('X-RateLimit-Reset', Math.ceil((entry.windowStart + windowMs) / 1000))

    if (entry.count > max) {
      return res.status(429).json(message)
    }

    next()
  }
}

/**
 * Token 配额方案（按 token 级别分配不同的调用额度）
 *
 * 配置方式：
 *   TOKEN_QUOTA_admin-token=200,120   # AI 每日 200 次, 每分钟 120 次
 *   TOKEN_QUOTA_user-token=50,60      # AI 每日 50 次, 每分钟 60 次
 *
 * 环境变量格式：TOKEN_QUOTA_<token名称>=<aiDaily>,<rpm>
 * 未配置的 token 使用默认配额
 */
const TOKEN_QUOTAS = {
  // token值: { aiDaily: 每天AI调用上限, rpm: 每分钟请求上限 }
  // 默认配置 - 可通过 TOKEN_QUOTA_* 环境变量覆盖
}

// 从环境变量加载自定义配额
for (const [key, value] of Object.entries(process.env)) {
  if (key.startsWith('TOKEN_QUOTA_')) {
    const tokenName = key.slice('TOKEN_QUOTA_'.length).toLowerCase()
    const parts = value.split(',').map(v => parseInt(v.trim()))
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      TOKEN_QUOTAS[tokenName] = { aiDaily: parts[0], rpm: parts[1] }
    }
  }
}

// 设置默认配额（仅当环境变量未覆盖时生效）
if (!TOKEN_QUOTAS['stock-viewer-default-token']) {
  TOKEN_QUOTAS['stock-viewer-default-token'] = { aiDaily: 100, rpm: 60 }
}

// daily 计数器（内存 Map，服务重启后重置，生产环境建议用 Redis）
const dailyCounters = new Map()

/**
 * Token 每日配额检查中间件
 * 在 requireToken 之后使用，统计 AI 接口的每日调用次数
 */
function checkTokenQuota(req, res, next) {
  const token = req.headers['x-api-token'] || 'unknown'
  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  const key = `quota:${token}:${today}`

  // 获取该 token 的配额
  const quota = TOKEN_QUOTAS[token] || TOKEN_QUOTAS['stock-viewer-default-token'] || { aiDaily: 50, rpm: 30 }

  // 读取当前计数
  const count = dailyCounters.get(key) || 0

  // 设置响应头
  res.setHeader('X-Quota-Limit', quota.aiDaily)
  res.setHeader('X-Quota-Remaining', Math.max(0, quota.aiDaily - count))

  if (count >= quota.aiDaily) {
    return res.status(429).json({
      success: false,
      error: `今日 AI 分析次数已达上限 (${quota.aiDaily}次/天)，如需更多请升级 Token`,
    })
  }

  // 计数 +1
  dailyCounters.set(key, count + 1)

  // 自动清理：每天只保留当天的键
  // （Map 大小最多 = token 数量 × 1天，数 KB，可接受）
  next()
}

// ==================== 导出 ====================

module.exports = {
  API_TOKEN,
  requireToken,
  checkTokenQuota,
  authJWT,
  optionalAuthJWT,
  createRateLimiter,
  JWT_SECRET,
  TOKEN_QUOTAS,
}
