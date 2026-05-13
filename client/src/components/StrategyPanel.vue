<template>
  <div class="strategy-panel">
    <div class="sp-header">
      <div class="sp-title">📊 量化选股策略</div>
      <button class="sp-refresh-btn" @click="loadCurrentStrategy" :disabled="loading">
        <span v-if="loading" class="loading-spinner"></span>
        <span v-else>🔄</span>
        刷新
      </button>
    </div>

    <!-- Strategy Tabs -->
    <div class="sp-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="sp-tab"
        :class="{ active: activeTab === tab.key }"
        @click="switchTab(tab.key)"
      >
        <span class="sp-tab-icon">{{ tab.icon }}</span>
        <span class="sp-tab-name">{{ tab.name }}</span>
        <span class="sp-tab-type">{{ tab.type }}</span>
      </button>
    </div>

    <!-- Description -->
    <div class="sp-desc" :class="'sp-desc-' + activeTab">
      {{ currentDesc }}
    </div>

    <!-- Criteria -->
    <div class="sp-criteria">
      <div v-for="(c, i) in currentCriteria" :key="i" class="sp-criteria-item">
        <span class="sp-criteria-check">✅</span>
        <span>{{ c }}</span>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="sp-loading">
      <div class="loading-spinner" style="width: 24px; height: 24px;"></div>
      <span>正在执行策略筛选，首次约15-30秒，请耐心等待...</span>
    </div>

    <!-- Error -->
    <div v-if="error" class="sp-error">
      {{ error }}
      <button class="sp-retry-btn" @click="loadCurrentStrategy">重试</button>
    </div>

    <!-- Results -->
    <div v-if="!loading && stocks.length > 0" class="sp-table-wrapper">
      <table class="sp-table">
        <thead>
          <tr>
            <th>序号</th>
            <th>代码</th>
            <th>名称</th>
            <th>现价</th>
            <th>涨幅</th>
            <th v-for="col in currentColumns" :key="col.key">{{ col.label }}</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(s, i) in stocks" :key="s.symbol">
            <td>{{ i + 1 }}</td>
            <td class="sp-code">{{ s.symbol }}</td>
            <td class="sp-name">{{ s.name }}</td>
            <td>{{ s.price }}</td>
            <td :class="s.change_percent >= 0 ? 'text-red' : 'text-green'">
              {{ s.change_percent >= 0 ? '+' : '' }}{{ s.change_percent }}%
            </td>
            <td v-for="col in currentColumns" :key="col.key" :class="col.class ? col.class(s) : ''">
              {{ col.format ? col.format(s) : s[col.key] }}
            </td>
            <td>
              <button class="sp-view-btn" @click="$emit('select-stock', { symbol: s.symbol, market: 'CN' })">
                查看
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <div class="sp-footer">
        <span>共 {{ stocks.length }} 只股票</span>
        <span>数据来源：AkShare（东方财富）</span>
      </div>
    </div>

    <!-- Empty -->
    <div v-if="!loading && !error && stocks.length === 0 && loaded" class="sp-empty">
      当前策略条件下未筛选到符合条件的股票
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted } from 'vue'
import {
  fetchStrategyConservative, fetchStrategyGarp,
  fetchStrategyMomentum, fetchStrategyPotential,
  fetchStrategyLimitback, fetchStrategyMaBullish,
} from '../api/stock.js'

