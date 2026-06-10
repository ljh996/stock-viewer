import axios from 'axios'

// 读取 API Token（可从 localStorage 覆盖）
const API_TOKEN = localStorage.getItem('api-token') || 'stock-viewer-default-token'
const JWT_TOKEN = localStorage.getItem('jwt-token')

const api = axios.create({
  baseURL: '/api',
  timeout: 15000,
  headers: {
    'x-api-token': API_TOKEN,
    ...(JWT_TOKEN ? { 'Authorization': `Bearer ${JWT_TOKEN}` } : {}),
  },
})

// 暴露实例给 LoginDialog 等组件使用
if (typeof window !== 'undefined') {
  window.__axiosInstance = api
}

// 请求拦截器：自动附加 JWT token
api.interceptors.request.use(config => {
  const jwt = localStorage.getItem('jwt-token')
  if (jwt) {
    config.headers['Authorization'] = `Bearer ${jwt}`
  }
  config.headers['x-api-token'] = localStorage.getItem('api-token') || 'stock-viewer-default-token'
  return config
})

// 响应拦截器：401 时触发登录事件（但不弹 alert）
let onUnauthorized = null
export function setOnUnauthorized(cb) {
  onUnauthorized = cb
}
api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401 && err.config?.url?.startsWith('/user/')) {
      // 用户数据接口 401 → 可能是 token 过期
      localStorage.removeItem('jwt-token')
      if (onUnauthorized) onUnauthorized()
    }
    return Promise.reject(err)
  }
)

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
