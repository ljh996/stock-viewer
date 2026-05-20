<template>
  <div class="signal-wrap">
    <!-- Header -->
    <div class="signal-header">
      <div class="signal-brand">
        <svg class="signal-brand-icon" viewBox="0 0 24 24" fill="none">
          <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
          <path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
          <path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
          <path d="M12 12V22" stroke="currentColor" stroke-width="1.5"/>
        </svg>
        <span class="signal-brand-text">AI 买卖信号</span>
        <span class="signal-brand-badge">PRO</span>
      </div>
      <div class="signal-actions">
        <button
          class="signal-btn-analyze"
          :disabled="!stock || loading"
          @click="fetchSignalAnalysis"
        >
          <svg class="signal-btn-icon" viewBox="0 0 16 16" fill="none" width="14" height="14">
            <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.2"/>
            <path d="M8 5V8L10 10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
          </svg>
          {{ loading ? 'AI 分析中...' : (hasResult ? '重新分析' : 'AI 分析信号') }}
        </button>
      </div>
    </div>

    <!-- Input Form -->
    <div class="signal-form">
      <div class="signal-form-row">
        <div class="signal-form-group">
          <label class="signal-label">
            今日换手率 (%)
            <span v-if="turnoverRate != null" class="signal-filled">已自动填充</span>
          </label>
          <input type="number" class="signal-input" v-model.number="turnoverRate" placeholder="如 15.5" step="0.1" />
        </div>
        <div class="signal-form-group">
          <label class="signal-label">
            个股从最高点跌幅 (%)
            <span v-if="dropFromHigh != null" class="signal-filled">已自动填充</span>
          </label>
          <input type="number" class="signal-input" v-model.number="dropFromHigh" placeholder="如 55" step="1" />
        </div>
      </div>
      <div class="signal-form-row">
        <div class="signal-form-group">
          <label class="signal-label">
            大盘从高点跌幅 (%)
            <span v-if="marketDrop != null" class="signal-filled">已自动填充</span>
          </label>
          <input type="number" class="signal-input" v-model.number="marketDrop" placeholder="如 20" step="1" />
        </div>
        <div class="signal-form-group">
          <label class="signal-label">是否次新股</label>
          <select class="signal-select" v-model="isNewStock">
            <option :value="false">否</option>
            <option :value="true">是</option>
          </select>
        </div>
      </div>
      <div v-if="autoFilling" class="signal-auto-hint">正在自动获取参数...</div>
    </div>

    <!-- Scan Skeleton -->
    <div v-if="loading" class="signal-scanning">
      <div class="signal-scan-bar"><div class="signal-scan-progress"></div></div>
      <div class="signal-scan-text">DeepSeek AI 正在研判买卖信号...</div>
    </div>

    <!-- Results -->
    <template v-if="!loading && hasResult">
      <!-- Buy Signals -->
      <div class="signal-section">
        <div class="signal-section-title">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 10L7 4L11 10" stroke="#22c55e" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          买入信号
          <span class="signal-section-count">{{ buySignals.filter(s => s.met).length }}/{{ buySignals.length }}</span>
        </div>
        <div class="signal-list">
          <div v-for="(s, i) in buySignals" :key="i" class="signal-item" :class="s.met ? 'signal-bull' : 'signal-neutral'">
            <div class="signal-item-top">
              <span class="signal-item-icon">{{ s.met ? '🟢' : '⚪' }}</span>
              <span class="signal-item-name">{{ s.name }}</span>
            </div>
            <div class="signal-item-detail">{{ s.detail }}</div>
            <div v-if="s.reason" class="signal-item-reason">{{ s.reason }}</div>
          </div>
        </div>
      </div>

      <!-- Sell Signals -->
      <div class="signal-section">
        <div class="signal-section-title">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 6L7 2L11 6" stroke="#ef4444" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          卖出 / 风险信号
          <span class="signal-section-count">{{ sellSignals.filter(s => s.met).length }}/{{ sellSignals.length }}</span>
        </div>
        <div class="signal-list">
          <div v-for="(s, i) in sellSignals" :key="i" class="signal-item" :class="s.met ? 'signal-bear' : 'signal-neutral'">
            <div class="signal-item-top">
              <span class="signal-item-icon">{{ s.met ? '🔴' : '⚪' }}</span>
              <span class="signal-item-name">{{ s.name }}</span>
            </div>
            <div class="signal-item-detail">{{ s.detail }}</div>
            <div v-if="s.reason" class="signal-item-reason">{{ s.reason }}</div>
          </div>
        </div>
      </div>

      <!-- AI Advice -->
      <div class="signal-advice" :class="adviceCardClass">
        <div class="signal-advice-icon">{{ adviceIcon }}</div>
        <div class="signal-advice-body">
          <div class="signal-advice-action">{{ advice.action }}</div>
          <div class="signal-advice-reason">{{ advice.reason }}</div>
        </div>
      </div>

      <div class="signal-footer">
        <span class="signal-footer-meta">
          <span class="signal-meta-dot"></span>
          AI 可信度 {{ advice.confidence }}%
        </span>
        <span class="signal-footer-meta">
          <span class="signal-meta-dot"></span>
          DeepSeek AI 分析
        </span>
      </div>
    </template>

    <!-- Empty State -->
    <div v-if="!hasResult && !loading" class="signal-empty">
      <svg class="signal-empty-icon" viewBox="0 0 40 40" fill="none">
        <circle cx="20" cy="20" r="16" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 4"/>
        <path d="M20 12V20L25 24" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      <div class="signal-empty-text">参数已自动获取，点击「AI 分析信号」</div>
      <div class="signal-empty-hint">DeepSeek AI 将结合技术指标进行专业研判</div>
    </div>
  </div>
