<template>
  <div>
    <div v-if="data.length === 0" style="text-align: center; color: var(--text-secondary); padding: 32px 0;">
      暂无历史数据
    </div>
    <div v-else class="chart-container">
      <svg :width="chartWidth" :height="chartHeight" style="display: block; margin: 0 auto;">
        <!-- Y-axis grid lines -->
        <g v-for="(ratio, idx) in [0, 0.25, 0.5, 0.75, 1]" :key="'grid-' + idx">
          <line
            :x1="pad.left"
            :y1="pad.top + ratio * (chartHeight - pad.top - pad.bottom)"
            :x2="chartWidth - pad.right"
            :y2="pad.top + ratio * (chartHeight - pad.top - pad.bottom)"
            stroke="var(--border)"
            stroke-dasharray="4,4"
          />
          <text
            :x="pad.left - 8"
            :y="pad.top + ratio * (chartHeight - pad.top - pad.bottom) + 4"
            text-anchor="end"
            fill="var(--text-secondary)"
            style="font-size: 10px;"
          >
            {{ (maxVal - ratio * range).toFixed(2) }}
          </text>
        </g>

        <!-- Area fill -->
        <path :d="areaPath" :fill="fillColor" />

        <!-- Line -->
        <path :d="linePath" fill="none" :stroke="lineColor" stroke-width="2" stroke-linejoin="round" />

        <!-- Data points + date labels -->
        <g v-for="(pt, i) in points" :key="'pt-' + i">
          <circle :cx="pt.x" :cy="pt.y" r="2.5" :fill="lineColor" />
          <circle :cx="pt.x" :cy="pt.y" r="5" :fill="lineColor" opacity="0.15" />
          <text
            v-if="showLabel(i)"
            :x="pt.x"
            :y="chartHeight - pad.bottom + 18"
            text-anchor="middle"
            fill="var(--text-secondary)"
            style="font-size: 9px;"
            :transform="`rotate(-30, ${pt.x}, ${chartHeight - pad.bottom + 18})`"
          >
            {{ data[i].date.slice(5) }}
          </text>
        </g>
      </svg>
    </div>
  </div>
</template>

<script>
import { computed } from 'vue'

export default {
  name: 'HistoryChart',
  props: {
    data: { type: Array, default: () => [] },
  },
  setup(props) {
    const pad = { top: 20, right: 20, bottom: 40, left: 60 }
    const chartHeight = 200

    const closes = computed(() => props.data.map(d => d.close))
    const minVal = computed(() => Math.min(...closes.value))
    const maxVal = computed(() => Math.max(...closes.value))
    const range = computed(() => maxVal.value - minVal.value || 1)

    const chartWidth = computed(() => Math.max(props.data.length * 10, 400))

    const isPositive = computed(() => {
      if (closes.value.length < 2) return true
      return closes.value[closes.value.length - 1] >= closes.value[0]
    })

    const lineColor = computed(() => isPositive.value ? '#16a34a' : '#dc2626')
    const fillColor = computed(() => isPositive.value ? 'rgba(22,163,74,0.08)' : 'rgba(220,38,38,0.08)')

    const points = computed(() => {
      return closes.value.map((val, i) => ({
        x: pad.left + (i / Math.max(closes.value.length - 1, 1)) * (chartWidth.value - pad.left - pad.right),
        y: pad.top + (1 - (val - minVal.value) / range.value) * (chartHeight - pad.top - pad.bottom),
      }))
    })

    const linePath = computed(() => {
      return points.value.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
    })

    const areaPath = computed(() => {
      if (points.value.length === 0) return ''
      const last = points.value[points.value.length - 1]
      const first = points.value[0]
      return `${linePath.value} L${last.x},${chartHeight - pad.bottom} L${first.x},${chartHeight - pad.bottom} Z`
    })

    function showLabel(i) {
      const len = props.data.length
      if (len <= 15) return true
      const step = Math.ceil(len / 8)
      return i % step === 0 || i === len - 1
    }

    return {
      pad,
      chartHeight,
      chartWidth,
      lineColor,
      fillColor,
      points,
      linePath,
      areaPath,
      showLabel,
    }
  },
}
</script>
