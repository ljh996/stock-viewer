<template>
  <div class="backtest-panel">
    <div class="bp-header">
      <div class="bp-title">📈 策略回测</div>
    </div>

    <!-- 参数设置 -->
    <div class="bp-config">
      <div class="bp-row">
        <label>选择策略</label>
        <select v-model="config.strategy">
          <option value="conservative">🛡️ 保守型：红利护城河</option>
          <option value="garp">⚖️ 中立型：GARP均衡</option>
          <option value="momentum">🚀 激进型：动量爆发</option>
          <option value="potential">💎 潜力型：三维共振</option>
        </select>
      </div>
      <div class="bp-row">
        <label>初始资金</label>
        <input type="number" v-model.number="config.initialCapital" step="100000" min="10000" />
        <span class="bp-unit">元</span>
      </div>
      <div class="bp-row">
        <label>持仓周期</label>
        <select v-model="config.period">
          <option value="30">30天（1个月）</option>
          <option value="90">90天（3个月）</option>
          <option value="180">180天（6个月）</option>
        </select>
      </div>
      <button class="bp-run-btn" @click="runBacktest" :disabled="loading">
        <span v-if="loading" class="loading-spinner"></span>
        <span v-else>▶️</span>
        开始回测
      </button>
    </div>

    <!-- 错误提示 -->
    <div v-if="error" class="bp-error">{{ error }}</div>

    <!-- 加载中 -->
    <div v-if="loading" class="bp-loading">
      <div class="loading-spinner" style="width: 32px; height: 32px;"></div>
      <span>正在执行策略回测...</span>
    </div>

    <!-- 回测结果 -->
    <div v-if="result && !loading" class="bp-result">
      <!-- 核心指标 -->
      <div class="bp-metrics">
        <div class="bp-metric">
          <div class="bp-metric-value" :class="result.total_return >= 0 ? 'positive' : 'negative'">
            {{ result.total_return >= 0 ? '+' : '' }}{{ result.total_return }}%
          </div>
          <div class="bp-metric-label">总收益率</div>
        </div>
        <div class="bp-metric">
          <div class="bp-metric-value" :class="result.annual_return >= 0 ? 'positive' : 'negative'">
            {{ result.annual_return >= 0 ? '+' : '' }}{{ result.annual_return }}%
          </div>
          <div class="bp-metric-label">年化收益</div>
        </div>
        <div class="bp-metric">
          <div class="bp-metric-value negative">-{{ result.max_drawdown }}%</div>
          <div class="bp-metric-label">最大回撤</div>
        </div>
        <div class="bp-metric">
          <div class="bp-metric-value" :class="result.sharpe >= 1 ? 'positive' : ''">
            {{ result.sharpe }}
          </div>
          <div class="bp-metric-label">夏普比率</div>
        </div>
      </div>

      <!-- 权益曲线 -->
      <div class="bp-chart">
        <div class="bp-chart-title">权益曲线</div>
        <div class="bp-chart-container">
          <div class="bp-chart-bars">
            <div
              v-for="(e, i) in result.equity_curve"
              :key="i"
              class="bp-bar"
              :style="{
                height: barHeight(e.return_pct) + '%',
                background: e.return_pct >= 0 ? 'var(--up-color, #dc2626)' : 'var(--down-color, #16a34a)'
              }"
              :title="`第${e.day}天: ${e.return_pct}%`"
            ></div>
          </div>
          <div class="bp-chart-xaxis">
            <span>第1天</span>
            <span>第{{ result.equity_curve.length }}天</span>
          </div>
        </div>
      </div>

      <!-- 持仓明细 -->
      <div class="bp-holdings">
        <div class="bp-holdings-title">持仓明细（等权配置）</div>
        <table class="bp-table">
          <thead>
            <tr>
              <th>代码</th>
              <th>名称</th>
              <th>权重</th>
              <th>PE</th>
              <th>ROE</th>
              <th>净利润增速</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="h in result.holdings" :key="h.symbol">
              <td class="bp-code">{{ h.symbol }}</td>
              <td>{{ h.name }}</td>
              <td>{{ h.weight }}%</td>
              <td>{{ h.pe || '-' }}</td>
              <td>{{ h.roe || '-' }}%</td>
              <td>{{ h.np_growth || '-' }}%</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="bp-message">{{ result.message }}</div>
    </div>
  </div>