</template>

<script>
import { ref, computed, watch, onMounted } from 'vue'
import axios from 'axios'

const api = axios.create({ baseURL: '/api', timeout: 30000 })

export default {
  name: 'SignalAlert',
  props: {
    stock: { type: Object, default: null },
  },
  setup(props) {
    const turnoverRate = ref(null)
    const dropFromHigh = ref(null)
    const marketDrop = ref(null)
    const isNewStock = ref(false)
    const loading = ref(false)
    const autoFilling = ref(false)
    const hasResult = ref(false)
    const result = ref(null)
    const error = ref(null)

    const buySignals = computed(() => result.value?.buySignals || [])
    const sellSignals = computed(() => result.value?.sellSignals || [])

    const advice = computed(() => result.value?.advice || { action: '等待分析...', reason: '', confidence: 0 })
    const riskLevel = computed(() => result.value?.riskLevel || 'medium')

    const adviceCardClass = computed(() => {
      switch (riskLevel.value) {
        case 'low': return 'signal-advice-green'
        case 'high': return 'signal-advice-red'
        default: return 'signal-advice-yellow'
      }
    })

    const adviceIcon = computed(() => {
      switch (riskLevel.value) {
        case 'low': return '🟢'
        case 'high': return '🔴'
        default: return '🟡'
      }
    })

    async function fetchSignalAnalysis() {
      if (!props.stock) return
      loading.value = true
      error.value = null

      try {
        const resp = await api.post('/ai/signal-analysis', {
          stock: props.stock,
          turnoverRate: turnoverRate.value,
          dropFromHigh: dropFromHigh.value,
          marketDrop: marketDrop.value,
          isNewStock: isNewStock.value,
        })
        if (resp.data?.success && resp.data?.data) {
          result.value = resp.data.data
          hasResult.value = true
        } else {
          throw new Error(resp.data?.error || 'AI 返回异常')
        }
      } catch (e) {
        error.value = e.message
        // Fallback rule-based analysis
        result.value = fallbackSignalAnalysis(props.stock, {
          turnoverRate: turnoverRate.value,
          dropFromHigh: dropFromHigh.value,
          marketDrop: marketDrop.value,
          isNewStock: isNewStock.value,
        })
        hasResult.value = true
      } finally {
        loading.value = false
      }
    }

    async function autoFill() {
      if (!props.stock || !props.stock.symbol) return
      autoFilling.value = true
      try {
        const market = props.stock.market || 'CN'
        if (market === 'CN') {
          const resp = await api.get(`/stock/cn/${props.stock.symbol}/auto-fill`)
          if (resp.data?.success && resp.data?.data) {
            const d = resp.data.data
            if (d.turnoverRate != null) turnoverRate.value = d.turnoverRate
            if (d.dropFromHigh != null) dropFromHigh.value = d.dropFromHigh
            if (d.marketDrop != null) marketDrop.value = d.marketDrop
          }
        }
      } catch (e) {
        console.log('自动填充失败:', e.message)
      } finally {
        autoFilling.value = false
      }
    }

    // 切换股票时自动填充参数
    watch(() => props.stock?.symbol, () => {
      hasResult.value = false
      result.value = null
      if (props.stock) autoFill()
    })

    onMounted(() => {
      if (props.stock) autoFill()
    })

    return {
      turnoverRate, dropFromHigh, marketDrop, isNewStock,
      loading, autoFilling, hasResult, error,
      buySignals, sellSignals, advice, riskLevel,
      adviceCardClass, adviceIcon,
      fetchSignalAnalysis,
    }
  },
}

