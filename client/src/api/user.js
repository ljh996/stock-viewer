/**
 * 用户数据 API 封装
 *
 * 所有请求携带 X-Device-ID 头用于识别用户
 * API 失败时由组件 fallback 到 localStorage
 */

import axios from 'axios'

const api = axios.create({ baseURL: '/api', timeout: 5000 })

/** 获取或生成本地设备 ID */
export function getDeviceId() {
  let id = localStorage.getItem('device_id')
  if (!id) {
    id = 'dev_' + crypto.randomUUID?.() || 'dev_' + Math.random().toString(36).slice(2, 10)
    localStorage.setItem('device_id', id)
  }
  return id
}

function headers() {
  return { 'X-Device-ID': getDeviceId() }
}

// ==================== 自选股 ====================

export function fetchWatchlist() {
  return api.get('/user/watchlist', { headers: headers() })
}

export function addWatchlist(symbol, name, market) {
  return api.post('/user/watchlist', { symbol, name, market }, { headers: headers() })
}

export function removeWatchlist(symbol) {
  return api.delete(`/user/watchlist/${symbol}`, { headers: headers() })
}

export function reorderWatchlist(symbols) {
  return api.put('/user/watchlist/reorder', { symbols }, { headers: headers() })
}

// ==================== 自定义热门股 ====================

export function fetchPicks(market) {
  return api.get(`/user/picks?market=${market}`, { headers: headers() })
}

export function addPick(symbol, name, market) {
  return api.post('/user/picks', { symbol, name, market }, { headers: headers() })
}

export function removePick(id) {
  return api.delete(`/user/picks/${id}`, { headers: headers() })
}

// ==================== 仓位管理 ====================

export function fetchPortfolio() {
  return api.get('/user/portfolio', { headers: headers() })
}

export function savePortfolio(data) {
  return api.post('/user/portfolio', data, { headers: headers() })
}

export function addPortfolioAction(type, symbol, date) {
  return api.post('/user/portfolio/action', { type, symbol, date }, { headers: headers() })
}

// ==================== 回测记录 ====================

export function fetchBacktests() {
  return api.get('/user/backtests', { headers: headers() })
}

export function saveBacktest(data) {
  return api.post('/user/backtests', data, { headers: headers() })
}

// ==================== 用户偏好 ====================

export function fetchPreferences() {
  return api.get('/user/preferences', { headers: headers() })
}

export function savePreferences(data) {
  return api.put('/user/preferences', data, { headers: headers() })
}
