<template>
  <div class="position-manager">
    <!-- 月份设置 -->
    <div class="pm-header">
      <div class="pm-title">📊 仓位管理</div>
      <div class="pm-month-select">
        <label>当前月份模式：</label>
        <select v-model="currentMode" @change="saveMode">
          <option value="empty">空仓期（7个月）</option>
          <option value="light">轻仓/半仓期（2个月）</option>
          <option value="heavy">重仓期（2个月）</option>
          <option value="short">短线期（1个月）</option>
        </select>
      </div>
    </div>

    <!-- 当前状态 -->
    <div class="pm-status" :class="'pm-status-' + currentMode">
      <div class="pm-status-icon">{{ modeConfig.icon }}</div>
      <div class="pm-status-info">
        <div class="pm-status-label">{{ modeConfig.label }}</div>
        <div class="pm-status-desc">{{ modeConfig.desc }}</div>
      </div>
      <div class="pm-status-percent">{{ modeConfig.maxPosition }}%</div>
    </div>

    <!-- 年度统计 -->
    <div class="pm-stats">
      <div class="pm-stat">
        <div class="pm-stat-value">{{ yearStockCount }}/6</div>
        <div class="pm-stat-label">年度买入只数</div>
      </div>
      <div class="pm-stat">
        <div class="pm-stat-value">{{ monthTradeCount }}/3</div>
        <div class="pm-stat-label">本月交易次数</div>
      </div>
      <div class="pm-stat">
        <div class="pm-stat-value" :class="{ 'text-red': currentHolding > 3 }">{{ currentHolding }}/3</div>
        <div class="pm-stat-label">当前持仓只数</div>
      </div>
    </div>

    <!-- 操作记录 -->
    <div class="pm-actions">
      <div class="pm-actions-title">操作记录</div>
      <div class="pm-action-form">
        <select v-model="actionType">
          <option value="buy">买入</option>
          <option value="sell">卖出</option>
        </select>
        <input v-model="actionSymbol" placeholder="股票代码" />
        <button class="pm-btn pm-btn-primary" @click="addAction" :disabled="!actionSymbol.trim()">记录</button>
      </div>
      <div v-if="warnings.length > 0" class="pm-warnings">
        <div v-for="(w, i) in warnings" :key="i" class="pm-warning">
          ⚠️ {{ w }}
        </div>
      </div>
      <div class="pm-action-list" v-if="actions.length > 0">
        <div v-for="(a, i) in actions.slice().reverse()" :key="i" class="pm-action-item">
          <span class="pm-action-type" :class="a.type === 'buy' ? 'text-green' : 'text-red'">
            {{ a.type === 'buy' ? '买入' : '卖出' }}
          </span>
          <span class="pm-action-symbol">{{ a.symbol }}</span>
          <span class="pm-action-date">{{ a.date }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted } from 'vue'

