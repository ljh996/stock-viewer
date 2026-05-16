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
      <button class="lu-tab" :class="{ active: subTab === 'analysis' }" @click="loadAnalysis">
        AI分析
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

      <!-- 价格分组卡片（未选中时） -->
      <div v-if="!selectedGroup && statsData.length > 0" class="lu-stats-grid">
        <div v-for="(s, i) in statsData" :key="s.industry" class="lu-stat-card lu-stat-card-clickable" @click="selectGroup(s)">
          <div class="lu-stat-rank">#{{ i + 1 }}</div>
          <div class="lu-stat-industry">{{ s.industry }}</div>
          <div class="lu-stat-count">{{ s.count }} 只涨停</div>
          <div class="lu-stat-bar">
            <div class="lu-stat-bar-fill" :style="{ width: (s.count / statsData[0].count * 100) + '%' }"></div>
          </div>
          <div class="lu-stat-hint">点击查看详情 →</div>
        </div>
      </div>

      <!-- 价格分组详情（选中时） -->
      <div v-if="selectedGroup" class="lu-group-detail">
        <button class="lu-refresh-btn" @click="selectedGroup = null" style="margin-bottom:12px;">
          ← 返回板块统计
        </button>
        <div class="lu-group-header">
          <span class="lu-group-title">{{ selectedGroup.industry }}</span>
          <span class="lu-group-count">{{ selectedGroup.count }} 只涨停</span>
        </div>
        <div class="lu-table-wrapper">
          <table class="lu-table">
            <thead>
              <tr>
                <th>序号</th><th>代码</th><th>名称</th><th>涨幅</th><th>换手率</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(s, i) in selectedGroup.stocks" :key="s.symbol">
                <td>{{ i + 1 }}</td>
                <td class="lu-code">{{ s.symbol }}</td>
                <td class="lu-name">{{ s.name }}</td>
                <td class="lu-up">+{{ s.change_percent }}%</td>
                <td>{{ s.turnover_rate }}%</td>
                <td>
                  <button class="lu-detail-btn" @click="goToDetail(s)">查看行情</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <!-- AI分析 -->
    <template v-if="subTab === 'analysis'">
      <div class="lu-toolbar">
        <button class="lu-refresh-btn" @click="loadAnalysis" :disabled="analysisLoading">
          <span v-if="analysisLoading" class="loading-spinner"></span>
          <span v-else>🔄</span> 刷新分析
        </button>
      </div>
      <div v-if="analysisError" class="lu-error">{{ analysisError }}</div>

      <!-- Loading State -->
      <div v-if="analysisLoading" class="ai-loading">
        <div class="ai-loading-brain">
          <div class="ai-brain-orb"></div>
          <div class="ai-brain-ring r1"></div>
          <div class="ai-brain-ring r2"></div>
          <div class="ai-brain-ring r3"></div>
        </div>
        <div class="ai-loading-text">
          <span class="ai-loading-title">DeepSeek AI 正在深度分析</span>
          <span class="ai-loading-hint">分析今日涨停数据、市场情绪、资金偏好...</span>
        </div>
        <div class="ai-loading-bar">
          <div class="ai-loading-bar-fill"></div>
        </div>
      </div>

      <!-- Analysis Result -->
      <div v-if="!analysisLoading && analysisData && !analysisError" class="ai-report">
        <!-- Header -->
        <div class="ai-report-header">
          <div class="ai-report-header-top">
            <div class="ai-report-icon">🧠</div>
            <div>
              <div class="ai-report-title">DeepSeek AI 市场分析</div>
              <div class="ai-report-subtitle">基于今日涨停数据的智能研判</div>
            </div>
            <div class="ai-report-time">{{ analysisTime }}</div>
          </div>
          <div class="ai-report-header-bar">
            <span></span><span></span><span></span><span></span>
          </div>
        </div>

        <!-- Body with parsed sections -->
        <div class="ai-report-body">
          <div v-for="(section, si) in parsedSections" :key="si" class="ai-section" :class="'ai-section-' + section.type">
            <div class="ai-section-icon">{{ section.icon }}</div>
            <div class="ai-section-content">
              <h4 v-if="section.title" class="ai-section-title">{{ section.title }}</h4>
              <div class="ai-section-text" v-html="section.html"></div>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="ai-report-footer">
          <span class="ai-footer-disclaimer">⚠️ 本分析由 AI 生成，仅供参考，不构成投资建议</span>
        </div>
      </div>
    </template>
  </div>
