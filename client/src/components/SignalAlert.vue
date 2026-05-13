<template>
  <div class="signal-alert" v-if="stock">
    <div class="sa-title">🔔 买卖信号分析</div>

    <!-- 换手率输入 -->
    <div class="sa-input-row">
      <label>今日换手率(%)：</label>
      <input type="number" v-model.number="turnoverRate" placeholder="如 15.5" step="0.1" />
    </div>
    <div class="sa-input-row">
      <label>个股从最高点跌幅(%)：</label>
      <input type="number" v-model.number="dropFromHigh" placeholder="如 55" step="1" />
    </div>
    <div class="sa-input-row">
      <label>大盘从高点跌幅(%)：</label>
      <input type="number" v-model.number="marketDrop" placeholder="如 20" step="1" />
    </div>
    <div class="sa-input-row">
      <label>是否次新股：</label>
      <select v-model="isNewStock">
        <option :value="true">是</option>
        <option :value="false">否</option>
      </select>
    </div>

    <div class="sa-divider"></div>

    <!-- 信号结果 -->
    <div class="sa-signals">
      <!-- 买入信号 -->
      <div class="sa-section">
        <div class="sa-section-title text-green">买入信号</div>
        <div
          v-for="(s, i) in buySignals"
          :key="'b' + i"
          class="sa-signal"
          :class="s.pass ? 'sa-signal-pass' : 'sa-signal-fail'"
        >
          <span>{{ s.pass ? '✅' : '⬜' }}</span>
          <span>{{ s.text }}</span>
        </div>
      </div>

      <!-- 卖出信号 -->
      <div class="sa-section">
        <div class="sa-section-title text-red">卖出/减仓信号</div>
        <div
          v-for="(s, i) in sellSignals"
          :key="'s' + i"
          class="sa-signal"
          :class="s.active ? 'sa-signal-active' : 'sa-signal-inactive'"
        >
          <span>{{ s.active ? '🔴' : '⬜' }}</span>
          <span>{{ s.text }}</span>
        </div>
      </div>
    </div>

    <!-- 综合建议 -->
    <div class="sa-advice" :class="adviceClass">
      <div class="sa-advice-icon">{{ adviceIcon }}</div>
      <div>
        <div class="sa-advice-title">{{ adviceTitle }}</div>
        <div class="sa-advice-desc">{{ adviceDesc }}</div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed } from 'vue'

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

    const buySignals = computed(() => {
      const signals = []

      // 重仓买入条件
      if (marketDrop.value !== null) {
        signals.push({
          pass: marketDrop.value >= 20,
          text: `大盘下跌${marketDrop.value}%（需≥20%）→ ${marketDrop.value >= 20 ? '满足重仓条件' : '不满足'}`,
        })
      }

      if (dropFromHigh.value !== null) {
        signals.push({
          pass: dropFromHigh.value >= 50,
          text: `个股从高点跌${dropFromHigh.value}%（需≥50%）→ ${dropFromHigh.value >= 50 ? '满足' : '不满足'}`,
        })
      }

      if (isNewStock.value) {
        signals.push({
          pass: true,
          text: '次新股 ✓',
        })
      }

      // 当日涨跌幅判断
      if (props.stock) {
        const cp = props.stock.changePercent
        if (cp > 0) {
          signals.push({
            pass: cp < 5,
            text: `今日涨幅${cp.toFixed(2)}% → ${cp < 5 ? '正常范围' : '涨幅偏大，注意追高风险'}`,
          })
        }
      }

      return signals
    })

    const sellSignals = computed(() => {
      const signals = []

      if (turnoverRate.value !== null && turnoverRate.value >= 30) {
        signals.push({
          active: true,
          text: `换手率${turnoverRate.value}% ≥ 30% → 必须减仓！`,
        })

        if (turnoverRate.value >= 30) {
          signals.push({
            active: true,
            text: `建议减仓70%以上（首次30%换手规则）`,
          })
        }
      }

      if (props.stock) {
        const cp = props.stock.changePercent
        if (cp > 9) {
          signals.push({
            active: true,
            text: `涨幅${cp.toFixed(2)}% → 可能触及涨停，注意高位风险`,
          })
        }
      }

      return signals
    })

    const adviceClass = computed(() => {
      const hasActiveSell = sellSignals.value.some(s => s.active)
      if (hasActiveSell) return 'sa-advice-danger'
      const allBuyPass = buySignals.value.length > 0 && buySignals.value.every(s => s.pass)
      if (allBuyPass) return 'sa-advice-buy'
      return 'sa-advice-wait'
    })

    const adviceIcon = computed(() => {
      const cls = adviceClass.value
      if (cls === 'sa-advice-danger') return '🔴'
      if (cls === 'sa-advice-buy') return '🟢'
      return '🟡'
    })

    const adviceTitle = computed(() => {
      const cls = adviceClass.value
      if (cls === 'sa-advice-danger') return '建议减仓'
      if (cls === 'sa-advice-buy') return '可考虑买入'
      return '继续观望'
    })

    const adviceDesc = computed(() => {
      const cls = adviceClass.value
      if (cls === 'sa-advice-danger') return '出现卖出信号，请根据换手率分级减仓'
      if (cls === 'sa-advice-buy') return '买入条件基本满足，注意分批买入，做到快狠准'
      return '买入条件未完全满足，耐心等待更好的时机'
    })

    return {
      turnoverRate, dropFromHigh, marketDrop, isNewStock,
      buySignals, sellSignals,
      adviceClass, adviceIcon, adviceTitle, adviceDesc,
    }
  },
}
</script>

<style scoped>
.signal-alert { font-size: 13px; }
.sa-title { font-weight: 600; font-size: 14px; margin-bottom: 12px; }
.sa-input-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.sa-input-row label {
  width: 160px;
  flex-shrink: 0;
  color: var(--text-secondary);
  font-size: 12px;
}
.sa-input-row input,
.sa-input-row select {
  flex: 1;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 12px;
  background: var(--card-bg, #fff);
}
.sa-divider { height: 1px; background: var(--border); margin: 12px 0; }
.sa-section { margin-bottom: 10px; }
.sa-section-title { font-weight: 600; margin-bottom: 6px; font-size: 13px; }
.sa-signal {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
  font-size: 12px;
}
.sa-signal-pass { color: #16a34a; }
.sa-signal-fail { color: var(--text-secondary); }
.sa-signal-active { color: #dc2626; font-weight: 500; }
.sa-signal-inactive { color: var(--text-secondary); }
.sa-advice {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px;
  border-radius: 8px;
  margin-top: 12px;
}
.sa-advice-wait { background: #fffbeb; border: 1px solid #fde68a; }
.sa-advice-buy { background: #f0fdf4; border: 1px solid #bbf7d0; }
.sa-advice-danger { background: #fef2f2; border: 1px solid #fecaca; }
.sa-advice-icon { font-size: 24px; }
.sa-advice-title { font-weight: 700; font-size: 15px; }
.sa-advice-desc { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }
.text-green { color: #16a34a; }
.text-red { color: #dc2626; }
</style>
