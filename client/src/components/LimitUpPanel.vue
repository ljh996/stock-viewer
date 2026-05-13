<template>
  <div class="limit-up-panel">
    <div class="lu-header">
      <div class="lu-title">🔥 涨停分析</div>
      <div v-if="syncStatus" class="lu-sync-status" :class="syncStatus.syncing ? 'syncing' : 'ready'">
        {{ syncStatus.syncing ? '⏳ 数据同步中...' : '✅ 数据已就绪' }}
      </div>
    </div>

    <!-- 子Tab -->
    <div class="lu-tabs">
      <button class="lu-tab" :class="{ active: subTab === 'today' }" @click="subTab = 'today'">
        今日涨停
      </button>
      <button class="lu-tab" :class="{ active: subTab === 'history' }" @click="initHistory">
        最近5日
      </button>
      <button class="lu-tab" :class="{ active: subTab === 'stats' }" @click="loadStats">
        板块统计
      </button>
    </div>

    <!-- 今日涨停 -->
    <template v-if="subTab === 'today'">
      <div class="lu-toolbar">
        <button class="lu-refresh-btn" @click="loadToday" :disabled="todayLoading">
          <span v-if="todayLoading" class="loading-spinner"></span>
          <span v-else>🔄</span> 刷新
        </button>
        <div v-if="todayStocks.length > 0" class="lu-summary">
          共 {{ todayStocks.length }} 只涨停股
        </div>
      </div>

      <div v-if="todayError" class="lu-error">{{ todayError }}</div>
      <div v-if="todayLoading && todayStocks.length === 0" class="lu-loading">
        <div class="loading-spinner" style="width:24px;height:24px;"></div>
        <span>正在获取涨停数据...</span>
      </div>
      <div v-if="!todayLoading && todayStocks.length === 0 && !todayError" class="lu-empty">
        暂无涨停数据（可能非交易时间或数据同步中）
      </div>

      <div v-if="todayStocks.length > 0" class="lu-table-wrapper">
        <table class="lu-table">
          <thead>
            <tr>
              <th>序号</th><th>代码</th><th>名称</th><th>涨幅</th><th>换手率</th><th>连板</th><th>质量分</th><th>行业</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(s, i) in todayStocks" :key="s.symbol">
              <td>{{ i + 1 }}</td>
              <td class="lu-code">{{ s.symbol }}</td>
              <td class="lu-name">{{ s.name }}</td>
              <td class="lu-up">+{{ s.change_percent }}%</td>
              <td>{{ s.turnover_rate }}%</td>
              <td>
                <span v-if="s.limit_up_count >= 2" class="lu-board-hot">{{ s.limit_up_count }}板🔥</span>
                <span v-else>{{ s.limit_up_count || 1 }}板</span>
              </td>
              <td>
                <span class="lu-score" :class="getScoreClass(s.score)">{{ s.score || '-' }}</span>
              </td>
              <td class="lu-industry">{{ s.industry || '-' }}</td>
              <td>
                <button class="lu-detail-btn" @click="goToDetail(s)">查看行情</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- 最近5日 -->
    <template v-if="subTab === 'history'">
      <div v-if="!selectedDate" class="lu-history-dates">
        <div class="lu-dates-grid">
          <div v-for="d in dates" :key="d.date" class="lu-date-card" @click="selectDate(d)">
            <div class="lu-date-card-date">{{ formatDate(d.date) }}</div>
            <div class="lu-date-card-info">
              <span v-if="d.loading" class="lu-loading-text">加载中...</span>
              <span v-else-if="d.error" class="lu-error-text">加载失败</span>
              <span v-else-if="d.count !== null" class="lu-up">{{ d.count }} 只涨停</span>
              <span v-else class="lu-hint-text">点击查看</span>
            </div>
          </div>
        </div>
      </div>

      <div v-if="selectedDate">
        <button class="lu-refresh-btn" @click="selectedDate = null" style="margin-bottom:12px;">
          ← 返回日期列表
        </button>
        <div class="lu-day">
          <div class="lu-day-header">
            <span class="lu-day-date">{{ formatDate(selectedDate.date) }}</span>
            <span class="lu-day-count">{{ dayStocks.length }} 只涨停</span>
          </div>
          <div v-if="dayLoading" class="lu-loading">
            <div class="loading-spinner" style="width:20px;height:20px;"></div>
            <span>加载中...</span>
          </div>
          <div v-if="dayError" class="lu-error">{{ dayError }}</div>
          <div v-if="!dayLoading && dayStocks.length === 0 && !dayError" class="lu-empty">
            该日无涨停数据（非交易日或数据不可用）
          </div>
          <table v-if="dayStocks.length > 0" class="lu-table">
            <thead>
              <tr>
                <th>序号</th><th>代码</th><th>名称</th><th>涨幅</th><th>连板</th><th>质量分</th><th>行业</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(s, i) in dayStocks" :key="s.symbol">
                <td>{{ i + 1 }}</td>
                <td class="lu-code">{{ s.symbol }}</td>
                <td class="lu-name">{{ s.name }}</td>
                <td class="lu-up">+{{ s.change_percent }}%</td>
                <td>
                  <span v-if="s.limit_up_count >= 2" class="lu-board-hot">{{ s.limit_up_count }}板🔥</span>
                  <span v-else>{{ s.limit_up_count || 1 }}板</span>
                </td>
                <td><span class="lu-score" :class="getScoreClass(s.score)">{{ s.score || '-' }}</span></td>
                <td class="lu-industry">{{ s.industry || '-' }}</td>
                <td>
                  <button class="lu-detail-btn" @click="goToDetail(s)">查看行情</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <!-- 板块统计 -->
    <template v-if="subTab === 'stats'">
      <div v-if="statsLoading" class="lu-loading">
        <div class="loading-spinner" style="width:24px;height:24px;"></div>
        <span>加载板块统计...</span>
      </div>
      <div v-if="statsError" class="lu-error">{{ statsError }}</div>
      <div v-if="!statsLoading && statsData.length === 0 && !statsError" class="lu-empty">
        暂无板块统计数据
      </div>
      <div v-if="statsData.length > 0" class="lu-stats-grid">
        <div v-for="(s, i) in statsData" :key="s.industry" class="lu-stat-card">
          <div class="lu-stat-rank">#{{ i + 1 }}</div>
          <div class="lu-stat-industry">{{ s.industry }}</div>
          <div class="lu-stat-count">{{ s.count }} 只涨停</div>
          <div class="lu-stat-bar">
            <div class="lu-stat-bar-fill" :style="{ width: (s.count / statsData[0].count * 100) + '%' }"></div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script>