export default {
  name: 'PositionManager',
  setup() {
    const currentMode = ref('empty')
    const yearStockCount = ref(0)
    const monthTradeCount = ref(0)
    const currentHolding = ref(0)
    const actions = ref([])
    const actionType = ref('buy')
    const actionSymbol = ref('')

    const modeConfig = computed(() => {
      const configs = {
        empty: { icon: '🚫', label: '空仓期', desc: '当前应保持空仓，禁止买入', maxPosition: 0, color: '#dc2626' },
        light: { icon: '⚖️', label: '轻仓/半仓期', desc: '可半仓操作，选股需从高点跌50%以上', maxPosition: 50, color: '#d97706' },
        heavy: { icon: '💪', label: '重仓期', desc: '可重仓80%，需满足大盘跌20%+个股跌50%条件', maxPosition: 80, color: '#16a34a' },
        short: { icon: '⚡', label: '短线期', desc: '保持20%仓位短线操作，可做可不做', maxPosition: 20, color: '#2563eb' },
      }
      return configs[currentMode.value]
    })

    const warnings = computed(() => {
      const w = []
      if (currentMode.value === 'empty') {
        w.push('当前为空仓期，严禁买入任何股票！')
      }
      if (yearStockCount.value >= 6) {
        w.push('年度买入已达6只上限，禁止再买新股！')
      }
      if (monthTradeCount.value >= 3) {
        w.push('本月交易已达3次上限，禁止再操作！')
      }
      if (currentHolding.value >= 3) {
        w.push('当前持仓已达3只上限，禁止再买新股！')
      }
      return w
    })

    function saveMode() {
      localStorage.setItem('pm-mode', currentMode.value)
    }

    function addAction() {
      if (!actionSymbol.value.trim()) return
      const now = new Date()
      const dateStr = `${now.getMonth() + 1}/${now.getDate()}`

      actions.value.push({
        type: actionType.value,
        symbol: actionSymbol.value.trim().toUpperCase(),
        date: dateStr,
      })

      if (actionType.value === 'buy') {
        yearStockCount.value++
        monthTradeCount.value++
        currentHolding.value++
      } else {
        monthTradeCount.value++
        currentHolding.value = Math.max(0, currentHolding.value - 1)
      }

      localStorage.setItem('pm-actions', JSON.stringify(actions.value))
      localStorage.setItem('pm-yearCount', yearStockCount.value)
      localStorage.setItem('pm-monthCount', monthTradeCount.value)
      localStorage.setItem('pm-holding', currentHolding.value)
      actionSymbol.value = ''
    }

    onMounted(() => {
      const saved = localStorage.getItem('pm-mode')
      if (saved) currentMode.value = saved
      const savedActions = localStorage.getItem('pm-actions')
      if (savedActions) actions.value = JSON.parse(savedActions)
      const yc = localStorage.getItem('pm-yearCount')
      if (yc) yearStockCount.value = parseInt(yc)
      const mc = localStorage.getItem('pm-monthCount')
      if (mc) monthTradeCount.value = parseInt(mc)
      const ch = localStorage.getItem('pm-holding')
      if (ch) currentHolding.value = parseInt(ch)
    })

    return {
      currentMode, yearStockCount, monthTradeCount, currentHolding,
      actions, actionType, actionSymbol, modeConfig, warnings,
      saveMode, addAction,
    }
  },
}
</script>

<style scoped>
.position-manager {
  font-size: 13px;
}
.pm-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.pm-title {
  font-weight: 600;
  font-size: 14px;
}
.pm-month-select {
  display: flex;
  align-items: center;
  gap: 6px;
}
.pm-month-select label {
  color: var(--text-secondary);
  font-size: 12px;
}
.pm-month-select select {
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 12px;
  background: var(--card-bg, #fff);
}
.pm-status {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-radius: 8px;
  margin-bottom: 12px;
}
.pm-status-empty { background: #fef2f2; border: 1px solid #fecaca; }
.pm-status-light { background: #fffbeb; border: 1px solid #fde68a; }
.pm-status-heavy { background: #f0fdf4; border: 1px solid #bbf7d0; }
.pm-status-short { background: #eff6ff; border: 1px solid #bfdbfe; }
.pm-status-icon { font-size: 28px; }
.pm-status-info { flex: 1; }
.pm-status-label { font-weight: 700; font-size: 15px; }
.pm-status-desc { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }
.pm-status-percent { font-size: 28px; font-weight: 800; font-variant-numeric: tabular-nums; }
.pm-status-empty .pm-status-percent { color: #dc2626; }
.pm-status-light .pm-status-percent { color: #d97706; }
.pm-status-heavy .pm-status-percent { color: #16a34a; }
.pm-status-short .pm-status-percent { color: #2563eb; }
.pm-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-bottom: 12px;
}
.pm-stat {
  text-align: center;
  padding: 10px 8px;
  background: var(--bg);
  border-radius: 6px;
}
.pm-stat-value {
  font-size: 20px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.pm-stat-label {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 2px;
}
.pm-actions-title {
  font-weight: 600;
  margin-bottom: 8px;
}
.pm-action-form {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}
.pm-action-form select,
.pm-action-form input {
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 12px;
  background: var(--card-bg, #fff);
}
.pm-action-form input { flex: 1; }
.pm-btn {
  padding: 6px 12px;
  border: none;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  font-weight: 500;
}
.pm-btn-primary { background: var(--primary, #2563eb); color: white; }
.pm-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.pm-warnings {
  margin-bottom: 8px;
}
.pm-warning {
  padding: 6px 10px;
  background: #fef2f2;
  color: #dc2626;
  border-radius: 4px;
  font-size: 12px;
  margin-bottom: 4px;
  font-weight: 500;
}
.pm-action-list {
  max-height: 150px;
  overflow-y: auto;
}
.pm-action-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 0;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
}
.pm-action-type { font-weight: 600; width: 30px; }
.pm-action-symbol { font-weight: 500; flex: 1; }
.pm-action-date { color: var(--text-secondary); font-size: 11px; }
.text-green { color: #16a34a; }
.text-red { color: #dc2626; }
</style>