function fallbackSignalAnalysis(stock, params) {
  const { turnoverRate, dropFromHigh, marketDrop, isNewStock } = params
  const cp = stock?.changePercent || 0
  const buySignals = []
  const sellSignals = []

  if (marketDrop != null) {
    buySignals.push({
      name: '大盘跌幅到位',
      met: marketDrop >= 20,
      detail: marketDrop >= 20 ? '大盘从高点下跌已达底部区间，系统性风险释放充分' : `大盘下跌 ${marketDrop}%，尚未达到 20% 的底部参考线`,
      reason: `大盘跌幅 ${marketDrop}% | 参考阈值 ≥20%`,
    })
  }

  if (dropFromHigh != null) {
    buySignals.push({
      name: '个股超跌到位',
      met: dropFromHigh >= 50,
      detail: dropFromHigh >= 50 ? '个股从最高点下跌超过 50%，处于历史级别超跌区间' : `个股下跌 ${dropFromHigh}%，尚未进入 50% 的超跌区间`,
      reason: `个股跌幅 ${dropFromHigh}% | 参考阈值 ≥50%`,
    })
  }

  if (isNewStock) {
    buySignals.push({
      name: '次新股属性',
      met: true,
      detail: '次新股筹码相对干净，套牢盘少，反弹弹性通常较大',
      reason: '次新股特征',
    })
  }

  buySignals.push({
    name: '日内涨幅适中',
    met: cp < 5,
    detail: cp < 5 ? `今日涨幅 ${cp.toFixed(2)}%，未过度透支短线动能` : `今日涨幅 ${cp.toFixed(2)}%，短线涨幅偏大需警惕追高风险`,
    reason: `涨跌幅 ${cp.toFixed(2)}% | 参考阈值 <5%`,
  })

  if (turnoverRate != null && turnoverRate >= 30) {
    sellSignals.push({
      name: '换手率过高',
      met: true,
      detail: `换手率 ${turnoverRate}% ≥ 30%，属于极高换手，建议减仓 70% 以上`,
      reason: `换手率 ${turnoverRate}% ≥ 30%`,
    })
  } else if (turnoverRate != null) {
    sellSignals.push({
      name: '换手率正常',
      met: false,
      detail: `换手率 ${turnoverRate}%，未触发高风险阈值`,
      reason: `换手率 ${turnoverRate}% | 警戒阈值 ≥30%`,
    })
  }

  if (cp > 9) {
    sellSignals.push({
      name: '涨幅过大',
      met: true,
      detail: `涨幅 ${cp.toFixed(2)}%，接近涨停，次日回调概率较大`,
      reason: `涨跌幅 ${cp.toFixed(2)}% | 警戒阈值 >9%`,
    })
  }

  const highRiskSell = sellSignals.filter(s => s.met).length
  const metBuy = buySignals.filter(s => s.met).length
  const riskLevel = highRiskSell >= 2 ? 'high' : metBuy >= 2 ? 'low' : 'medium'

  let action, reason
  if (highRiskSell >= 2) {
    action = '建议减仓或观望'
    reason = `出现 ${highRiskSell} 个风险信号，当前风险收益比不佳，建议控制仓位`
  } else if (metBuy >= 3) {
    action = '可考虑分批买入'
    reason = `${metBuy}/${buySignals.length} 买入信号满足，具备较好的建仓条件`
  } else if (metBuy >= 2) {
    action = '保持关注'
    reason = `部分条件满足，建议等待更多确认信号再决策`
  } else {
    action = '耐心等待'
    reason = '买入条件尚不充分，等待更优时机'
  }

  return {
    buySignals,
    sellSignals,
    advice: { action, reason, confidence: 65 },
    riskLevel,
  }
}
</script>