import { ref, onMounted } from 'vue'
import axios from 'axios'

export default {
  name: 'LimitUpPanel',
  emits: ['select-stock'],
  setup(props, { emit }) {
    const subTab = ref('today')
    const todayStocks = ref([])
    const todayLoading = ref(false)
    const todayError = ref('')
    const syncStatus = ref(null)

    const dates = ref([])
    const selectedDate = ref(null)
    const dayStocks = ref([])
    const dayLoading = ref(false)
    const dayError = ref('')

    const statsData = ref([])
    const statsLoading = ref(false)
    const statsError = ref('')

    onMounted(() => {
      loadToday()
      checkSyncStatus()
    })

    async function checkSyncStatus() {
      try {
        const res = await axios.get('/api/sync/status', { timeout: 5000 })
        if (res.data) syncStatus.value = res.data
      } catch { /* ignore */ }
    }

    async function loadToday() {
      todayLoading.value = true
      todayError.value = ''
      try {
        const res = await axios.get('/api/limit-up/today', { timeout: 30000 })
        if (res.data.success) {
          todayStocks.value = res.data.data || []
        } else {
          todayError.value = res.data.error || '获取数据失败'
        }
      } catch (e) {
        todayError.value = '网络请求失败'
      }
      finally { todayLoading.value = false }
    }

    function initHistory() {
      subTab.value = 'history'
      if (dates.value.length > 0) return
      const result = []
      const today = new Date()
      for (let i = 1; i <= 10 && result.length < 5; i++) {
        const d = new Date(today)
        d.setDate(d.getDate() - i)
        if (d.getDay() === 0 || d.getDay() === 6) continue
        const ds = d.toISOString().split('T')[0]
        result.push({ date: ds, count: null, loading: false, error: false })
      }
      dates.value = result
    }

    async function selectDate(d) {
      selectedDate.value = d
      dayLoading.value = true
      dayError.value = ''
      dayStocks.value = []
      d.loading = true
      d.error = false
      try {
        const res = await axios.get('/api/limit-up/history', {
          params: { date: d.date },
          timeout: 30000
        })
        if (res.data.success) {
          dayStocks.value = res.data.data || []
          d.count = dayStocks.value.length
        } else {
          dayError.value = res.data.error || '获取失败'
          d.error = true
        }
      } catch {
        dayError.value = '网络请求失败'
        d.error = true
      }
      finally {
        dayLoading.value = false
        d.loading = false
      }
    }

    async function loadStats() {
      subTab.value = 'stats'
      statsLoading.value = true
      statsError.value = ''
      try {
        const today = new Date().toISOString().split('T')[0]
        const res = await axios.get('/api/limit-up/stats', {
          params: { date: today },
          timeout: 30000
        })
        if (res.data.success) {
          statsData.value = res.data.data || []
        } else {
          statsError.value = '获取失败'
        }
      } catch {
        statsError.value = '网络请求失败'
      }
      finally { statsLoading.value = false }
    }

    function formatDate(dateStr) {
      const d = new Date(dateStr)
      const month = d.getMonth() + 1
      const day = d.getDate()
      const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
      return `${month}月${day}日 ${weekDays[d.getDay()]}`
    }

    function getScoreClass(score) {
      if (!score) return ''
      if (score >= 80) return 'score-high'
      if (score >= 60) return 'score-mid'
      return 'score-low'
    }

    function goToDetail(stock) {
      emit('select-stock', { symbol: stock.symbol })
    }

    return {
      subTab, todayStocks, todayLoading, todayError, syncStatus,
      dates, selectedDate, dayStocks, dayLoading, dayError,
      statsData, statsLoading, statsError,
      loadToday, initHistory, selectDate, loadStats,
      formatDate, getScoreClass, goToDetail,
    }
  },
}
</script>