export default {
  name: 'StrategyPanel',
  emits: ['select-stock'],
  setup() {
    const activeTab = ref('conservative')
    const stocks = ref([])
    const loading = ref(false)
    const error = ref('')
    const loaded = ref(false)

    const tabs = [
      { key: 'conservative', icon: '🛡️', name: '低估值蓝筹', type: '保守型' },
      { key: 'garp', icon: '⚖️', name: 'GARP均衡', type: '中立型' },
      { key: 'momentum', icon: '🚀', name: '动量爆发', type: '激进型' },
      { key: 'potential', icon: '💎', name: '高增长潜力', type: '潜力型' },
      { key: 'limitback', icon: '🔥', name: '涨停回马枪', type: '技术型' },
      { key: 'ma-bullish', icon: '📈', name: '均线多头', type: '技术型' },
    ]

    const descriptions = {
      conservative: '寻找低估值、大市值的稳健蓝筹股。PE<15，PB<3，市值>200亿。适合稳健投资者。',
      garp: '找业绩稳步增长、估值合理的"白马股"。PEG<1.2，净利润增速>15%，毛利率>30%。',
      momentum: '抓风口、抓主线的强势股（注意回撤大，必须配合止损）。净利润增速>50%，换手率3-25%。',
      potential: '高增长潜力股。净利润增速>50%，毛利率高，市值>100亿。',
      limitback: '近期涨停过的股票，回调后再次放量启动。涨停次数越多、换手率越高越值得关注。',
      'ma-bullish': '均线多头排列，趋势向上的强势股。适合趋势跟踪策略。',
    }

    const criteria = {
      conservative: ['PE < 15倍', 'PB < 3倍', '市值 > 200亿'],
      garp: ['PEG < 1.2', '净利润增速 > 15%', '毛利率 > 30%', '市值 > 50亿'],
      momentum: ['净利润增速 > 50%', '换手率 3%-25%', '市值 > 50亿'],
      potential: ['净利润增速 > 50%', '毛利率加分', '市值 > 100亿'],
      limitback: ['近5天有涨停记录', '今日涨幅 < 5%（回调中）', '换手率 > 2%', '市值 > 50亿'],
      'ma-bullish': ['当日涨幅 > 0', '换手率 > 1%', '市值 > 50亿', 'PE < 50'],
    }

    const columns = {
      conservative: [
        { key: 'pe', label: 'PE' },
        { key: 'pb', label: 'PB' },
        { key: 'market_cap', label: '市值', format: s => s.market_cap ? (s.market_cap / 10000).toFixed(0) + '亿' : '-' },
      ],
      garp: [
        { key: 'pe', label: 'PE' },
        { key: 'np_growth', label: '净利润增速', format: s => (s.np_growth || '-') + '%' },
        { key: 'gp_margin', label: '毛利率', format: s => (s.gp_margin || '-') + '%' },
      ],
      momentum: [
        { key: 'np_growth', label: '净利润增速', format: s => (s.np_growth || '-') + '%' },
        { key: 'turnover_rate', label: '换手率', format: s => (s.turnover_rate || '-') + '%' },
      ],
      potential: [
        { key: 'np_growth', label: '净利润增速', format: s => (s.np_growth || '-') + '%' },
        { key: 'gp_margin', label: '毛利率', format: s => (s.gp_margin || '-') + '%' },
        { key: 'market_cap', label: '市值', format: s => s.market_cap ? (s.market_cap / 10000).toFixed(0) + '亿' : '-' },
      ],
      limitback: [
        { key: 'limit_days', label: '涨停天数', format: s => (s.limit_days || '-') + '天' },
        { key: 'turnover_rate', label: '换手率', format: s => (s.turnover_rate || '-') + '%' },
        { key: 'np_growth', label: '净利润增速', format: s => (s.np_growth || '-') + '%' },
      ],
      'ma-bullish': [
        { key: 'change_percent', label: '涨幅', format: s => (s.change_percent || '-') + '%' },
        { key: 'turnover_rate', label: '换手率', format: s => (s.turnover_rate || '-') + '%' },
        { key: 'pe', label: 'PE' },
      ],
    }

    const fetchMap = {
      conservative: fetchStrategyConservative,
      garp: fetchStrategyGarp,
      momentum: fetchStrategyMomentum,
      potential: fetchStrategyPotential,
      limitback: fetchStrategyLimitback,
      'ma-bullish': fetchStrategyMaBullish,
    }

    const currentDesc = computed(() => descriptions[activeTab.value])
    const currentCriteria = computed(() => criteria[activeTab.value])
    const currentColumns = computed(() => columns[activeTab.value])

    onMounted(() => loadCurrentStrategy())

    function switchTab(key) {
      activeTab.value = key
      loadCurrentStrategy()
    }

    async function loadCurrentStrategy() {
      loading.value = true
      error.value = ''
      stocks.value = []
      try {
        const res = await fetchMap[activeTab.value]()
        if (res.data.success) {
          stocks.value = res.data.data
          loaded.value = true
        } else {
          error.value = res.data.error || '策略执行失败'
        }
      } catch (err) {
        error.value = '请求失败，请检查网络后重试'
      } finally {
        loading.value = false
      }
    }

    return { activeTab, tabs, stocks, loading, error, loaded, currentDesc, currentCriteria, currentColumns, switchTab, loadCurrentStrategy }
  },
}
</script>