<style scoped>
/* ─── Container ──────────────────────────────────────────── */
.signal-wrap {
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', sans-serif;
  color: var(--text, #1d1d1f);
}

/* ─── Header ─────────────────────────────────────────────── */
.signal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  gap: 12px;
}

.signal-brand {
  display: flex;
  align-items: center;
  gap: 8px;
}

.signal-brand-icon {
  width: 22px;
  height: 22px;
  color: #f59e0b;
}

.signal-brand-text {
  font-size: 15px;
  font-weight: 700;
  background: linear-gradient(135deg, #f59e0b, #ef4444);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.signal-brand-badge {
  font-size: 9px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 4px;
  background: linear-gradient(135deg, #f59e0b, #ef4444);
  color: #fff;
  letter-spacing: 0.5px;
}

.signal-actions {
  flex-shrink: 0;
}

.signal-btn-analyze {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border: none;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  background: linear-gradient(135deg, #f59e0b, #ef4444);
  color: #fff;
  transition: all 0.2s;
  white-space: nowrap;
}

.signal-btn-analyze:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 16px rgba(239, 68, 68, 0.25);
}

.signal-btn-analyze:active { transform: translateY(0); }
.signal-btn-analyze:disabled { opacity: 0.4; cursor: not-allowed; transform: none; box-shadow: none; }

.signal-btn-icon { flex-shrink: 0; }

/* ─── Form ───────────────────────────────────────────────── */
.signal-form {
  margin-bottom: 16px;
}

.signal-form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 10px;
}

@media (max-width: 640px) {
  .signal-form-row { grid-template-columns: 1fr; }
}

.signal-form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.signal-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary, #86868b);
}

.signal-filled {
  font-size: 9px;
  font-weight: 400;
  color: #22c55e;
  background: rgba(34,197,94,0.08);
  padding: 1px 6px;
  border-radius: 4px;
  margin-left: 4px;
}

