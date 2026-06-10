/**
 * 缓存模块 - Redis + 内存降级
 *
 * 使用方式:
 *   const { initCache, getOrFetch } = require('./cache')
 *   await initCache()
 *   const data = await getOrFetch('key', async () => { ... }, 30) // 30秒过期
 *
 * 设计:
 *   - 优先连接 Redis，连不上自动降级到内存 Map 缓存
 *   - getOrFetch 的 fetchFn 抛出异常时不会缓存，异常透传
 *   - 支持环境变量 REDIS_HOST / REDIS_PORT / REDIS_PASSWORD
 */

const Redis = require('ioredis')

// ==================== 内存缓存（Redis 不可用时的降级方案） ====================

class MemoryCache {
  constructor() {
    this._store = new Map()
    this._timer = setInterval(() => this._cleanup(), 30000) // 每 30s 清理过期项
  }

  async get(key) {
    const entry = this._store.get(key)
    if (!entry) return null
    if (Date.now() > entry.expiresAt) {
      this._store.delete(key)
      return null
    }
    return entry.value
  }

  async set(key, value, ttlSeconds) {
    this._store.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    })
  }

  async del(key) {
    this._store.delete(key)
  }

  async flush() {
    this._store.clear()
  }

  get size() {
    return this._store.size
  }

  _cleanup() {
    const now = Date.now()
    for (const [key, entry] of this._store) {
      if (now > entry.expiresAt) this._store.delete(key)
    }
  }
}

// ==================== 缓存客户端 ====================

let _redis = null      // Redis 客户端（连上时才有值）
let _mem = null        // 内存缓存（Redis 连不上时才有值）

/**
 * 初始化缓存
 * 优先连 Redis，失败则用内存缓存
 */
async function initCache() {
  // 尝试 Redis
  try {
    _redis = new Redis({
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD || undefined,
      lazyConnect: true,
      connectTimeout: 3000,
      maxRetriesPerRequest: 0,     // 不自动重试
      retryStrategy: () => null,   // 不重连
    })
    await _redis.connect()
    console.log('[cache] ✅ Redis 连接成功')
    _redis.on('error', (err) => {
      console.log('[cache] Redis 连接断开，降级到内存缓存')
      _redis = null
      if (!_mem) _mem = new MemoryCache()
    })
    return
  } catch (err) {
    console.log(`[cache] ⚠️ Redis 不可用 (${err.message}), 使用内存缓存`)
  }

  // 降级到内存
  _mem = new MemoryCache()
}

function _isReady() {
  return _redis !== null || _mem !== null
}

/**
 * 获取缓存
 */
async function get(key) {
  if (_redis) {
    const val = await _redis.get(key)
    return val ? JSON.parse(val) : null
  }
  if (_mem) return _mem.get(key)
  return null
}

/**
 * 设置缓存
 */
async function set(key, value, ttlSeconds) {
  if (_redis) {
    await _redis.set(key, JSON.stringify(value), 'EX', ttlSeconds)
  } else if (_mem) {
    await _mem.set(key, value, ttlSeconds)
  }
}

/**
 * 删除缓存
 */
async function del(key) {
  if (_redis) await _redis.del(key)
  else if (_mem) await _mem.del(key)
}

/**
 * 清空所有缓存
 */
async function flushAll() {
  if (_redis) await _redis.flushall()
  else if (_mem) await _mem.flush()
}

/**
 * 核心：先读缓存，有则返回；没有则调用 fetchFn 获取，写入缓存后返回
 *
 * @param {string} key       缓存键
 * @param {Function} fetchFn 数据获取函数（返回 Promise）
 * @param {number} ttlSeconds 缓存过期秒数
 * @returns {Promise<any>}   数据
 *
 * fetchFn 如果 throw，数据不会写入缓存，异常会继续往上抛
 */
async function getOrFetch(key, fetchFn, ttlSeconds) {
  // 1. 读缓存
  if (_isReady()) {
    const cached = await get(key)
    if (cached !== null && cached !== undefined) {
      return cached
    }
  }

  // 2. fetchFn 取新数据
  const data = await fetchFn()

  // 3. 写入缓存（仅当有返回值）
  if (data !== null && data !== undefined) {
    await set(key, data, ttlSeconds)
  }

  return data
}

module.exports = { initCache, getOrFetch, get, set, del, flushAll }
