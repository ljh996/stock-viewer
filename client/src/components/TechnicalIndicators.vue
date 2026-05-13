<template>
  <div class="indicators-panel">
    <div v-if="!data || data.length === 0" class="empty-state">
      暂无数据，请先查询股票行情
    </div>

    <div v-else>
      <!-- 指标切换标签 -->
      <nav class="indicator-tabs">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="indicator-tab"
          :class="{ active: activeTab === tab.key }"
          @click="activeTab = tab.key"
        >
          {{ tab.label }}
        </button>
      </nav>

      <!-- ============ 均线 ============ -->
      <div v-show="activeTab === 'ma'">
        <div class="indicator-header">
          <span class="indicator-title">移动平均线 (MA)</span>
          <div class="ma-legend">
            <span class="ma-legend-item" style="color: #f59e0b;">MA5</span>
            <span class="ma-legend-item" style="color: #3b82f6;">MA10</span>
            <span class="ma-legend-item" style="color: #10b981;">MA20</span>
            <span class="ma-legend-item" style="color: #8b5cf6;">MA60</span>
          </div>
        </div>
        <svg :width="chartW" :height="300" class="indicator-chart">
          <!-- Y轴 -->
          <template v-for="(v, idx) in yTicks" :key="'yg-'+idx">
            <line :x1="padL" :y1="v.y" :x2="chartW-padR" :y2="v.y" stroke="var(--border)" stroke-dasharray="3,3" />
            <text :x="padL-6" :y="v.y+4" text-anchor="end" fill="var(--text-secondary)" font-size="10">{{ v.label }}</text>
          </template>

          <!-- 蜡烛图 -->
          <g v-for="(d, i) in visibleData" :key="'candle-'+i">
            <line
              :x1="xPos(i)" :y1="scaleY(d.high)"
              :x2="xPos(i)" :y2="scaleY(d.low)"
              :stroke="d.close >= d.open ? '#16a34a' : '#dc2626'"
              stroke-width="1"
            />
            <rect
              :x="xPos(i)-candleW/2" :y="scaleY(Math.max(d.open, d.close))"
              :width="candleW" :height="Math.max(Math.abs(scaleY(d.open)-scaleY(d.close)), 1)"
              :fill="d.close >= d.open ? '#16a34a' : '#dc2626'"
            />
          </g>

          <!-- 均线 -->
          <polyline v-for="ma in maLines" :key="ma.key" :points="ma.points" :stroke="ma.color" fill="none" stroke-width="1.5" />
        </svg>
      </div>

      <!-- ============ MACD ============ -->
      <div v-show="activeTab === 'macd'">
        <div class="indicator-header">
          <span class="indicator-title">MACD (12, 26, 9)</span>
          <div class="ma-legend">
            <span class="ma-legend-item" style="color: #3b82f6;">MACD</span>
            <span class="ma-legend-item" style="color: #f59e0b;">信号线</span>
          </div>
        </div>
        <svg :width="chartW" :height="200" class="indicator-chart">
          <!-- Y轴 -->
          <template v-for="(v, idx) in macdYTicks" :key="'myg-'+idx">
            <line :x1="padL" :y1="v.y" :x2="chartW-padR" :y2="v.y" stroke="var(--border)" stroke-dasharray="3,3" />
            <text :x="padL-6" :y="v.y+4" text-anchor="end" fill="var(--text-secondary)" font-size="10">{{ v.label }}</text>
          </template>

          <!-- 柱状图 -->
          <rect
            v-for="(d, i) in macdVisible"
            :key="'hist-'+i"
            :x="xPos(i) - Math.max(candleW * 0.15, 2)"
            :width="Math.max(candleW * 0.3, 4)"
            :y="d.histogram >= 0 ? macdScaleY(d.histogram) : macdScaleY(0)"
            :height="Math.abs(macdScaleY(d.histogram)-macdScaleY(0))"
            :fill="d.histogram >= 0 ? '#dc2626' : '#16a34a'"
            opacity="0.6"
          />

          <!-- MACD 线 -->
          <polyline v-if="macdLinePts.length > 1" :points="macdLinePts" stroke="#3b82f6" fill="none" stroke-width="1.5" />
          <!-- 信号线 -->
          <polyline v-if="signalLinePts.length > 1" :points="signalLinePts" stroke="#f59e0b" fill="none" stroke-width="1.5" />
        </svg>
      </div>

      <!-- ============ RSI ============ -->
      <div v-show="activeTab === 'rsi'">
        <div class="indicator-header">
          <span class="indicator-title">RSI (14)</span>
          <div class="ma-legend">
            <span class="ma-legend-item" style="color: #ef4444;">超买 (70)</span>
            <span class="ma-legend-item" style="color: #10b981;">超卖 (30)</span>
          </div>
        </div>
        <svg :width="chartW" :height="200" class="indicator-chart">
          <!-- 超买/超卖线 -->
          <line :x1="padL" :y1="rsiY(70)" :x2="chartW-padR" :y2="rsiY(70)" stroke="#ef4444" stroke-dasharray="4,4" opacity="0.5" />
          <line :x1="padL" :y1="rsiY(30)" :x2="chartW-padR" :y2="rsiY(30)" stroke="#10b981" stroke-dasharray="4,4" opacity="0.5" />
          <text :x="chartW-padR+4" :y="rsiY(70)+4" fill="#ef4444" font-size="10" opacity="0.6">70</text>
          <text :x="chartW-padR+4" :y="rsiY(30)+4" fill="#10b981" font-size="10" opacity="0.6">30</text>

          <!-- 50 中线 -->
          <line :x1="padL" :y1="rsiY(50)" :x2="chartW-padR" :y2="rsiY(50)" stroke="var(--border)" stroke-dasharray="3,3" />

          <!-- RSI 线 -->
          <polyline v-if="rsiPts.length > 1" :points="rsiPts" stroke="#8b5cf6" fill="none" stroke-width="2" />
        </svg>
        <div class="rsi-value" :class="{ overbought: lastRSI >= 70, oversold: lastRSI <= 30 }">
          当前 RSI: <strong>{{ lastRSI }}</strong>
          <span v-if="lastRSI >= 70"> (超买)</span>
          <span v-else-if="lastRSI <= 30"> (超卖)</span>
        </div>
      </div>

      <!-- ============ 布林带 ============ -->
      <div v-show="activeTab === 'boll'">
        <div class="indicator-header">
          <span class="indicator-title">布林带 (20, 2)</span>
        </div>
        <svg :width="chartW" :height="300" class="indicator-chart">
          <!-- Y轴 -->
          <template v-for="(v, idx) in yTicks" :key="'byg-'+idx">
            <line :x1="padL" :y1="v.y" :x2="chartW-padR" :y2="v.y" stroke="var(--border)" stroke-dasharray="3,3" />
            <text :x="padL-6" :y="v.y+4" text-anchor="end" fill="var(--text-secondary)" font-size="10">{{ v.label }}</text>
          </template>

          <!-- 上轨/中轨/下轨 -->
          <polyline v-if="bollUpperPts.length > 1" :points="bollUpperPts" stroke="#dc2626" fill="none" stroke-width="1" opacity="0.6" />
          <polyline v-if="bollSmaPts.length > 1" :points="bollSmaPts" stroke="#3b82f6" fill="none" stroke-width="1.5" />
          <polyline v-if="bollLowerPts.length > 1" :points="bollLowerPts" stroke="#10b981" fill="none" stroke-width="1" opacity="0.6" />

          <!-- 收盘价 -->
          <polyline v-if="closePts.length > 1" :points="closePts" stroke="#f59e0b" fill="none" stroke-width="1.5" />
        </svg>
      </div>
    </div>
  </div>
