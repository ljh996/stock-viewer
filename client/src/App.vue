<template>
  <div class="app">
    <!-- Header -->
    <header class="header">
      <div class="header-title">
        <span>📈</span>
        <span>股票行情查看器</span>
      </div>
      <span class="header-badge">Vue3 + Express</span>
    </header>

    <!-- Top Tab Bar -->
    <nav class="top-tab-bar">
      <div class="top-tab-bar-inner">
        <button
          v-for="tab in mainTabs"
          :key="tab.key"
          class="top-tab-btn"
          :class="{ active: activeTab === tab.key }"
          @click="activeTab = tab.key"
        >
          <span class="top-tab-icon">{{ tab.icon }}</span>
          <span class="top-tab-label">{{ tab.label }}</span>
        </button>
      </div>
    </nav>

    <main class="main-container">
      <!-- ==================== Tab 1: 行情查询 ==================== -->
      <div v-show="activeTab === 'quote'">
        <!-- Search Card -->
        <div class="card" style="margin-bottom: 16px;">
          <div class="card-body" style="padding: 12px 16px;">
            <form class="search-bar" @submit.prevent="handleSearch">
              <div class="market-tabs">
                <button type="button" class="market-tab" :class="{ active: market === 'CN' }" @click="switchMarket('CN')">A股</button>
                <button type="button" class="market-tab" :class="{ active: market === 'US' }" @click="switchMarket('US')">美股</button>
              </div>
              <div class="search-input-wrapper">
                <input
                  class="search-input"
                  :placeholder="market === 'US' ? '输入代码或名称，如 AAPL、Apple' : '输入代码或名称，如 600519、茅台'"
                  v-model="searchQuery"
                  @input="onSearchInput"
                  @focus="showDropdown = searchResults.length > 0"
                  autocomplete="off"
                />
                <!-- Search Dropdown -->
                <div v-if="showDropdown && searchResults.length > 0" class="search-dropdown">
                  <div
                    v-for="(item, idx) in searchResults"
                    :key="idx"
                    class="search-dropdown-item"
                    @mousedown.prevent="selectSearchResult(item)"
                  >
                    <span class="search-dropdown-symbol">{{ item.symbol }}</span>
                    <span class="search-dropdown-name">{{ item.name }}</span>
                  </div>
                </div>
                <button class="btn btn-primary" type="submit" :disabled="loading || !searchQuery.trim()" style="flex-shrink: 0;">
                  <span v-if="loading" class="loading-spinner"></span>
                  <span v-else>🔍</span>
                  查询
                </button>
              </div>
            </form>

            <!-- Custom Quick Picks -->
            <div class="quick-picks">
              <div class="quick-picks-label">
                热门股票：
                <button class="quick-pick-add-btn" @click="showAddPick = true" title="添加自定义热门股票">+</button>
              </div>
              <div class="quick-picks-list">
                <div
                  v-for="(s, idx) in currentCustomPicks"
                  :key="s.symbol"
                  class="quick-pick-btn-wrapper"
                >
                  <button
                    class="quick-pick-btn"
                    @click="handleQuickSearch(s.symbol)"
                  >{{ s.symbol }} · {{ s.name }}</button>
                  <button class="quick-pick-remove" @click="removeCustomPick(idx)" title="移除">✕</button>
                </div>
              </div>
              <!-- Add Custom Pick Dialog -->
              <div v-if="showAddPick" class="add-pick-dialog">
                <input
                  class="add-pick-input"
                  v-model="addPickSymbol"
                  placeholder="输入股票代码"
                  @keyup.enter="confirmAddPick"
                />
                <input
                  class="add-pick-input"
                  v-model="addPickName"
                  placeholder="输入股票名称"
                  @keyup.enter="confirmAddPick"
                />
                <button class="btn btn-primary btn-sm" @click="confirmAddPick" :disabled="!addPickSymbol.trim()">添加</button>
                <button class="btn btn-ghost btn-sm" @click="showAddPick = false; addPickSymbol = ''; addPickName = ''">取消</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Error / Retry Message -->
        <div v-if="error" class="error-msg">
          {{ error }}
          <button v-if="retryAvailable" class="btn btn-sm" style="margin-left: 8px; height: 28px; font-size: 12px;" @click="handleRetry">
            🔄 重试
          </button>
        </div>

        <!-- Stock Detail -->
        <template v-if="selectedStock">
          <!-- Loading Skeleton -->
          <div v-if="loading" class="card" style="margin-bottom: 16px;">
            <div class="card-body">
              <div class="skeleton skeleton-line w-48 h-8"></div>
              <div class="skeleton skeleton-line w-32 h-6"></div>
              <div class="skeleton skeleton-line w-full"></div>
              <div class="skeleton skeleton-line w-full h-40"></div>
            </div>
          </div>

          <!-- Quote Card -->
          <div v-if="!loading" class="card" style="margin-bottom: 16px;">
            <div class="card-body">
              <div class="stock-header">
                <div>
                  <div class="stock-symbol">{{ selectedStock.symbol }}</div>
                  <div class="stock-name">{{ selectedStock.name }}</div>
                  <div class="stock-badges">
                    <span class="badge badge-outline">{{ selectedStock.market === 'US' ? '美股' : 'A股' }}</span>
                    <span class="badge badge-secondary">{{ selectedStock.currency }}</span>
                  </div>
                </div>
                <button
                  class="btn btn-sm"
                  :class="isInWatchlist ? 'btn-star active' : 'btn-primary'"
                  @click="toggleWatchlist"
                >{{ isInWatchlist ? '⭐ 已收藏' : '☆ 加自选' }}</button>
              </div>

              <div class="price-row">
                <span class="price-value">{{ formatPrice(selectedStock.price, selectedStock.currency) }}</span>
                <span class="price-change" :class="(selectedStock.change || 0) >= 0 ? 'text-green' : 'text-red'">
                  {{ (selectedStock.change || 0) >= 0 ? '▲' : '▼' }}
                  {{ ((selectedStock.change || 0) >= 0 ? '+' : '') + (selectedStock.change || 0).toFixed(2) }}
                  ({{ ((selectedStock.changePercent || 0) >= 0 ? '+' : '') + (selectedStock.changePercent || 0).toFixed(2) }}%)
                </span>
              </div>

              <div class="divider"></div>

              <div class="detail-grid">
                <div>
                  <div class="detail-item-label">开盘价</div>
                  <div class="detail-item-value">{{ formatPrice(selectedStock.open, selectedStock.currency) }}</div>
                </div>
                <div>
                  <div class="detail-item-label">最高价</div>
                  <div class="detail-item-value text-green">{{ formatPrice(selectedStock.high, selectedStock.currency) }}</div>
                </div>
                <div>
                  <div class="detail-item-label">最低价</div>
                  <div class="detail-item-value text-red">{{ formatPrice(selectedStock.low, selectedStock.currency) }}</div>
                </div>
                <div>
                  <div class="detail-item-label">昨收</div>
                  <div class="detail-item-value">{{ formatPrice(selectedStock.previousClose, selectedStock.currency) }}</div>
                </div>
                <div>
                  <div class="detail-item-label">成交量</div>
                  <div class="detail-item-value">📊 {{ formatNumber(selectedStock.volume) }}</div>
                </div>
                <div>
                  <div class="detail-item-label">涨跌额</div>
                  <div class="detail-item-value" :class="(selectedStock.change || 0) >= 0 ? 'text-green' : 'text-red'">
                    {{ ((selectedStock.change || 0) >= 0 ? '+' : '') + (selectedStock.change || 0).toFixed(2) }}
                  </div>
                </div>
                <div>
                  <div class="detail-item-label">涨跌幅</div>
                  <div class="detail-item-value" :class="(selectedStock.changePercent || 0) >= 0 ? 'text-green' : 'text-red'">
                    {{ ((selectedStock.changePercent || 0) >= 0 ? '+' : '') + (selectedStock.changePercent || 0).toFixed(2) }}%
                  </div>
                </div>
                <div>
                  <div class="detail-item-label">振幅</div>
                  <div class="detail-item-value">
                    {{ (selectedStock.previousClose || 0) > 0
                      ? (((selectedStock.high || 0) - (selectedStock.low || 0)) / selectedStock.previousClose * 100).toFixed(2) + '%'
                      : '-' }}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Signal Alert + Risk Check -->
          <div v-if="!loading" class="analysis-grid" style="margin-bottom: 16px;">
            <div class="card">
              <div class="card-body">
                <SignalAlert :stock="selectedStock" />
              </div>
            </div>
            <div class="card">
              <div class="card-body">
                <RiskCheck />
              </div>
            </div>
          </div>

          <!-- Chart Card -->
          <div v-if="!loading" class="card" style="margin-bottom: 16px;">
            <div class="card-header">
              <div class="card-title">📉 近30日走势</div>
            </div>
            <div class="card-body">
              <div v-if="historyLoading" class="skeleton" style="height: 200px;"></div>
              <HistoryChart v-else :data="history" />
            </div>
          </div>

          <!-- History Table Card -->
          <div v-if="!loading && history.length > 0" class="card" style="margin-bottom: 16px;">
            <div class="card-header">
              <div class="card-title">💵 历史数据明细</div>
            </div>
            <div class="history-table-wrapper">
              <table class="history-table">
                <thead>
                  <tr>
                    <th>日期</th><th>开盘</th><th>最高</th><th>最低</th><th>收盘</th><th>成交量</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(d, i) in [...history].reverse()" :key="i">
                    <td>{{ d.date }}</td>
                    <td>{{ d.open?.toFixed(2) }}</td>
                    <td class="text-green">{{ d.high?.toFixed(2) }}</td>
                    <td class="text-red">{{ d.low?.toFixed(2) }}</td>
                    <td :class="d.close - d.open >= 0 ? 'text-green' : 'text-red'" style="font-weight: 600;">
                      {{ d.close?.toFixed(2) }}
                    </td>
                    <td>{{ formatNumber(d.volume) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </template>

        <!-- Empty State (no stock selected and not loading) -->
        <div v-if="!selectedStock && !loading" class="card" style="margin-bottom: 16px;">
          <div class="empty-state">
            <div class="empty-state-icon">📊</div>
            <div class="empty-state-text">搜索股票查看行情</div>
            <div class="empty-state-hint">输入股票代码或名称，或点击上方热门股票快速查看</div>
          </div>
        </div>
      </div>

      <!-- ==================== Tab 2: 涨停分析 ==================== -->
      <div v-show="activeTab === 'limitup'">
        <div v-if="market === 'US'" class="card" style="margin-bottom: 16px;">
          <div class="empty-state">
            <div class="empty-state-icon">🔥</div>
            <div class="empty-state-text">请切换到A股查看涨停数据</div>
            <div class="empty-state-hint">涨停分析仅支持A股市场</div>
          </div>
        </div>
        <div v-else class="card" style="margin-bottom: 16px;">
          <div class="card-body">
            <LimitUpPanel @select-stock="handleLimitUpSelect" />
          </div>
        </div>
      </div>

      <!-- ==================== Tab 3: 策略选股 ==================== -->
      <div v-show="activeTab === 'strategy'">
        <div v-if="market === 'US'" class="card" style="margin-bottom: 16px;">
          <div class="empty-state">
            <div class="empty-state-icon">📊</div>
            <div class="empty-state-text">请切换到A股查看策略选股</div>
            <div class="empty-state-hint">策略选股仅支持A股市场</div>
          </div>
        </div>
        <div v-else class="card" style="margin-bottom: 16px;">
          <div class="card-body">
            <StrategyPanel @select-stock="handleStrategySelect" />
          </div>
        </div>
      </div>

      <!-- ==================== Tab 4: 交易助手 ==================== -->
      <div v-show="activeTab === 'trading'">
        <div class="card" style="margin-bottom: 16px;">
          <div class="card-header">
            <div class="card-title">📋 仓位管理</div>
          </div>
          <div class="card-body">
            <PositionManager />
          </div>
        </div>
        <div class="card" style="margin-bottom: 16px;">
          <div class="card-header">
            <div class="card-title">📜 交易规则</div>
          </div>
          <div class="card-body">
            <TradingRules />
          </div>
        </div>
      </div>

      <!-- ==================== Tab 5: 自选股 ==================== -->
      <div v-show="activeTab === 'watchlist'">
        <div class="card" style="margin-bottom: 16px;">
          <div class="card-header">
            <div class="card-title">
              ⭐ 自选股
              <span class="badge badge-secondary">{{ watchlist.length }}</span>
            </div>
            <button v-if="watchlist.length > 0" class="btn btn-ghost btn-sm" @click="refreshWatchlist" :disabled="loading">
              <span v-if="loading" class="loading-spinner"></span>
              🔄 刷新
            </button>
          </div>
          <div class="card-body" style="padding: 8px;">
            <div v-if="watchlist.length === 0" class="empty-state">
              <div class="empty-state-icon">⭐</div>
              <div class="empty-state-text">暂无自选股</div>
              <div class="empty-state-hint">搜索股票后点击"加自选"</div>
            </div>
            <div v-for="stock in watchlist" :key="stock.symbol" class="watchlist-item" @click="handleWatchlistClick(stock)">
              <div class="watchlist-left">
                <div class="watchlist-symbol">
                  {{ stock.symbol }}
                  <span class="badge badge-outline" style="font-size: 10px; padding: 0 4px;">
                    {{ stock.market === 'US' ? '美股' : 'A股' }}
                  </span>
                </div>
                <div class="watchlist-name">{{ stock.name }}</div>
              </div>
              <div class="watchlist-right">
                <div class="watchlist-price">
                  <div class="watchlist-price-value">{{ formatPrice(stock.price, stock.currency) }}</div>
                  <div class="watchlist-price-change" :class="(stock.change || 0) >= 0 ? 'text-green' : 'text-red'">
                    {{ ((stock.change || 0) >= 0 ? '+' : '') + (stock.change || 0).toFixed(2) }}
                    ({{ ((stock.changePercent || 0) >= 0 ? '+' : '') + (stock.changePercent || 0).toFixed(2) }}%)
                  </div>
                </div>
                <button class="watchlist-remove" @click.stop="removeFromWatchlist(stock.symbol)">✕</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ==================== Tab 6: 技术指标 ==================== -->
      <div v-show="activeTab === 'indicators'">
        <div class="card" style="margin-bottom: 16px;">
          <div class="card-header">
            <div class="card-title">📐 技术指标分析</div>
          </div>
          <div class="card-body">
            <TechnicalIndicators :data="history" />
          </div>
        </div>
      </div>

      <!-- ==================== Tab 7: 回测分析 ==================== -->
      <div v-show="activeTab === 'backtest'">
        <div class="card" style="margin-bottom: 16px;">
          <div class="card-body">
            <BacktestPanel />
          </div>
        </div>
      </div>
    </main>

    <footer class="footer">
      <p>股票行情查看器 · Vue3 + Express · 数据来源：stockprices.dev / 新浪财经</p>
      <p style="margin-top: 4px;">数据仅供参考，不构成任何投资建议</p>
    </footer>
  </div>
</template>

<script>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { fetchUSStock, fetchUSHistory, fetchCNStock, fetchCNHistory, searchUS, searchCN } from './api/stock.js'
import HistoryChart from './components/HistoryChart.vue'
import SignalAlert from './components/SignalAlert.vue'
import RiskCheck from './components/RiskCheck.vue'
import PositionManager from './components/PositionManager.vue'
import TradingRules from './components/TradingRules.vue'
import LimitUpPanel from './components/LimitUpPanel.vue'
import StrategyPanel from './components/StrategyPanel.vue'
import BacktestPanel from './components/BacktestPanel.vue'
import TechnicalIndicators from './components/TechnicalIndicators.vue'

const DEFAULT_POPULAR_US = [
  { symbol: 'AAPL', name: '苹果' },
  { symbol: 'GOOGL', name: '谷歌' },
  { symbol: 'MSFT', name: '微软' },
  { symbol: 'TSLA', name: '特斯拉' },
  { symbol: 'AMZN', name: '亚马逊' },
  { symbol: 'NVDA', name: '英伟达' },
]

const DEFAULT_POPULAR_CN = [
  { symbol: '600519', name: '贵州茅台' },
  { symbol: '000858', name: '五粮液' },
  { symbol: '601318', name: '中国平安' },
  { symbol: '000001', name: '平安银行' },
  { symbol: '600036', name: '招商银行' },
  { symbol: '002594', name: '比亚迪' },
]

const CUSTOM_PICKS_KEY = 'stock-custom-picks'
const WATCHLIST_KEY = 'stock-watchlist'
const REQUEST_TIMEOUT = 15000
const MAX_RETRIES = 2

export default {
  name: 'App',
  components: { HistoryChart, SignalAlert, RiskCheck, PositionManager, TradingRules, LimitUpPanel, StrategyPanel, BacktestPanel, TechnicalIndicators },
  setup() {
    const market = ref('CN')
    const searchQuery = ref('')
    const selectedStock = ref(null)
    const watchlist = ref([])
    const history = ref([])
    const loading = ref(false)
    const historyLoading = ref(false)
    const error = ref('')
    const retryAvailable = ref(false)

    // Main tab
    const activeTab = ref('limitup')

    // Search dropdown
    const searchResults = ref([])
    const showDropdown = ref(false)
    let debounceTimer = null

    // Custom picks
    const customPicksUS = ref([])
    const customPicksCN = ref([])
    const showAddPick = ref(false)
    const addPickSymbol = ref('')
    const addPickName = ref('')

    // Last search for retry
    let lastSearchParams = null

    const mainTabs = [
      { key: 'limitup', icon: '🔥', label: '涨停分析' },
      { key: 'quote', icon: '📈', label: '行情查询' },
      { key: 'strategy', icon: '📊', label: '策略选股' },
      { key: 'backtest', icon: '📉', label: '策略回测' },
      { key: 'trading', icon: '📋', label: '交易助手' },
      { key: 'watchlist', icon: '⭐', label: '自选股' },
      { key: 'indicators', icon: '📐', label: '技术指标' },
    ]

    const currentCustomPicks = computed(() => {
      return market.value === 'US' ? customPicksUS.value : customPicksCN.value
    })

    const isInWatchlist = computed(() => {
      return selectedStock.value ? watchlist.value.some(s => s.symbol === selectedStock.value.symbol) : false
    })

    // --- Lifecycle ---
    onMounted(() => {
      // Load watchlist (default hot A-stocks if empty)
      try {
        const saved = localStorage.getItem(WATCHLIST_KEY)
        if (saved) {
          watchlist.value = JSON.parse(saved)
        } else {
          // 默认热门A股
          watchlist.value = [
            { symbol: '600519', name: '贵州茅台', market: 'CN' },
            { symbol: '000858', name: '五粮液', market: 'CN' },
            { symbol: '601318', name: '中国平安', market: 'CN' },
            { symbol: '300750', name: '宁德时代', market: 'CN' },
            { symbol: '002594', name: '比亚迪', market: 'CN' },
            { symbol: '600036', name: '招商银行', market: 'CN' },
            { symbol: '000333', name: '美的集团', market: 'CN' },
            { symbol: '600809', name: '山西汾酒', market: 'CN' },
          ]
          localStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlist.value))
        }
      } catch { /* ignore */ }

      // Load custom picks
      loadCustomPicks()

      // 默认展示茅台行情
      searchQuery.value = '600519'
      searchStock('600519', 'CN')

      // Close dropdown on outside click
      document.addEventListener('click', handleOutsideClick)
    })

    onUnmounted(() => {
      document.removeEventListener('click', handleOutsideClick)
      if (debounceTimer) clearTimeout(debounceTimer)
    })

    // --- Custom Picks ---
    function loadCustomPicks() {
      try {
        const saved = localStorage.getItem(CUSTOM_PICKS_KEY)
        if (saved) {
          const parsed = JSON.parse(saved)
          customPicksUS.value = parsed.US || [...DEFAULT_POPULAR_US]
          customPicksCN.value = parsed.CN || [...DEFAULT_POPULAR_CN]
        } else {
          customPicksUS.value = [...DEFAULT_POPULAR_US]
          customPicksCN.value = [...DEFAULT_POPULAR_CN]
        }
      } catch {
        customPicksUS.value = [...DEFAULT_POPULAR_US]
        customPicksCN.value = [...DEFAULT_POPULAR_CN]
      }
    }

    function saveCustomPicks() {
      localStorage.setItem(CUSTOM_PICKS_KEY, JSON.stringify({
        US: customPicksUS.value,
        CN: customPicksCN.value,
      }))
    }

    function removeCustomPick(idx) {
      const list = market.value === 'US' ? customPicksUS : customPicksCN
      list.value.splice(idx, 1)
      saveCustomPicks()
    }

    function confirmAddPick() {
      if (!addPickSymbol.value.trim()) return
      const newPick = {
        symbol: addPickSymbol.value.trim().toUpperCase(),
        name: addPickName.value.trim() || addPickSymbol.value.trim(),
      }
      const list = market.value === 'US' ? customPicksUS : customPicksCN
      // Avoid duplicates
      if (!list.value.some(s => s.symbol === newPick.symbol)) {
        list.value.push(newPick)
        saveCustomPicks()
      }
      addPickSymbol.value = ''
      addPickName.value = ''
      showAddPick.value = false
    }

    // --- Search with debounce ---
    function onSearchInput() {
      if (debounceTimer) clearTimeout(debounceTimer)
      const query = searchQuery.value.trim()
      if (!query) {
        searchResults.value = []
        showDropdown.value = false
        return
      }
      debounceTimer = setTimeout(() => {
        performSearch(query)
      }, 300)
    }

    async function performSearch(keyword) {
      try {
        const searchFn = market.value === 'US' ? searchUS : searchCN
        const res = await searchFn(keyword)
        if (res.data && res.data.success && Array.isArray(res.data.data)) {
          searchResults.value = res.data.data.slice(0, 10)
          showDropdown.value = searchResults.value.length > 0
        } else {
          searchResults.value = []
          showDropdown.value = false
        }
      } catch {
        searchResults.value = []
        showDropdown.value = false
      }
    }

    function selectSearchResult(item) {
      searchQuery.value = item.symbol
      showDropdown.value = false
      searchResults.value = []
      searchStock(item.symbol, market.value)
    }

    function handleOutsideClick(e) {
      // Close dropdown if clicking outside
      const wrapper = document.querySelector('.search-input-wrapper')
      if (wrapper && !wrapper.contains(e.target)) {
        showDropdown.value = false
      }
    }

    // --- Market switch ---
    function switchMarket(mkt) {
      market.value = mkt
      searchResults.value = []
      showDropdown.value = false
      showAddPick.value = false
    }

    // --- Timeout helper ---
    function withTimeout(promise, ms) {
      return Promise.race([
        promise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('请求超时，请检查网络后重试')), ms)
        ),
      ])
    }

    // --- Fetch with retry ---
    async function fetchWithRetry(fetchFn, retries = MAX_RETRIES) {
      let lastError = null
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          return await withTimeout(fetchFn(), REQUEST_TIMEOUT)
        } catch (err) {
          lastError = err
          if (attempt < retries) {
            // Wait a bit before retrying
            await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)))
          }
        }
      }
      throw lastError
    }

    // --- Main search ---
    async function searchStock(symbol, mkt) {
      if (!symbol.trim()) return
      loading.value = true
      error.value = ''
      retryAvailable.value = false
      selectedStock.value = null
      history.value = []
      lastSearchParams = { symbol: symbol.trim(), mkt }

      try {
        const fetchQuote = mkt === 'US' ? fetchUSStock : fetchCNStock
        const fetchHist = mkt === 'US' ? fetchUSHistory : fetchCNHistory

        const quoteRes = await fetchWithRetry(() => fetchQuote(symbol.trim()))
        if (quoteRes.data.success) {
          selectedStock.value = quoteRes.data.data
        } else {
          error.value = quoteRes.data.error || '获取数据失败'
          retryAvailable.value = true
          loading.value = false
          return
        }

        historyLoading.value = true
        try {
          const histRes = await fetchWithRetry(() => fetchHist(symbol.trim()))
          if (histRes.data.success) {
            history.value = histRes.data.data
          }
        } catch {
          history.value = []
        } finally {
          historyLoading.value = false
        }
      } catch (err) {
        const msg = err.message || '网络请求失败，请检查后端服务是否启动'
        error.value = msg.includes('超时')
          ? `${msg}（已重试${MAX_RETRIES}次）`
          : msg
        retryAvailable.value = true
      } finally {
        loading.value = false
      }
    }

    function handleSearch() {
      searchStock(searchQuery.value, market.value)
    }

    function handleRetry() {
      if (lastSearchParams) {
        searchStock(lastSearchParams.symbol, lastSearchParams.mkt)
      }
    }

    function handleQuickSearch(symbol) {
      searchQuery.value = symbol
      searchStock(symbol, market.value)
    }

    function handleWatchlistClick(stock) {
      // Switch to quote tab and search the stock
      activeTab.value = 'quote'
      selectedStock.value = stock
      searchStock(stock.symbol, stock.market)
    }

    function handleStrategySelect({ symbol, market: mkt }) {
      activeTab.value = 'quote'
      searchQuery.value = symbol
      searchStock(symbol, mkt)
    }

    function handleLimitUpSelect({ symbol }) {
      activeTab.value = 'quote'
      searchQuery.value = symbol
      searchStock(symbol, 'CN')
    }

    // --- Watchlist ---
    function saveWatchlist() {
      localStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlist.value))
    }

    function toggleWatchlist() {
      if (!selectedStock.value) return
      if (isInWatchlist.value) {
        watchlist.value = watchlist.value.filter(s => s.symbol !== selectedStock.value.symbol)
      } else {
        watchlist.value.unshift({ ...selectedStock.value })
      }
      saveWatchlist()
    }

    function removeFromWatchlist(symbol) {
      watchlist.value = watchlist.value.filter(s => s.symbol !== symbol)
      if (selectedStock.value?.symbol === symbol) {
        selectedStock.value = null
        history.value = []
      }
      saveWatchlist()
    }

    async function refreshWatchlist() {
      loading.value = true
      error.value = ''
      const updated = []

      for (const stock of watchlist.value) {
        try {
          const fetchQuote = stock.market === 'US' ? fetchUSStock : fetchCNStock
          const res = await fetchWithRetry(() => fetchQuote(stock.symbol))
          if (res.data.success) {
            updated.push(res.data.data)
          } else {
            updated.push(stock)
          }
        } catch {
          updated.push(stock)
        }
      }

      watchlist.value = updated
      saveWatchlist()

      if (selectedStock.value) {
        const updatedSelected = updated.find(s => s.symbol === selectedStock.value.symbol)
        if (updatedSelected) selectedStock.value = updatedSelected
      }

      loading.value = false
    }

    // --- Formatters ---
    function formatPrice(price, currency) {
      if (!price) return currency === 'CNY' ? '¥0.00' : '$0.00'
      if (currency === 'CNY') return `¥${price.toFixed(2)}`
      return `$${price.toFixed(2)}`
    }

    function formatNumber(num) {
      if (!num) return '0'
      if (num >= 1e12) return (num / 1e12).toFixed(2) + '万亿'
      if (num >= 1e8) return (num / 1e8).toFixed(2) + '亿'
      if (num >= 1e4) return (num / 1e4).toFixed(2) + '万'
      return num.toLocaleString('zh-CN')
    }

    return {
      market, searchQuery, selectedStock, watchlist, history,
      loading, historyLoading, error, retryAvailable,
      activeTab, mainTabs,
      searchResults, showDropdown,
      customPicksUS, customPicksCN, currentCustomPicks,
      showAddPick, addPickSymbol, addPickName,
      isInWatchlist,
      formatPrice, formatNumber,
      onSearchInput, selectSearchResult,
      switchMarket, handleSearch, handleRetry,
      handleQuickSearch, handleWatchlistClick, handleStrategySelect, handleLimitUpSelect,
      toggleWatchlist, removeFromWatchlist, refreshWatchlist,
      removeCustomPick, confirmAddPick,
    }
  },
}
</script>
