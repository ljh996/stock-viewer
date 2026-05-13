import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  timeout: 15000,
})

// 美股
export function fetchUSStock(symbol) {
  return api.get(`/stock/us/${symbol}`)
}

export function fetchUSHistory(symbol) {
  return api.get(`/stock/us/${symbol}/history`)
}

// A股
export function fetchCNStock(symbol) {
  return api.get(`/stock/cn/${symbol}`)
}

export function fetchCNHistory(symbol) {
  return api.get(`/stock/cn/${symbol}/history`)
}

// 搜索（按名称/代码）
export function searchUS(keyword) {
  return api.get(`/search/us/${keyword}`)
}

export function searchCN(keyword) {
  return api.get(`/search/cn/${keyword}`)
}

// 今日涨停股列表
export function fetchLimitUpToday() {
  return api.get('/limit-up/today')
}

// 检查某只股票近一个月涨停记录
export function fetchLimitUpCheck(symbol) {
  return api.get(`/limit-up/check/${symbol}`)
}

// 策略选股
export function fetchStrategyConservative() {
  return api.get('/strategy/conservative', { timeout: 60000 })
}

export function fetchStrategyGarp() {
  return api.get('/strategy/garp', { timeout: 60000 })
}

export function fetchStrategyMomentum() {
  return api.get('/strategy/momentum', { timeout: 60000 })
}

export function fetchStrategyPotential() {
  return api.get('/strategy/potential', { timeout: 120000 })
}

export function fetchStrategyLimitback() {
  return api.get('/strategy/limitback', { timeout: 120000 })
}

export function fetchStrategyMaBullish() {
  return api.get('/strategy/ma-bullish', { timeout: 120000 })
}

// 策略回测
export function runBacktest(strategy, initialCapital, period) {
  return api.post('/backtest', { strategy, initialCapital, period }, { timeout: 60000 })
}