.signal-auto-hint {
  font-size: 11px;
  color: var(--text-secondary, #86868b);
  font-style: italic;
  animation: pulse-dot 1.5s ease-in-out infinite;
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.signal-input,
.signal-select {
  padding: 8px 10px;
  border: 1px solid var(--border, #e5e7eb);
  border-radius: 10px;
  font-size: 13px;
  background: var(--card-bg, #fff);
  color: var(--text, #1d1d1f);
  transition: all 0.2s;
  outline: none;
}

.signal-input:focus,
.signal-select:focus {
  border-color: #f59e0b;
  box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.1);
}

[data-theme='dark'] .signal-input,
[data-theme='dark'] .signal-select {
  background: rgba(255,255,255,0.05);
  border-color: rgba(255,255,255,0.1);
}

/* ─── Scanning ───────────────────────────────────────────── */
.signal-scanning {
  margin-bottom: 16px;
}

.signal-scan-bar {
  height: 3px;
  background: var(--border, #e5e7eb);
  border-radius: 2px;
  margin-bottom: 8px;
  overflow: hidden;
}

.signal-scan-progress {
  height: 100%;
  width: 30%;
  background: linear-gradient(90deg, #f59e0b, #ef4444);
  border-radius: 2px;
  animation: signal-progress 1.5s ease-in-out infinite;
}

@keyframes signal-progress {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(400%); }
}

.signal-scan-text {
  font-size: 11px;
  color: var(--text-secondary, #86868b);
}

/* ─── Section ────────────────────────────────────────────── */
.signal-section {
  margin-bottom: 14px;
}

.signal-section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary, #86868b);
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.signal-section-count {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 10px;
  background: var(--border, #e5e7eb);
  color: var(--text-secondary, #86868b);
}

/* ─── Signal Items ───────────────────────────────────────── */
.signal-list {
  display: grid;
  gap: 6px;
}

.signal-item {
  padding: 12px;
  border-radius: 12px;
  border: 1px solid var(--border, #e5e7eb);
  background: var(--card-bg, #fff);
  transition: all 0.2s;
}

.signal-item:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 12px rgba(0,0,0,0.04);
}

[data-theme='dark'] .signal-item:hover {
  box-shadow: 0 2px 16px rgba(0,0,0,0.2);
}

.signal-bull {
  border-left: 3px solid #22c55e;
}

.signal-bear {
  border-left: 3px solid #ef4444;
}

.signal-neutral {
  border-left: 3px solid var(--border, #e5e7eb);
  opacity: 0.7;
}

.signal-item-top {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.signal-item-icon { font-size: 12px; }

.signal-item-name {
  font-size: 13px;
  font-weight: 600;
}

.signal-item-detail {
  font-size: 12px;
  line-height: 1.5;
  color: var(--text, #1d1d1f);
  margin-bottom: 4px;
}

.signal-item-reason {
  font-size: 10px;
  color: var(--text-secondary, #86868b);
  font-family: 'SF Mono', 'Menlo', monospace;
  padding-top: 4px;
  border-top: 1px solid var(--border, #e5e7eb);
}

/* ─── Advice ─────────────────────────────────────────────── */
.signal-advice {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px;
  border-radius: 14px;
  border: 1px solid;
  margin-bottom: 10px;
}

.signal-advice-green {
  background: linear-gradient(135deg, rgba(34,197,94,0.06), rgba(34,197,94,0.02));
  border-color: rgba(34,197,94,0.2);
}

.signal-advice-yellow {
  background: linear-gradient(135deg, rgba(245,158,11,0.06), rgba(245,158,11,0.02));
  border-color: rgba(245,158,11,0.2);
}

.signal-advice-red {
  background: linear-gradient(135deg, rgba(239,68,68,0.06), rgba(239,68,68,0.02));
  border-color: rgba(239,68,68,0.2);
}

.signal-advice-icon { font-size: 28px; line-height: 1; flex-shrink: 0; }

.signal-advice-body { flex: 1; min-width: 0; }

.signal-advice-action {
  font-size: 15px;
  font-weight: 700;
  margin-bottom: 4px;
}

.signal-advice-green .signal-advice-action { color: #22c55e; }
.signal-advice-yellow .signal-advice-action { color: #f59e0b; }
.signal-advice-red .signal-advice-action { color: #ef4444; }

.signal-advice-reason {
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-secondary, #86868b);
}

/* ─── Footer ─────────────────────────────────────────────── */
.signal-footer {
  display: flex;
  gap: 16px;
}

.signal-footer-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: var(--text-secondary, #86868b);
}

.signal-meta-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #f59e0b;
}

/* ─── Empty State ────────────────────────────────────────── */
.signal-empty {
  text-align: center;
  padding: 32px 16px;
}

.signal-empty-icon {
  width: 40px;
  height: 40px;
  color: var(--text-secondary, #86868b);
  opacity: 0.4;
  margin-bottom: 10px;
}

.signal-empty-text {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary, #86868b);
  margin-bottom: 4px;
}

.signal-empty-hint {
  font-size: 11px;
  color: var(--text-secondary, #86868b);
  opacity: 0.6;
}
</style>