</template>

<script>
import { computed, ref } from 'vue'
import { calcSMA, calcMACD, calcRSI, calcBollinger } from '../utils/indicators.js'

export default {
  name: 'TechnicalIndicators',
  props: {
    data: { type: Array, default: () => [] },
  },
  setup(props) {
    const padL = 55, padR = 15
    const visibleCount = ref(120)

    const tabs = [
      { key: 'ma', label: '均线 MA' },
      { key: 'macd', label: 'MACD' },
      { key: 'rsi', label: 'RSI' },
      { key: 'boll', label: '布林带' },
    ]
    const activeTab = ref('ma')

    const visibleData = computed(() => props.data.slice(-visibleCount.value))

    const closes = computed(() => visibleData.value.map(d => d.close))

    const chartW = computed(() => Math.max(visibleData.value.length * 8, 400))

    const minVal = computed(() => Math.min(...closes.value))
    const maxVal = computed(() => Math.max(...closes.value))
    const rangeV = computed(() => maxVal.value - minVal.value || 1)

    const candleW = computed(() => Math.min(Math.max((chartW.value - padL - padR) / visibleData.value.length - 1, 2), 8))

    function scaleY(v) {
      return 40 + (1 - (v - minVal.value) / rangeV.value) * 230
    }

    function xPos(i) {
      return padL + (i / Math.max(visibleData.value.length - 1, 1)) * (chartW.value - padL - padR)
    }

    const yTicks = computed(() => {
      const ticks = []
      for (let r = 0; r <= 4; r++) {
        const v = maxVal.value - r / 4 * rangeV.value
        ticks.push({ label: v.toFixed(2), y: scaleY(v) })
      }
      return ticks
    })

    // ---- 均线 ----
    const maPeriods = [
      { key: 'ma5', period: 5, color: '#f59e0b' },
      { key: 'ma10', period: 10, color: '#3b82f6' },
      { key: 'ma20', period: 20, color: '#10b981' },
      { key: 'ma60', period: 60, color: '#8b5cf6' },
    ]

    const maLines = computed(() => {
      return maPeriods.map(({ key, period, color }) => {
        const values = calcSMA(closes.value, period)
        const pts = values.map((v, i) => {
          if (v === null) return null
          return `${xPos(i)},${scaleY(v)}`
        }).filter(p => p !== null).join(' ')
        return { key, points: pts, color }
      })
    })

    // ---- MACD ----
    const macdResult = computed(() => calcMACD(closes.value, 12, 26, 9))

    const macdValues = computed(() => {
      const result = []
      for (let i = 0; i < macdResult.value.macdLine.length; i++) {
        result.push({
          macd: macdResult.value.macdLine[i],
          signal: macdResult.value.signalLine[i],
          histogram: macdResult.value.histogram[i],
        })
      }
      return result
    })

    const macdVisible = computed(() => macdValues.value)

    const macdAllValues = computed(() => {
      const vals = []
      macdVisible.value.forEach(d => {
        if (d.macd !== null) vals.push(d.macd)
        if (d.signal !== null) vals.push(d.signal)
      })
      return vals
    })

    const macdMin = computed(() => Math.min(...macdAllValues.value, 0))
    const macdMax = computed(() => Math.max(...macdAllValues.value, 0))

    function macdScaleY(v) {
      const r = macdMax.value - macdMin.value || 1
      return 20 + (1 - (v - macdMin.value) / r) * 160
    }

    const macdYTicks = computed(() => {
      const ticks = []
      const r = macdMax.value - macdMin.value || 1
      for (let i = 0; i <= 4; i++) {
        const v = macdMax.value - i / 4 * r
        ticks.push({ label: v.toFixed(2), y: macdScaleY(v) })
      }
      return ticks
    })

    const macdLinePts = computed(() => {
      return macdVisible.value.map((d, i) => {
        if (d.macd === null) return null
        return `${xPos(i)},${macdScaleY(d.macd)}`
      }).filter(p => p !== null).join(' ')
    })

    const signalLinePts = computed(() => {
      return macdVisible.value.map((d, i) => {
        if (d.signal === null) return null
        return `${xPos(i)},${macdScaleY(d.signal)}`
      }).filter(p => p !== null).join(' ')
    })

    // ---- RSI ----
    const rsiValues = computed(() => calcRSI(closes.value, 14))
    const lastRSI = computed(() => {
      const vals = rsiValues.value.filter(v => v !== null)
      return vals.length > 0 ? vals[vals.length - 1].toFixed(1) : '--'
    })

    function rsiY(v) {
      return 20 + (1 - v / 100) * 160
    }

    const rsiPts = computed(() => {
      return rsiValues.value.map((v, i) => {
        if (v === null) return null
        return `${xPos(i)},${rsiY(v)}`
      }).filter(p => p !== null).join(' ')
    })

    // ---- 布林带 ----
    const bollResult = computed(() => calcBollinger(closes.value, 20, 2))

    const closePts = computed(() => {
      return closes.value.map((v, i) => `${xPos(i)},${scaleY(v)}`).join(' ')
    })

    const bollUpperPts = computed(() => {
      return bollResult.value.upper.map((v, i) => {
        if (v === null) return null
        return `${xPos(i)},${scaleY(v)}`
      }).filter(p => p !== null).join(' ')
    })

    const bollSmaPts = computed(() => {
      return bollResult.value.sma.map((v, i) => {
        if (v === null) return null
        return `${xPos(i)},${scaleY(v)}`
      }).filter(p => p !== null).join(' ')
    })

    const bollLowerPts = computed(() => {
      return bollResult.value.lower.map((v, i) => {
        if (v === null) return null
        return `${xPos(i)},${scaleY(v)}`
      }).filter(p => p !== null).join(' ')
    })

    return {
      padL, padR, candleW,
      tabs, activeTab,
      visibleData, chartW,
      yTicks, scaleY, xPos,
      maLines,
      macdVisible, macdYTicks, macdScaleY, macdLinePts, signalLinePts,
      rsiPts, rsiY, lastRSI,
      closePts, bollUpperPts, bollSmaPts, bollLowerPts,
    }
  },
}
</script>