<style scoped>
.limit-up-panel { font-size: 13px; }
.lu-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.lu-title { font-weight: 700; font-size: 15px; }
.lu-sync-status { font-size: 11px; padding: 3px 10px; border-radius: 10px; }
.lu-sync-status.ready { background: #ecfdf5; color: #059669; }
.lu-sync-status.syncing { background: #fef3c7; color: #d97706; }

.lu-tabs { display: flex; gap: 8px; margin-bottom: 12px; }
.lu-tab {
  padding: 8px 20px; border: 1px solid var(--border); border-radius: 6px;
  background: transparent; cursor: pointer; font-size: 13px; font-weight: 500;
  transition: all 0.15s;
}
.lu-tab.active { border-color: var(--primary, #2563eb); background: rgba(37,99,235,0.05); color: var(--primary, #2563eb); }
.lu-tab:hover { background: var(--bg); }

.lu-toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.lu-refresh-btn {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 6px 14px; border: 1px solid var(--border); border-radius: 6px;
  background: var(--card-bg, #fff); font-size: 12px; cursor: pointer; font-weight: 500;
}
.lu-refresh-btn:hover { background: var(--bg); }
.lu-error { padding: 10px; background: #fef2f2; color: #dc2626; border-radius: 6px; margin-bottom: 12px; font-size: 12px; }
.lu-loading { display: flex; align-items: center; gap: 8px; padding: 24px; justify-content: center; color: var(--text-secondary); }
.lu-empty { text-align: center; padding: 24px; color: var(--text-secondary); font-size: 12px; }
.lu-summary { font-size: 12px; color: var(--text-secondary); }

.lu-table-wrapper { max-height: 450px; overflow-y: auto; }
.lu-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.lu-table th {
  position: sticky; top: 0; background: var(--bg); padding: 8px 4px;
  text-align: center; font-weight: 600; color: var(--text-secondary);
  border-bottom: 1px solid var(--border); white-space: nowrap;
}
.lu-table td {
  padding: 6px 4px; text-align: center; border-bottom: 1px solid var(--border);
  white-space: nowrap; font-variant-numeric: tabular-nums;
}
.lu-table tr:hover { background: var(--bg); }
.lu-code { font-weight: 600; color: var(--primary, #2563eb); }
.lu-name { font-weight: 500; }
.lu-up { color: #dc2626; font-weight: 600; }
.lu-industry { font-size: 11px; color: var(--text-secondary); }
.lu-board-hot { color: #dc2626; font-weight: 700; }
.lu-score { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 700; }
.score-high { background: #fef2f2; color: #dc2626; }
.score-mid { background: #fef3c7; color: #d97706; }
.score-low { background: #f0f9ff; color: #2563eb; }
.lu-detail-btn {
  padding: 4px 10px; border: 1px solid var(--primary, #2563eb); border-radius: 4px;
  background: transparent; color: var(--primary, #2563eb); font-size: 11px;
  cursor: pointer; transition: all 0.15s; font-weight: 500;
}
.lu-detail-btn:hover { background: var(--primary, #2563eb); color: white; }

/* 日期卡片 */
.lu-dates-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; padding: 4px 0; }
.lu-date-card {
  border: 1px solid var(--border); border-radius: 8px; padding: 12px;
  cursor: pointer; transition: all 0.15s; text-align: center;
}
.lu-date-card:hover { border-color: var(--primary, #2563eb); background: rgba(37,99,235,0.03); }
.lu-date-card-date { font-weight: 600; font-size: 14px; margin-bottom: 4px; }
.lu-date-card-info { font-size: 12px; }
.lu-loading-text { color: var(--text-secondary); }
.lu-error-text { color: #dc2626; }
.lu-hint-text { color: var(--text-secondary); }

/* 某天详情 */
.lu-day { border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.lu-day-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 16px; background: var(--bg); font-weight: 600;
}
.lu-day-date { font-size: 14px; }
.lu-day-count { font-size: 12px; color: var(--text-secondary); }

/* 板块统计 */
.lu-stats-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
.lu-stat-card {
  border: 1px solid var(--border); border-radius: 8px; padding: 12px;
  position: relative; overflow: hidden;
}
.lu-stat-rank {
  position: absolute; top: 4px; right: 8px; font-size: 20px; font-weight: 800;
  color: var(--text-secondary); opacity: 0.15;
}
.lu-stat-industry { font-weight: 600; font-size: 13px; margin-bottom: 4px; }
.lu-stat-count { font-size: 12px; color: #dc2626; font-weight: 600; margin-bottom: 6px; }
.lu-stat-bar { height: 4px; background: var(--border); border-radius: 2px; overflow: hidden; }
.lu-stat-bar-fill { height: 100%; background: #dc2626; border-radius: 2px; transition: width 0.5s; }

.loading-spinner {
  display: inline-block; width: 16px; height: 16px;
  border: 2px solid var(--border); border-top-color: var(--primary, #2563eb);
  border-radius: 50%; animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
</style>