<style scoped>
.strategy-panel { font-size: 13px; }
.sp-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.sp-title { font-weight: 700; font-size: 15px; }
.sp-refresh-btn {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 6px 14px; border: 1px solid var(--border); border-radius: 6px;
  background: var(--card-bg, #fff); font-size: 12px; cursor: pointer; font-weight: 500;
}
.sp-refresh-btn:hover { background: var(--bg); }
.sp-refresh-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.sp-tabs { display: flex; gap: 6px; margin-bottom: 12px; flex-wrap: wrap; }
.sp-tab {
  flex: 1; min-width: 120px; display: flex; flex-direction: column; align-items: center; gap: 2px;
  padding: 10px 8px; border: 2px solid var(--border); border-radius: 8px;
  background: transparent; cursor: pointer; transition: all 0.2s;
}
.sp-tab.active { border-color: var(--primary, #2563eb); background: rgba(37,99,235,0.05); }
.sp-tab-icon { font-size: 20px; }
.sp-tab-name { font-weight: 600; font-size: 13px; }
.sp-tab-type { font-size: 10px; color: var(--text-secondary); }

.sp-desc { padding: 10px 12px; border-radius: 6px; margin-bottom: 10px; font-size: 12px; line-height: 1.6; color: var(--text-secondary); }
.sp-desc-conservative { background: #eff6ff; border-left: 3px solid #2563eb; }
.sp-desc-garp { background: #f0fdf4; border-left: 3px solid #22c55e; }
.sp-desc-momentum { background: #fef3c7; border-left: 3px solid #f59e0b; }
.sp-desc-potential { background: #faf5ff; border-left: 3px solid #a855f7; }

.sp-criteria { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
.sp-criteria-item { display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; background: var(--bg); border-radius: 12px; font-size: 11px; color: var(--text-secondary); }

.sp-loading { display: flex; align-items: center; gap: 8px; padding: 24px; justify-content: center; color: var(--text-secondary); }
.sp-error { padding: 10px; background: #fef2f2; color: #dc2626; border-radius: 6px; margin-bottom: 12px; font-size: 12px; display: flex; align-items: center; justify-content: space-between; }
.sp-retry-btn { padding: 4px 12px; border: 1px solid #dc2626; border-radius: 4px; background: transparent; color: #dc2626; font-size: 11px; cursor: pointer; }
.sp-empty { text-align: center; padding: 24px; color: var(--text-secondary); font-size: 12px; }

.sp-table-wrapper { max-height: 500px; overflow-y: auto; }
.sp-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.sp-table th { position: sticky; top: 0; background: var(--bg); padding: 8px 6px; text-align: center; font-weight: 600; color: var(--text-secondary); border-bottom: 1px solid var(--border); white-space: nowrap; z-index: 1; }
.sp-table td { padding: 7px 6px; text-align: center; border-bottom: 1px solid var(--border); white-space: nowrap; font-variant-numeric: tabular-nums; }
.sp-table tr:hover { background: var(--bg); }
.sp-code { font-weight: 600; color: var(--primary, #2563eb); }
.sp-name { font-weight: 500; }
.sp-view-btn { padding: 4px 10px; border: 1px solid var(--primary, #2563eb); border-radius: 4px; background: transparent; color: var(--primary, #2563eb); font-size: 11px; cursor: pointer; font-weight: 500; transition: all 0.15s; }
.sp-view-btn:hover { background: var(--primary, #2563eb); color: white; }
.sp-footer { display: flex; align-items: center; justify-content: space-between; padding: 10px 0; font-size: 11px; color: var(--text-secondary); }
.text-red { color: #dc2626; font-weight: 600; }
.text-green { color: #16a34a; font-weight: 600; }
</style>