<style scoped>
.indicators-panel {
  padding: 0;
}

.empty-state {
  text-align: center;
  color: var(--text-secondary);
  padding: 48px 0;
  font-size: 14px;
}

.indicator-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 12px;
  border-bottom: 2px solid var(--border);
  padding-bottom: 0;
}

.indicator-tab {
  padding: 8px 16px;
  border: none;
  background: none;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 13px;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  transition: all 0.2s;
}

.indicator-tab:hover {
  color: var(--text);
}

.indicator-tab.active {
  color: var(--primary, #3b82f6);
  border-bottom-color: var(--primary, #3b82f6);
  font-weight: 600;
}

.indicator-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.indicator-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}

.ma-legend {
  display: flex;
  gap: 12px;
}

.ma-legend-item {
  font-size: 11px;
  font-weight: 500;
}

.indicator-chart {
  display: block;
  margin: 0 auto;
  background: var(--card-bg, #fff);
  border-radius: 8px;
}

.rsi-value {
  text-align: center;
  margin-top: 12px;
  font-size: 14px;
  color: var(--text-secondary);
}

.rsi-value strong {
  font-size: 18px;
  color: var(--text);
}

.rsi-value.overbought strong { color: #ef4444; }
.rsi-value.oversold strong { color: #10b981; }
</style>
