/**
 * 用户认证路由 — 注册 / 登录 / 刷新 Token / 个人信息
 *
 * 依赖: jsonwebtoken, bcryptjs, MySQL (db.js)
 * 配合 middleware/auth.js 的 authJWT 中间件使用
 */

const express = require('express')
const router = express.Router()
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const db = require('../db')

const JWT_SECRET = process.env.JWT_SECRET || 'stock-viewer-jwt-secret-change-me'
const JWT_EXPIRES_IN = '7d'

// ==================== 注册 ====================

router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body

    if (!username || !password) {
      return res.status(400).json({ success: false, error: '用户名和密码不能为空' })
    }
    if (username.length < 2 || username.length > 30) {
      return res.status(400).json({ success: false, error: '用户名长度 2-30 个字符' })
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, error: '密码至少 6 个字符' })
    }

    // 检查用户名是否已存在
    const existing = await db.queryOne('SELECT id FROM users WHERE username = ?', [username])
    if (existing) {
      return res.status(409).json({ success: false, error: '用户名已存在' })
    }

    // 密码哈希
    const salt = bcrypt.genSaltSync(10)
    const passwordHash = bcrypt.hashSync(password, salt)

    // 插入用户
    const id = await db.insert(
      'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
      [username, passwordHash, 'user']
    )

    if (!id) {
      return res.status(500).json({ success: false, error: '注册失败，数据库不可用' })
    }

    // 签发 token
    const token = jwt.sign(
      { userId: id, username, role: 'user' },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    )

    res.json({
      success: true,
      data: {
        token,
        expiresIn: '7d',
        user: { id, username, role: 'user' },
      },
    })
  } catch (err) {
    console.error('[auth] 注册失败:', err.message)
    res.status(500).json({ success: false, error: '注册失败: ' + err.message })
  }
})

// ==================== 登录 ====================

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body

    if (!username || !password) {
      return res.status(400).json({ success: false, error: '用户名和密码不能为空' })
    }

    // 查用户
    const user = await db.queryOne(
      'SELECT id, username, password_hash, role FROM users WHERE username = ?',
      [username]
    )

    if (!user) {
      return res.status(401).json({ success: false, error: '用户名或密码错误' })
    }

    // 验证密码
    if (!bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ success: false, error: '用户名或密码错误' })
    }

    // 更新最后登录时间
    await db.execute('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id])

    // 签发 token
    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    )

    res.json({
      success: true,
      data: {
        token,
        expiresIn: '7d',
        user: { id: user.id, username: user.username, role: user.role },
      },
    })
  } catch (err) {
    console.error('[auth] 登录失败:', err.message)
    res.status(500).json({ success: false, error: '登录失败: ' + err.message })
  }
})

// ==================== 刷新 Token ====================

router.post('/refresh', async (req, res) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: '请提供 token' })
    }

    const oldToken = authHeader.split(' ')[1]
    const decoded = jwt.verify(oldToken, JWT_SECRET, { ignoreExpiration: true })

    // 签发新 token（只有未过期的才能刷新）
    if (decoded.exp && decoded.exp * 1000 < Date.now()) {
      // 已过期超过 30 天的 token 不允许刷新
      const expiredDays = (Date.now() - decoded.exp * 1000) / 86400000
      if (expiredDays > 30) {
        return res.status(401).json({ success: false, error: 'Token 已过期超过 30 天，请重新登录' })
      }
    }

    const token = jwt.sign(
      { userId: decoded.userId, username: decoded.username, role: decoded.role || 'user' },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    )

    res.json({ success: true, data: { token, expiresIn: '7d' } })
  } catch (err) {
    return res.status(401).json({ success: false, error: '无效的 token' })
  }
})

// ==================== 获取当前用户信息 ====================

router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: '请先登录' })
    }

    const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET)

    const user = await db.queryOne(
      'SELECT id, username, role, created_at, last_login FROM users WHERE id = ?',
      [decoded.userId]
    )

    if (!user) {
      return res.status(404).json({ success: false, error: '用户不存在' })
    }

    res.json({ success: true, data: user })
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, error: '登录已过期，请重新登录' })
    }
    return res.status(401).json({ success: false, error: '无效的登录凭证' })
  }
})

module.exports = router
