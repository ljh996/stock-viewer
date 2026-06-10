/**
 * MySQL 连接池模块
 *
 * 封装 mysql2/promise 连接池，提供 CRUD 辅助方法
 * 支持自动降级：MySQL 不可用时返回 null 而非抛出异常
 */

const mysql = require('mysql2/promise')

const DB_CONFIG = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'stockuser',
  password: process.env.DB_PASSWORD || 'stock2024',
  database: process.env.DB_NAME || 'stock',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
}

let _pool = null
let _enabled = false

/**
 * 初始化数据库连接池
 */
async function initDB() {
  try {
    _pool = mysql.createPool(DB_CONFIG)
    // 测试连接
    const conn = await _pool.getConnection()
    await conn.ping()
    conn.release()
    _enabled = true
    console.log('[db] ✅ MySQL 连接成功')
    return true
  } catch (err) {
    _pool = null
    _enabled = false
    console.log(`[db] ⚠️ MySQL 不可用 (${err.message}), 使用 localStorage 降级`)
    return false
  }
}

function isReady() {
  return _enabled && _pool !== null
}

/**
 * 通用查询
 */
async function query(sql, params = []) {
  if (!isReady()) return null
  try {
    const [rows] = await _pool.execute(sql, params)
    return rows
  } catch (err) {
    console.error('[db] 查询失败:', err.message)
    return null
  }
}

/**
 * 查询单行
 */
async function queryOne(sql, params = []) {
  const rows = await query(sql, params)
  if (!rows || rows.length === 0) return null
  return rows[0]
}

/**
 * 插入并返回 insertId
 */
async function insert(sql, params = []) {
  if (!isReady()) return null
  try {
    const [result] = await _pool.execute(sql, params)
    return result.insertId
  } catch (err) {
    console.error('[db] 插入失败:', err.message)
    return null
  }
}

/**
 * 更新/删除，返回 affectedRows
 */
async function execute(sql, params = []) {
  if (!isReady()) return null
  try {
    const [result] = await _pool.execute(sql, params)
    return result.affectedRows
  } catch (err) {
    console.error('[db] 执行失败:', err.message)
    return null
  }
}

/**
 * 根据 device_id 获取或创建用户
 */
async function getOrCreateUser(deviceId) {
  if (!deviceId) return null

  // 先查
  let user = await queryOne('SELECT id, device_id FROM users WHERE device_id = ?', [deviceId])
  if (user) return user

  // 不存在则创建
  const id = await insert('INSERT INTO users (device_id) VALUES (?)', [deviceId])
  if (id) return { id, device_id: deviceId }
  return null
}

/**
 * 关闭连接池
 */
async function close() {
  if (_pool) {
    await _pool.end()
    _pool = null
    _enabled = false
  }
}

module.exports = {
  initDB,
  isReady,
  query,
  queryOne,
  insert,
  execute,
  getOrCreateUser,
  close,
}