</template>

<script>
import { ref, computed, onMounted } from 'vue'
import axios from 'axios'

export default {
  name: 'LimitUpPanel',
  emits: ['select-stock', 'select-group'],
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
    const selectedGroup = ref(null)

    const analysisData = ref('')
    const analysisLoading = ref(false)
    const analysisError = ref('')
    const analysisTime = ref('')

    // Parse AI analysis text into structured sections
    function parseAnalysisSections(text) {
      if (!text) return []
      const sections = []
      const lines = text.split('\n').filter(l => l.trim())
      const icons = { overview: '📊', sentiment: '📈', capital: '💰', advice: '💡', risk: '⚠️', default: '📌' }
      const titles = { overview: '市场概况', sentiment: '市场情绪判断', capital: '资金偏好分析', advice: '操作建议', risk: '风险提示' }
      let type = 'default'
      let buf = []
      function flush() {
        if (!buf.length) return
        let h = buf.join('\n').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code>$1</code>').replace(/^\- /gm, '• ').replace(/\n/g, '<br>')
        sections.push({ type, icon: icons[type] || icons.default, title: titles[type] || '', html: h })
        buf = []
      }
      for (const line of lines) {
        const t = line.trim()
        if (t.startsWith('【')) { flush(); type = 'overview'; buf.push(t.replace(/【(.+)】/, '$1：')) }
        else if (/^\d+\.\s*/.test(t)) {
          flush()
          const rest = t.replace(/^\d+\.\s*/, '')
          if (/情绪|市场/.test(t.slice(0, 15))) type = 'sentiment'
          else if (/资金|偏好/.test(t.slice(0, 15))) type = 'capital'
          else if (/操作|建议/.test(t.slice(0, 15))) type = 'advice'
          else if (/风险/.test(t.slice(0, 15))) type = 'risk'
          else type = 'default'
          buf.push(rest)
        } else { buf.push(t) }
      }
      flush()
      return sections
    }

    const parsedSections = computed(() => parseAnalysisSections(analysisData.value))

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

    function selectGroup(group) {
      selectedGroup.value = group
      emit('select-group', {
        industry: group.industry,
        count: group.count,
        stocks: group.stocks || []
      })
    }

    async function loadAnalysis() {
      subTab.value = 'analysis'
      if (analysisData.value && !analysisLoading.value) {
        // Already loaded, just switch tab
        return
      }
      analysisLoading.value = true
      analysisError.value = ''
      analysisData.value = ''
      try {
        const res = await axios.get('/api/limit-up/analysis', { timeout: 60000 })
        if (res.data.success) {
          analysisData.value = res.data.data
          analysisTime.value = new Date().toLocaleString('zh-CN')
        } else {
          analysisError.value = res.data.error || 'AI分析失败'
        }
      } catch (e) {
        analysisError.value = '网络请求失败，请稍后重试'
      }
      finally { analysisLoading.value = false }
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
      statsData, statsLoading, statsError, selectedGroup,
      analysisData, analysisLoading, analysisError, analysisTime, parsedSections,
      loadToday, initHistory, selectDate, loadStats, loadAnalysis,
      selectGroup,
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
.lu-sync-status.ready { background: rgba(16,185,129,0.12); color: #10b981; border: 1px solid rgba(16,185,129,0.15); }
.lu-sync-status.syncing { background: rgba(245,158,11,0.12); color: #f59e0b; border: 1px solid rgba(245,158,11,0.15); }

.lu-tabs { display: flex; gap: 8px; margin-bottom: 12px; }
.lu-tab {
  padding: 8px 20px; border: 1px solid var(--glass-border); border-radius: 8px;
  background: rgba(255,255,255,0.02); cursor: pointer; font-size: 13px; font-weight: 500;
  color: var(--text-secondary);
  transition: all 0.2s ease;
}
.lu-tab.active { border-color: rgba(99,102,241,0.4); background: rgba(99,102,241,0.1); color: #a78bfa; }
.lu-tab:hover { background: rgba(255,255,255,0.04); color: var(--text); }

.lu-toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.lu-refresh-btn {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 6px 14px; border: 1px solid var(--glass-border); border-radius: 8px;
  background: rgba(255,255,255,0.03); color: var(--text-secondary);
  font-size: 12px; cursor: pointer; font-weight: 500;
  transition: all 0.2s ease;
}
.lu-refresh-btn:hover { background: rgba(255,255,255,0.06); color: var(--text); border-color: rgba(99,102,241,0.3); }
.lu-error { padding: 10px; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.15); color: #ef4444; border-radius: 8px; margin-bottom: 12px; font-size: 12px; }
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
.score-high { background: rgba(239,68,68,0.12); color: #ef4444; }
.score-mid { background: rgba(245,158,11,0.12); color: #f59e0b; }
.score-low { background: rgba(99,102,241,0.1); color: #a78bfa; }
.lu-detail-btn {
  padding: 4px 10px; border: 1px solid rgba(99,102,241,0.3); border-radius: 6px;
  background: transparent; color: #a78bfa; font-size: 11px;
  cursor: pointer; transition: all 0.2s; font-weight: 500;
}
.lu-detail-btn:hover { background: rgba(99,102,241,0.15); color: #c4b5fd; border-color: rgba(99,102,241,0.5); box-shadow: 0 0 12px rgba(99,102,241,0.1); }

/* 日期卡片 */
.lu-dates-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; padding: 4px 0; }
.lu-date-card {
  border: 1px solid var(--glass-border); border-radius: 10px; padding: 14px;
  cursor: pointer; transition: all 0.2s ease; text-align: center;
  background: rgba(255,255,255,0.02);
}
.lu-date-card:hover { border-color: rgba(99,102,241,0.3); background: rgba(99,102,241,0.05); transform: translateY(-1px); }
.lu-date-card-date { font-weight: 600; font-size: 14px; color: var(--text); margin-bottom: 4px; }
.lu-date-card-info { font-size: 12px; }
.lu-loading-text { color: var(--text-secondary); }
.lu-error-text { color: #ef4444; }
.lu-hint-text { color: var(--text-secondary); }

/* 某天详情 */
.lu-day { border: 1px solid var(--glass-border); border-radius: 10px; overflow: hidden; background: rgba(255,255,255,0.02); }
.lu-day-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 16px; background: rgba(255,255,255,0.03); font-weight: 600;
  border-bottom: 1px solid var(--glass-border);
}
.lu-day-date { font-size: 14px; color: var(--text); }
.lu-day-count { font-size: 12px; color: var(--text-secondary); }

/* 板块统计 */
.lu-stats-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
.lu-stat-card {
  border: 1px solid var(--glass-border); border-radius: 10px; padding: 14px;
  position: relative; overflow: hidden; background: rgba(255,255,255,0.02);
  transition: all 0.2s ease;
}
.lu-stat-rank {
  position: absolute; top: 4px; right: 8px; font-size: 20px; font-weight: 800;
  color: var(--text-secondary); opacity: 0.08;
}
.lu-stat-industry { font-weight: 600; font-size: 13px; color: var(--text); margin-bottom: 4px; }
.lu-stat-count { font-size: 12px; color: #ef4444; font-weight: 600; margin-bottom: 6px; }
.lu-stat-bar { height: 4px; background: rgba(255,255,255,0.06); border-radius: 2px; overflow: hidden; }
.lu-stat-bar-fill { height: 100%; background: linear-gradient(90deg, #ef4444, #f87171); border-radius: 2px; transition: width 0.5s ease; }

/* 价格分组可点击 */
.lu-stat-card-clickable { cursor: pointer; transition: all 0.25s ease; }
.lu-stat-card-clickable:hover { border-color: rgba(99,102,241,0.3); transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.3), 0 0 20px rgba(99,102,241,0.05); }
.lu-stat-hint { font-size: 11px; color: #a78bfa; margin-top: 6px; text-align: right; opacity: 0.6; transition: opacity 0.2s; }
.lu-stat-card-clickable:hover .lu-stat-hint { opacity: 1; }

/* 分组详情 */
.lu-group-detail { border: 1px solid var(--glass-border); border-radius: 10px; overflow: hidden; background: rgba(255,255,255,0.02); }
.lu-group-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 16px; background: rgba(255,255,255,0.03);
  border-bottom: 1px solid var(--glass-border);
}
.lu-group-title { font-weight: 600; font-size: 14px; color: var(--text); }
.lu-group-count { font-size: 12px; color: var(--text-secondary); }

/* AI 分析 - Loading */
.ai-loading {
  display: flex; flex-direction: column; align-items: center; gap: 16px;
  padding: 40px 24px; text-align: center;
}
.ai-loading-brain {
  position: relative; width: 64px; height: 64px;
  display: flex; align-items: center; justify-content: center;
}
.ai-brain-orb {
  width: 16px; height: 16px; border-radius: 50%;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  box-shadow: 0 0 20px rgba(99,102,241,0.5);
  animation: ai-pulse 1.5s ease-in-out infinite;
  z-index: 2;
}
.ai-brain-ring {
  position: absolute; border-radius: 50%;
  border: 2px solid transparent;
  border-top-color: #6366f1; border-right-color: #8b5cf6;
  animation: ai-spin 2s linear infinite;
}
.ai-brain-ring.r1 { width: 48px; height: 48px; }
.ai-brain-ring.r2 { width: 60px; height: 60px; animation-duration: 3s; animation-direction: reverse; }
.ai-brain-ring.r3 { width: 72px; height: 72px; animation-duration: 4s; border-top-color: #a78bfa; border-right-color: #6366f1; }
@keyframes ai-spin { to { transform: rotate(360deg); } }
@keyframes ai-pulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.2); opacity: 0.8; } }
.ai-loading-text { display: flex; flex-direction: column; gap: 4px; }
.ai-loading-title { font-weight: 700; font-size: 15px; color: var(--text); }
.ai-loading-hint { font-size: 12px; color: var(--text-secondary); }
.ai-loading-bar { width: 200px; height: 3px; background: var(--border); border-radius: 2px; overflow: hidden; }
.ai-loading-bar-fill { height: 100%; width: 30%; background: linear-gradient(90deg, #6366f1, #8b5cf6); border-radius: 2px; animation: ai-loading-bar 1.8s ease-in-out infinite; }
@keyframes ai-loading-bar { 0% { transform: translateX(-100%); } 100% { transform: translateX(400%); } }

/* AI 分析 - Report */
.ai-report {
  border: 1px solid var(--glass-border); border-radius: 12px; overflow: hidden;
  background: rgba(255,255,255,0.02);
  backdrop-filter: blur(20px);
  box-shadow: var(--shadow);
}
.ai-report-header {
  background: linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #4338ca 100%);
  padding: 16px 20px; position: relative;
}
.ai-report-header-top { display: flex; align-items: flex-start; gap: 12px; }
.ai-report-icon { font-size: 28px; line-height: 1; margin-top: 2px; }
.ai-report-title { font-weight: 700; font-size: 15px; color: #fff; }
.ai-report-subtitle { font-size: 11px; color: rgba(255,255,255,0.6); margin-top: 2px; }
.ai-report-time { margin-left: auto; font-size: 10px; color: rgba(255,255,255,0.4); white-space: nowrap; }
.ai-report-header-bar {
  display: flex; gap: 4px; margin-top: 12px; height: 3px;
}
.ai-report-header-bar span {
  flex: 1; border-radius: 2px;
  background: rgba(255,255,255,0.1);
  animation: ai-bar-glow 2s ease-in-out infinite;
}
.ai-report-header-bar span:nth-child(2) { animation-delay: 0.3s; }
.ai-report-header-bar span:nth-child(3) { animation-delay: 0.6s; }
.ai-report-header-bar span:nth-child(4) { animation-delay: 0.9s; }
@keyframes ai-bar-glow { 0%, 100% { background: rgba(255,255,255,0.1); } 50% { background: rgba(255,255,255,0.3); } }
.ai-report-body { padding: 4px; }

/* AI 分析 - Sections */
.ai-section {
  display: flex; gap: 12px; padding: 16px 16px;
  border-bottom: 1px solid var(--border);
}
.ai-section:last-child { border-bottom: none; }
.ai-section-icon {
  flex-shrink: 0; width: 36px; height: 36px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  font-size: 18px; margin-top: 2px;
}
.ai-section-content { flex: 1; min-width: 0; }
.ai-section-title { font-size: 13px; font-weight: 700; margin: 0 0 6px; color: var(--text); }
.ai-section-text { font-size: 12.5px; line-height: 1.7; color: var(--text-secondary); }
.ai-section-text strong { color: var(--text); font-weight: 600; }
.ai-section-text code {
  font-size: 11px; background: var(--bg); padding: 1px 5px; border-radius: 3px;
  font-family: monospace;
}
/* Section type colors */
.ai-section-overview .ai-section-icon { background: rgba(99,102,241,0.1); }
.ai-section-overview .ai-section-title { color: #4f46e5; }
.ai-section-sentiment .ai-section-icon { background: rgba(239,68,68,0.1); }
.ai-section-sentiment .ai-section-title { color: #dc2626; }
.ai-section-capital .ai-section-icon { background: rgba(245,158,11,0.1); }
.ai-section-capital .ai-section-title { color: #d97706; }
.ai-section-advice .ai-section-icon { background: rgba(16,185,129,0.1); }
.ai-section-advice .ai-section-title { color: #059669; }
.ai-section-risk .ai-section-icon { background: rgba(239,68,68,0.1); }
.ai-section-risk .ai-section-title { color: #dc2626; }
.ai-section-default .ai-section-icon { background: rgba(99,102,241,0.1); }

.ai-report-footer {
  padding: 10px 16px; background: var(--bg);
  border-top: 1px solid var(--border); text-align: center;
}
.ai-footer-disclaimer { font-size: 10px; color: var(--text-secondary); }

/* Mobile responsive */
@media (max-width: 768px) {
  .ai-loading { padding: 32px 16px; gap: 12px; }
  .ai-loading-brain { width: 48px; height: 48px; }
  .ai-brain-ring.r1 { width: 36px; height: 36px; }
  .ai-brain-ring.r2 { width: 46px; height: 46px; }
  .ai-brain-ring.r3 { width: 56px; height: 56px; }
  .ai-loading-title { font-size: 14px; }
  .ai-loading-bar { width: 160px; }
  .ai-report-header { padding: 14px 16px; }
  .ai-report-icon { font-size: 24px; }
  .ai-report-title { font-size: 14px; }
  .ai-report-time { font-size: 9px; }
  .ai-section { padding: 14px 12px; gap: 10px; }
  .ai-section-icon { width: 32px; height: 32px; font-size: 16px; }
  .ai-section-text { font-size: 12px; }
}

@media (max-width: 480px) {
  .ai-loading { padding: 24px 12px; }
  .ai-loading-bar { width: 120px; }
  .ai-report-header { padding: 12px 12px; }
  .ai-report-header-top { gap: 8px; }
  .ai-report-icon { font-size: 20px; }
  .ai-report-title { font-size: 13px; }
  .ai-report-subtitle { font-size: 10px; display: none; }
  .ai-section { padding: 12px 10px; gap: 8px; flex-direction: column; }
  .ai-section-icon { width: 28px; height: 28px; font-size: 14px; }
  .ai-section-text { font-size: 11.5px; }
  .ai-footer-disclaimer { font-size: 9px; }
}

.loading-spinner {
  display: inline-block; width: 16px; height: 16px;
  border: 2px solid var(--border); border-top-color: var(--primary, #2563eb);
  border-radius: 50%; animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
</style>