</template>

<script>
import { ref } from 'vue'
import axios from 'axios'

export default {
  name: 'BacktestPanel',
  setup() {
    const config = ref({
      strategy: 'conservative',
      initialCapital: 1000000,
      period: '30',
    })
    const loading = ref(false)
    const error = ref('')
    const result = ref(null)

    async function runBacktest() {
      loading.value = true
      error.value = ''
      result.value = null

      try {
        const res = await axios.post('/api/backtest', {
          strategy: config.value.strategy,
          initial_capital: config.value.initialCapital,
          period: parseInt(config.value.period),
        }, { timeout: 60000 })
        if (res.data.success) {
          result.value = res.data.data
        } else {
          error.value = res.data.error || '回测失败'
        }
      } catch (err) {
        error.value = '请求失败，请检查网络'
      } finally {
        loading.value = false
      }
    }

    function barHeight(returnPct) {
      const maxReturn = Math.max(...(result.value?.equity_curve || []).map(e => Math.abs(e.return_pct)), 10)
      return Math.min(100, Math.abs(returnPct) / maxReturn * 80 + 10)
    }

    return { config, loading, error, result, runBacktest, barHeight }
  },
}
</script>

<style scoped>
.backtest-panel { font-size: 13px; }
.bp-header { margin-bottom: 16px; }
.bp-title { font-weight: 700; font-size: 15px; }

.bp-config {
  background: var(--card-bg, #fff);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
}
.bp-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.bp-row:last-of-type { margin-bottom: 0; }
.bp-row label {
  width: 80px;
  font-weight: 500;
  color: var(--text-secondary);
}
.bp-row select, .bp-row input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  font-size: 13px;
}
.bp-unit { color: var(--text-secondary); font-size: 12px; }
.bp-run-btn {
  width: 100%;
  margin-top: 16px;
  padding: 12px;
  background: var(--primary, #2563eb);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.bp-run-btn:hover { opacity: 0.9; }
.bp-run-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.bp-error {
  padding: 12px;
  background: #fef2f2;
  color: #dc2626;
  border-radius: 8px;
  margin-bottom: 16px;
}
.bp-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px;
  color: var(--text-secondary);
}

.bp-result { margin-top: 16px; }
.bp-metrics {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 20px;
}
.bp-metric {
  background: var(--card-bg, #fff);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px;
  text-align: center;
}
.bp-metric-value {
  font-size: 24px;
  font-weight: 700;
  margin-bottom: 4px;
}
.bp-metric-value.positive { color: #dc2626; }
.bp-metric-value.negative { color: #16a34a; }
.bp-metric-label {
  font-size: 12px;
  color: var(--text-secondary);
}

.bp-chart {
  background: var(--card-bg, #fff);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
}
.bp-chart-title {
  font-weight: 600;
  margin-bottom: 12px;
}
.bp-chart-container { height: 150px; position: relative; }
.bp-chart-bars {
  display: flex;
  align-items: flex-end;
  height: 120px;
  gap: 2px;
}
.bp-bar {
  flex: 1;
  min-width: 4px;
  border-radius: 2px 2px 0 0;
  transition: height 0.2s;
}
.bp-chart-xaxis {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 8px;
}

.bp-holdings {
  background: var(--card-bg, #fff);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
}
.bp-holdings-title {
  font-weight: 600;
  margin-bottom: 12px;
}
.bp-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.bp-table th, .bp-table td {
  padding: 8px;
  text-align: center;
  border-bottom: 1px solid var(--border);
}
.bp-table th { font-weight: 600; color: var(--text-secondary); }
.bp-code { color: var(--primary, #2563eb); font-weight: 600; }

.bp-message {
  text-align: center;
  font-size: 12px;
  color: var(--text-secondary);
  padding: 8px;
}
</style>
