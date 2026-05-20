<template>
  <div class="ai-health">
    <!-- ===== Header ===== -->
    <div class="ai-header">
      <div class="ai-header-left">
        <div class="ai-brand">
          <svg class="ai-brand-icon" viewBox="0 0 24 24" fill="none">
            <path d="M12 3L20 9V21H4V9L12 3Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
            <circle cx="12" cy="13" r="3" stroke="currentColor" stroke-width="1.5"/>
            <path d="M12 10V13L14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          <span class="ai-brand-text">AI 股票体检</span>
          <span class="ai-brand-badge">BETA</span>
        </div>
        <div class="ai-scan-status" :class="{ scanning: loading }">
          <span class="ai-scan-dot" :class="{ scanning: loading }"></span>
          {{ statusText }}
        </div>
      </div>
      <div class="ai-header-actions">
        <button v-if="!loading" class="ai-btn-analyze" @click="fetchAIAnalysis" :disabled="!stock">
          <svg class="ai-analyze-icon" viewBox="0 0 16 16" fill="none" width="14" height="14">
            <path d="M8 3V13M3 8H13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          {{ hasResult ? '重新体检' : '开始 AI 体检' }}
        </button>
        <div v-if="aiScore > 0" class="ai-score-block" :class="scoreLevelClass">
          <svg class="ai-score-ring" viewBox="0 0 72 72">
            <circle class="score-ring-bg" cx="36" cy="36" r="31" />
            <circle class="score-ring-fill" cx="36" cy="36" r="31"
              :style="ringStyle" />
          </svg>
          <div class="ai-score-value">{{ aiScore }}</div>
          <div class="ai-score-label">综合评分</div>
        </div>
      </div>
    </div>

    <!-- ===== Scanning Skeleton ===== -->
    <div v-if="loading" class="ai-scanning">
      <div class="ai-scanning-bar">
        <div class="ai-scanning-progress"></div>
      </div>
      <div class="ai-scanning-text">DeepSeek AI 正在解读市场数据...</div>
      <div class="ai-scanning-grid">
        <div v-for="i in 6" :key="i" class="ai-scan-card">
          <div class="scan-card-shimmer"></div>
        </div>
      </div>
    </div>

    <!-- ===== Risk Cards ===== -->
    <div v-if="!loading" class="ai-grid">
      <div
        v-for="d in dimensions"
        :key="d.key"
        class="ai-card"
        :class="[d.levelClass, { 'ai-card-expanded': d.expanded }]"
        @click="toggleCard(d)"
      >
        <div class="ai-card-top">
          <div class="ai-card-icon-row">
            <span class="ai-card-icon">{{ d.icon }}</span>
            <span class="ai-card-badge" :class="d.levelClass">{{ d.levelLabel }}</span>
          </div>
          <div class="ai-card-score">{{ d.score }}/100</div>
        </div>
        <div class="ai-card-title">{{ d.label || '-' }}</div>
        <div class="ai-card-brief">{{ d.brief || '暂无数据' }}</div>

        <transition name="slide">
          <div v-if="d.expanded" class="ai-card-detail">
            <div class="ai-card-divider"></div>
            <div class="ai-card-section">
              <div class="ai-card-section-label">AI 分析</div>
              <div class="ai-card-text">{{ d.analysis || '暂无分析数据' }}</div>
            </div>
            <div v-if="d.suggestion" class="ai-card-section">
              <div class="ai-card-section-label">AI 建议</div>
              <div class="ai-card-text ai-card-suggest">{{ d.suggestion || '暂无建议' }}</div>
            </div>
            <div v-if="d.reason" class="ai-card-section">
              <div class="ai-card-section-label">风险来源</div>
              <div class="ai-card-text ai-card-source">{{ d.reason || '暂无数据依据' }}</div>
            </div>
          </div>
        </transition>

        <div class="ai-card-toggle">
          <span>{{ d.expanded ? '收起分析' : '查看 AI 分析' }}</span>
          <svg :class="{ expanded: d.expanded }" class="ai-chevron" viewBox="0 0 16 16" fill="none">
            <path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </div>

        <div v-if="!d.expanded" class="ai-card-fade"></div>
      </div>
    </div>

    <!-- ===== Radar Chart ===== -->
    <div v-if="!loading" class="ai-radar-wrap">
      <div class="ai-radar-title">风险维度全景</div>
      <div class="ai-radar-outer">
        <canvas ref="radarCanvas" class="ai-radar-canvas"></canvas>
      </div>
    </div>

    <!-- ===== AI Conclusion ===== -->
    <div v-if="!loading" class="ai-conclusion" :class="conclusion.levelClass">
      <div class="ai-conclusion-icon">{{ conclusion.icon }}</div>
      <div class="ai-conclusion-body">
        <div class="ai-conclusion-title">{{ conclusion.title || '分析中' }}</div>
        <div class="ai-conclusion-desc">{{ conclusion.desc || '' }}</div>
        <div v-if="conclusion.tags && conclusion.tags.length" class="ai-conclusion-tags">
          <span v-for="tag in conclusion.tags" :key="tag" class="ai-tag">{{ tag }}</span>
        </div>
      </div>
    </div>

    <!-- ===== AI Advice ===== -->
    <div v-if="!loading" class="ai-advice">
      <div class="ai-advice-header">
        <svg class="ai-advice-icon" viewBox="0 0 20 20" fill="none">
          <path d="M10 18C14.4183 18 18 14.4183 18 10C18 5.58172 14.4183 2 10 2C5.58172 2 2 5.58172 2 10C2 14.4183 5.58172 2 10 2Z" stroke="currentColor" stroke-width="1.5"/>
          <path d="M10 14V10M10 6H10.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <span>AI 投资建议</span>
      </div>
      <div class="ai-advice-body">{{ advice.text || '暂无建议' }}</div>
      <div class="ai-advice-footer">
        <div class="ai-advice-meta">
          <span class="ai-meta-dot"></span>
          AI 可信度 {{ advice.confidence }}%
        </div>
        <div class="ai-advice-meta">
          <span class="ai-meta-dot"></span>
          数据来源: DeepSeek AI + 实时行情
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import axios from 'axios'

const api = axios.create({ baseURL: '/api', timeout: 30000 })

// ─── Local Fallback Analysis ──────────────────────────────
function riskLabel(level) {
  switch (level) {
    case 'high': return '高风险'
    case 'warn': return '需关注'
    case 'low': return '健康'
    default: return '未知'
  }
}

function fallbackAnalysis(stock) {
  if (!stock) return { dimensions: [], aiScore: 50 }
  const p = stock
  const rangePct = p.previousClose > 0 ? (((p.high||0) - (p.low||0)) / p.previousClose * 100) : 0
  const absCp = Math.abs(p.changePercent || 0)
  const volRatio = (p.volume || 0) / 1000000

  function dim(key, icon, label, score, level, brief, analysis, suggestion, reason) {
    return { key, icon, label, score: Math.round(score), level, levelLabel: riskLabel(level), brief, analysis, suggestion, reason, expanded: false }
  }

  const dims = [
    dim('sentiment', '🔥', '市场情绪',
      absCp > 8 ? 85 : absCp > 4 ? 60 : 25,
      absCp > 8 ? 'high' : absCp > 4 ? 'warn' : 'low',
      absCp > 8 ? '市场情绪极端' : absCp > 4 ? '情绪波动较大' : '情绪平稳',
      `涨跌幅 ${(p.changePercent||0).toFixed(1)}%，${absCp > 8 ? '处于极端情绪区间，属于典型情绪驱动行情。' : absCp > 4 ? '市场情绪明显活跃，存在情绪化交易迹象。' : '价格行为温和，多空力量相对均衡。'}`,
      absCp > 4 ? '建议控制仓位，避免情绪化追涨杀跌' : '当前适合理性分析决策',
      `涨跌幅 ${(p.changePercent||0).toFixed(1)}% | 振幅 ${rangePct.toFixed(1)}%`),
    dim('trend', '📊', '趋势结构',
      p.changePercent < -3 ? 75 : p.changePercent > 5 ? 45 : 20,
      p.changePercent < -3 ? 'high' : p.changePercent > 5 ? 'warn' : 'low',
      p.changePercent < -3 ? '下行趋势明显' : p.changePercent > 5 ? '短期涨幅较大' : '趋势健康',
      p.changePercent < -3 ? '价格呈现明显弱势特征，当前结构不利于做多。' : p.changePercent > 5 ? '短期涨幅较大，需警惕技术性回调。' : '价格运行平稳，趋势结构健康。',
      p.changePercent < -3 ? '等待止跌企稳后再考虑' : p.changePercent > 5 ? '等待回调至关键均线附近' : '适合结合其他维度综合判断',
      `涨跌幅 ${(p.changePercent||0).toFixed(1)}%`),
    dim('liquidity', '💧', '流动性',
      volRatio < 1 ? 75 : volRatio < 5 ? 35 : 15,
      volRatio < 1 ? 'high' : volRatio < 5 ? 'warn' : 'low',
      volRatio < 1 ? '流动性不足' : volRatio < 5 ? '流动性中等' : '流动性良好',
      `成交量 ${((p.volume||0)/10000).toFixed(0)} 万手，${volRatio < 1 ? '流动性偏低，大额交易冲击成本高。' : volRatio < 5 ? '流动性中等，正常交易可满足。' : '流动性充裕，交易环境优良。'}`,
      volRatio < 1 ? '大额资金需分批建仓' : '正常仓位操作即可',
      `成交量 ${((p.volume||0)/10000).toFixed(0)} 万手`),
    dim('volatility', '🌊', '波动性',
      rangePct > 6 ? 85 : rangePct > 3 ? 55 : 20,
      rangePct > 6 ? 'high' : rangePct > 3 ? 'warn' : 'low',
      rangePct > 6 ? '波动剧烈' : rangePct > 3 ? '波动偏大' : '波动适中',
      `日内振幅 ${rangePct.toFixed(1)}%，${rangePct > 6 ? '波动性极端，交易风险显著增加。' : rangePct > 3 ? '波动性偏高，短线交易难度较大。' : '波动性在合理范围内。'}`,
      rangePct > 3 ? '建议缩小仓位，放宽止损' : '波动环境友好',
      `振幅 ${rangePct.toFixed(1)}%`),
    dim('capital', '💰', '资金博弈',
      absCp > 7 ? 80 : 25,
      absCp > 7 ? 'high' : 'low',
      absCp > 7 ? '资金博弈激烈' : '资金流向平稳',
      absCp > 7 ? '资金博弈特征明显，可能存在主力资金异动。' : '资金流向平稳，未发现异常资金活动。',
      absCp > 7 ? '关注资金持续性，不宜重仓追涨' : '资金面正常',
      `涨跌幅 ${(p.changePercent||0).toFixed(1)}%`),
    dim('valuation', '⚖️', '估值安全',
      p.changePercent > 9 ? 70 : p.changePercent > 5 ? 45 : p.changePercent < -7 ? 60 : 15,
      p.changePercent > 9 || p.changePercent < -7 ? 'high' : p.changePercent > 5 ? 'warn' : 'low',
      p.changePercent > 9 ? '估值透支' : p.changePercent < -7 ? '估值重估' : p.changePercent > 5 ? '上涨偏快' : '估值合理',
      p.changePercent > 9 ? '短期涨幅接近涨停，估值存在透支风险。' : p.changePercent < -7 ? '短期大幅下跌，市场正在重新定价。' : p.changePercent > 5 ? '短期上涨较快，需时间消化。' : '估值在合理范围内。',
      p.changePercent > 9 ? '不适合追高' : p.changePercent < -7 ? '查明原因后再决策' : '估值层面安全',
      `涨跌幅 ${(p.changePercent||0).toFixed(1)}%`),
  ]

  const avgScore = dims.reduce((s, d) => s + d.score, 0) / dims.length
  const aiScore = Math.round(100 - avgScore / 100 * 80)
  const highCount = dims.filter(d => d.level === 'high').length
  const warnCount = dims.filter(d => d.level === 'warn').length

  let conclusionTitle, conclusionDesc, conclusionTags, cLevel
  if (aiScore >= 80 && highCount === 0) {
    conclusionTitle = '健康状况良好'
    conclusionDesc = `综合评估 ${dims.length} 个维度，整体风险可控。`
    conclusionTags = ['低风险', '适合关注']
    cLevel = 'green'
  } else if (aiScore >= 60) {
    conclusionTitle = '关注观察区'
    conclusionDesc = `${warnCount} 个维度需关注，${highCount} 个存在风险。`
    conclusionTags = ['中等风险', '持续关注']
    cLevel = 'blue'
  } else if (aiScore >= 40) {
    conclusionTitle = '⚠ 风险预警区'
    conclusionDesc = `${highCount} 个维度高风险，风险收益比不佳。`
    conclusionTags = ['较高风险', '等待时机']
    cLevel = 'yellow'
  } else {
    conclusionTitle = '🚨 高风险警报'
    conclusionDesc = `${highCount} 个维度高风险，不具备理想投资条件。`
    conclusionTags = ['高风险', '建议规避']
    cLevel = 'red'
  }

  return {
    dimensions: dims,
    aiScore,
    conclusion: { title: conclusionTitle, desc: conclusionDesc, tags: conclusionTags, levelClass: `conclusion-${cLevel}`, icon: cLevel === 'green' ? '🟢' : cLevel === 'blue' ? '🔵' : cLevel === 'yellow' ? '🟡' : '🔴' },
    advice: { text: '基于本地规则的分析结果，建议结合更多数据源综合判断。', confidence: 60 },
    fromCache: true,
  }
}

// ─── Icon Map ──────────────────────────────────────────────
const ICONS = {
  sentiment: '🔥', trend: '📊', liquidity: '💧',
  volatility: '🌊', capital: '💰', valuation: '⚖️',
}

const LABELS = {
  sentiment: '市场情绪', trend: '趋势结构', liquidity: '流动性',
  volatility: '波动性', capital: '资金博弈', valuation: '估值安全',
}

export default {
  name: 'AIHealthCheck',
  props: {
    stock: { type: Object, default: null },
  },
  setup(props) {
    const dimensions = ref([])
    const radarCanvas = ref(null)
    const loading = ref(false)
    const error = ref(false)
    const aiResult = ref(null)
    const hasResult = ref(false)

    const statusText = computed(() => {
      if (loading.value) return 'DeepSeek AI 正在深度分析...'
      if (error.value) return 'AI 引擎暂不可用，使用本地分析'
      if (dimensions.value.length > 0) return 'AI 已完成深度分析'
      return '等待股票数据...'
    })

    const aiScore = computed(() => aiResult.value?.aiScore ?? 0)

    const scoreLevelClass = computed(() => {
      const s = aiScore.value
      if (s >= 80) return 'score-green'
      if (s >= 60) return 'score-blue'
      if (s >= 40) return 'score-yellow'
      return 'score-red'
    })

    const ringStyle = computed(() => {
      const pct = Math.min(aiScore.value, 100)
      const circum = 2 * Math.PI * 31
      const offset = circum - (pct / 100) * circum
      return { strokeDasharray: `${circum}`, strokeDashoffset: `${offset}` }
    })

    const conclusion = computed(() => {
      if (aiResult.value?.conclusion) return aiResult.value.conclusion
      return { levelClass: 'conclusion-blue', icon: '🔵', title: '分析中', desc: '等待 AI 分析结果...', tags: [] }
    })

    const advice = computed(() => {
      if (aiResult.value?.advice) return aiResult.value.advice
      return { text: '分析进行中...', confidence: 0 }
    })

    function drawRadar() {
      const canvas = radarCanvas.value
      if (!canvas || dimensions.value.length === 0) return
      const ctx = canvas.getContext('2d')
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.parentElement.getBoundingClientRect()
      const size = Math.min(rect.width, 340)
      canvas.width = size * dpr
      canvas.height = size * dpr
      canvas.style.width = size + 'px'
      canvas.style.height = size + 'px'
      ctx.scale(dpr, dpr)

      const cx = size / 2, cy = size / 2, r = size * 0.38
      const n = dimensions.value.length
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
      const colors = {
        grid: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
        fill: 'rgba(56, 189, 248, 0.15)', stroke: '#38bdf8',
        text: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)', dot: '#38bdf8',
      }
      ctx.clearRect(0, 0, size, size)

      for (let ring = 1; ring <= 4; ring++) {
        const rr = (r / 4) * ring
        ctx.beginPath()
        for (let i = 0; i <= n; i++) {
          const a = (Math.PI * 2 * i) / n - Math.PI / 2
          i === 0 ? ctx.moveTo(cx + rr * Math.cos(a), cy + rr * Math.sin(a)) : ctx.lineTo(cx + rr * Math.cos(a), cy + rr * Math.sin(a))
        }
        ctx.closePath()
        ctx.strokeStyle = colors.grid; ctx.lineWidth = 1; ctx.stroke()
      }
      for (let i = 0; i < n; i++) {
        const a = (Math.PI * 2 * i) / n - Math.PI / 2
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a))
        ctx.strokeStyle = colors.grid; ctx.lineWidth = 1; ctx.stroke()
      }

      const scores = dimensions.value.map(d => d.score)
      ctx.beginPath()
      for (let i = 0; i <= n; i++) {
        const idx = i % n, a = (Math.PI * 2 * idx) / n - Math.PI / 2
        const v = scores[idx] / 100, x = cx + r * v * Math.cos(a), y = cy + r * v * Math.sin(a)
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      }
      ctx.closePath()
      ctx.fillStyle = colors.fill; ctx.fill()
      ctx.strokeStyle = colors.stroke; ctx.lineWidth = 2; ctx.stroke()

      for (let i = 0; i < n; i++) {
        const a = (Math.PI * 2 * i) / n - Math.PI / 2
        const v = scores[i] / 100, x = cx + r * v * Math.cos(a), y = cy + r * v * Math.sin(a)
        ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fillStyle = colors.dot; ctx.fill()
      }

      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif'
      ctx.fillStyle = colors.text
      for (let i = 0; i < n; i++) {
        const a = (Math.PI * 2 * i) / n - Math.PI / 2
        ctx.fillText(dimensions.value[i].label, cx + r * 1.22 * Math.cos(a), cy + r * 1.22 * Math.sin(a))
      }

      ctx.font = 'bold 22px -apple-system, BlinkMacSystemFont, sans-serif'
      ctx.fillStyle = isDark ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.8)'
      ctx.fillText(aiScore.value, cx, cy - 6)
      ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif'
      ctx.fillStyle = colors.text; ctx.fillText('综合评分', cx, cy + 16)
    }

    function toggleCard(d) {
      d.expanded = !d.expanded
      nextTick(() => drawRadar())
    }

    async function fetchAIAnalysis() {
      const stock = props.stock
      if (!stock || !stock.symbol) return

      loading.value = true
      error.value = false
      aiResult.value = null

      try {
        const resp = await api.post('/ai/health-check', stock)
        if (resp.data?.success && resp.data?.data) {
          const d = resp.data.data
          const dims = (d.dimensions || []).map(x => ({
            ...x,
            label: LABELS[x.key] || x.key,
            icon: ICONS[x.key] || '📌',
            levelLabel: riskLabel(x.level),
            expanded: false,
          }))
          const c = d.conclusion || {}
          const levelClass =
            dims.filter(x => x.level === 'high').length === 0 && (d.aiScore || 0) >= 80 ? 'conclusion-green'
            : (d.aiScore || 0) >= 60 ? 'conclusion-blue'
            : (d.aiScore || 0) >= 40 ? 'conclusion-yellow'
            : 'conclusion-red'
          const icon = levelClass === 'conclusion-green' ? '🟢' : levelClass === 'conclusion-blue' ? '🔵' : levelClass === 'conclusion-yellow' ? '🟡' : '🔴'

          dimensions.value = dims
          hasResult.value = true
          aiResult.value = {
            aiScore: d.aiScore || 50,
            conclusion: {
              title: c.title || '分析完成',
              desc: c.desc || '',
              tags: c.tags || [],
              levelClass,
              icon,
            },
            advice: {
              text: d.advice || '暂无建议',
              confidence: d.confidence || 70,
            },
          }
        } else {
          throw new Error(resp.data?.error || 'AI 返回异常')
        }
      } catch (e) {
        console.log('AI 分析失败，使用本地规则:', e.message)
        error.value = true
        const fallback = fallbackAnalysis(stock)
        dimensions.value = fallback.dimensions
        hasResult.value = true
        aiResult.value = {
          aiScore: fallback.aiScore,
          conclusion: fallback.conclusion,
          advice: fallback.advice,
        }
      } finally {
        loading.value = false
        nextTick(() => drawRadar())
      }
    }

    watch(() => props.stock, () => {
      // Reset when stock changes, but don't auto-analyze
      dimensions.value = []
      aiResult.value = null
      hasResult.value = false
      error.value = false
    })

    let resizeObserver
    onMounted(() => {
      resizeObserver = new ResizeObserver(() => drawRadar())
      if (radarCanvas.value?.parentElement) {
        resizeObserver.observe(radarCanvas.value.parentElement)
      }
    })

    return {
      dimensions, radarCanvas, loading, error, statusText,
      aiScore, scoreLevelClass, ringStyle, conclusion, advice,
      toggleCard, fetchAIAnalysis, hasResult,
    }
  },
}
</script>

<style scoped>
/* ─── Container ─────────────────────────────────────────────── */
.ai-health {
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', sans-serif;
  color: var(--text, #1d1d1f);
  position: relative;
}

/* ─── Header ────────────────────────────────────────────────── */
.ai-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 20px;
  gap: 16px;
}

.ai-brand {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ai-brand-icon {
  width: 24px;
  height: 24px;
  color: #38bdf8;
}

.ai-brand-text {
  font-size: 16px;
  font-weight: 700;
  background: linear-gradient(135deg, #38bdf8, #818cf8);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.ai-brand-badge {
  font-size: 9px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 4px;
  background: linear-gradient(135deg, #38bdf8, #818cf8);
  color: #fff;
  letter-spacing: 0.5px;
}

.ai-scan-status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-secondary, #86868b);
  margin-top: 4px;
  transition: color 0.3s;
}

.ai-scan-status.scanning {
  color: #38bdf8;
}

.ai-scan-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #22c55e;
  animation: pulse-dot 2s ease-in-out infinite;
}

.ai-scan-dot.scanning {
  background: #38bdf8;
  animation: pulse-scan 1s ease-in-out infinite;
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

@keyframes pulse-scan {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(1.4); }
}

/* ─── Scanning Skeleton ────────────────────────────────────── */
.ai-scanning {
  margin-bottom: 16px;
}

.ai-scanning-bar {
  height: 3px;
  background: var(--border, #e5e7eb);
  border-radius: 2px;
  margin-bottom: 8px;
  overflow: hidden;
}

.ai-scanning-progress {
  height: 100%;
  width: 30%;
  background: linear-gradient(90deg, #38bdf8, #818cf8);
  border-radius: 2px;
  animation: scan-progress 1.5s ease-in-out infinite;
}

@keyframes scan-progress {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(400%); }
}

.ai-scanning-text {
  font-size: 11px;
  color: var(--text-secondary, #86868b);
  margin-bottom: 12px;
}

.ai-scanning-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

@media (max-width: 640px) {
  .ai-scanning-grid {
    grid-template-columns: 1fr;
  }
}

.ai-scan-card {
  height: 90px;
  border-radius: 14px;
  background: var(--card-bg, #ffffff);
  border: 1px solid var(--border, #e5e7eb);
  overflow: hidden;
  position: relative;
}

.scan-card-shimmer {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(56, 189, 248, 0.04) 50%,
    transparent 100%
  );
  animation: shimmer 2s ease-in-out infinite;
}

@keyframes shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}

/* ─── Score Ring ───────────────────────────────────────────── */
.ai-score-block {
  position: relative;
  flex-shrink: 0;
  width: 72px;
  height: 72px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.ai-header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.ai-btn-analyze {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border: none;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  background: linear-gradient(135deg, #38bdf8, #818cf8);
  color: #fff;
  transition: all 0.2s;
  white-space: nowrap;
}

.ai-btn-analyze:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 16px rgba(56, 189, 248, 0.3);
}

.ai-btn-analyze:active {
  transform: translateY(0);
}

.ai-btn-analyze:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.ai-analyze-icon {
  flex-shrink: 0;
}

.ai-score-ring {
  position: absolute;
  top: 0;
  left: 0;
  width: 72px;
  height: 72px;
  transform: rotate(-90deg);
}

.score-ring-bg {
  fill: none;
  stroke: var(--border, #e5e7eb);
  stroke-width: 3;
}

.score-ring-fill {
  fill: none;
  stroke-width: 3;
  stroke-linecap: round;
  transition: stroke-dashoffset 0.8s ease, stroke 0.3s;
}

.score-green .score-ring-fill { stroke: #22c55e; }
.score-blue .score-ring-fill { stroke: #3b82f6; }
.score-yellow .score-ring-fill { stroke: #f59e0b; }
.score-red .score-ring-fill { stroke: #ef4444; }

.ai-score-value {
  font-size: 20px;
  font-weight: 800;
  z-index: 1;
  line-height: 1;
}

.score-green .ai-score-value { color: #22c55e; }
.score-blue .ai-score-value { color: #3b82f6; }
.score-yellow .ai-score-value { color: #f59e0b; }
.score-red .ai-score-value { color: #ef4444; }

.ai-score-label {
  font-size: 8px;
  color: var(--text-secondary, #86868b);
  z-index: 1;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}

/* ─── Risk Grid ────────────────────────────────────────────── */
.ai-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 16px;
}

@media (max-width: 640px) {
  .ai-grid {
    grid-template-columns: 1fr;
  }
}

/* ─── Card ─────────────────────────────────────────────────── */
.ai-card {
  position: relative;
  padding: 16px;
  border-radius: 14px;
  cursor: pointer;
  overflow: hidden;
  transition: all 0.25s ease;
  border: 1px solid var(--border, #e5e7eb);
  background: var(--card-bg, #ffffff);
}

.ai-card::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 14px;
  opacity: 0;
  transition: opacity 0.25s;
}

.ai-card:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 20px rgba(0,0,0,0.06);
}

[data-theme='dark'] .ai-card:hover {
  box-shadow: 0 4px 24px rgba(0,0,0,0.3);
}

.ai-card.high { border-left: 3px solid #ef4444; }
.ai-card.warn { border-left: 3px solid #f59e0b; }
.ai-card.low { border-left: 3px solid #22c55e; }

.ai-card.high .ai-card-badge.high { background: rgba(239,68,68,0.12); color: #ef4444; }
.ai-card.warn .ai-card-badge.warn { background: rgba(245,158,11,0.12); color: #f59e0b; }
.ai-card.low .ai-card-badge.low { background: rgba(34,197,94,0.12); color: #22c55e; }

.ai-card-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
  position: relative;
  z-index: 1;
}

.ai-card-icon-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ai-card-icon {
  font-size: 18px;
  line-height: 1;
}

.ai-card-badge {
  font-size: 9px;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: 20px;
  letter-spacing: 0.3px;
}

.ai-card-score {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-secondary, #86868b);
  font-variant-numeric: tabular-nums;
}

.ai-card.high .ai-card-score { color: #ef4444; }
.ai-card.warn .ai-card-score { color: #f59e0b; }
.ai-card.low .ai-card-score { color: #22c55e; }

.ai-card-title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 4px;
  position: relative;
  z-index: 1;
}

.ai-card-brief {
  font-size: 11px;
  color: var(--text-secondary, #86868b);
  line-height: 1.4;
  margin-bottom: 0;
  position: relative;
  z-index: 1;
}

/* ─── Card Expand ──────────────────────────────────────────── */
.ai-card-detail {
  margin-top: 10px;
  position: relative;
  z-index: 1;
}

.ai-card-divider {
  height: 1px;
  background: var(--border, #e5e7eb);
  margin-bottom: 10px;
}

.ai-card-section {
  margin-bottom: 8px;
}

.ai-card-section:last-child {
  margin-bottom: 0;
}

.ai-card-section-label {
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: var(--text-secondary, #86868b);
  margin-bottom: 4px;
}

.ai-card-text {
  font-size: 12px;
  line-height: 1.6;
  color: var(--text, #1d1d1f);
}

.ai-card-suggest {
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(56,189,248,0.06);
  border: 1px solid rgba(56,189,248,0.12);
}

.ai-card-source {
  font-size: 11px;
  color: var(--text-secondary, #86868b);
  font-family: 'SF Mono', 'Menlo', monospace;
}

.ai-card-fade {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 40px;
  background: linear-gradient(transparent, var(--card-bg, #fff));
  pointer-events: none;
  z-index: 2;
}

/* ─── Card Toggle ──────────────────────────────────────────── */
.ai-card-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: #38bdf8;
  margin-top: 8px;
  position: relative;
  z-index: 1;
  cursor: pointer;
  user-select: none;
}

.ai-chevron {
  width: 14px;
  height: 14px;
  transition: transform 0.2s;
}

.ai-chevron.expanded {
  transform: rotate(180deg);
}

/* ─── Slide Transition ─────────────────────────────────────── */
.slide-enter-active, .slide-leave-active {
  transition: all 0.25s ease;
  overflow: hidden;
}
.slide-enter-from, .slide-leave-to {
  opacity: 0;
  max-height: 0;
  margin-top: 0;
}
.slide-enter-to, .slide-leave-from {
  opacity: 1;
  max-height: 300px;
}

/* ─── Radar ────────────────────────────────────────────────── */
.ai-radar-wrap {
  margin-bottom: 16px;
}

.ai-radar-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary, #86868b);
  margin-bottom: 10px;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}

.ai-radar-outer {
  display: flex;
  justify-content: center;
  padding: 8px 0;
}

.ai-radar-canvas {
  display: block;
  max-width: 100%;
}

/* ─── Conclusion ───────────────────────────────────────────── */
.ai-conclusion {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px;
  border-radius: 14px;
  margin-bottom: 12px;
  border: 1px solid;
  transition: all 0.3s;
}

.ai-conclusion.conclusion-green {
  background: linear-gradient(135deg, rgba(34,197,94,0.06), rgba(34,197,94,0.02));
  border-color: rgba(34,197,94,0.2);
}
.ai-conclusion.conclusion-blue {
  background: linear-gradient(135deg, rgba(59,130,246,0.06), rgba(59,130,246,0.02));
  border-color: rgba(59,130,246,0.2);
}
.ai-conclusion.conclusion-yellow {
  background: linear-gradient(135deg, rgba(245,158,11,0.06), rgba(245,158,11,0.02));
  border-color: rgba(245,158,11,0.2);
}
.ai-conclusion.conclusion-red {
  background: linear-gradient(135deg, rgba(239,68,68,0.06), rgba(239,68,68,0.02));
  border-color: rgba(239,68,68,0.2);
}

.ai-conclusion-icon {
  font-size: 28px;
  line-height: 1;
  flex-shrink: 0;
}

.ai-conclusion-body {
  flex: 1;
  min-width: 0;
}

.ai-conclusion-title {
  font-size: 15px;
  font-weight: 700;
  margin-bottom: 4px;
}

.conclusion-green .ai-conclusion-title { color: #22c55e; }
.conclusion-blue .ai-conclusion-title { color: #3b82f6; }
.conclusion-yellow .ai-conclusion-title { color: #f59e0b; }
.conclusion-red .ai-conclusion-title { color: #ef4444; }

.ai-conclusion-desc {
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-secondary, #86868b);
}

.ai-conclusion-tags {
  display: flex;
  gap: 6px;
  margin-top: 8px;
  flex-wrap: wrap;
}

.ai-tag {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 20px;
  background: rgba(56,189,248,0.08);
  border: 1px solid rgba(56,189,248,0.15);
  color: var(--text-secondary, #86868b);
}

/* ─── Advice ───────────────────────────────────────────────── */
.ai-advice {
  padding: 16px;
  border-radius: 14px;
  background: var(--card-bg, #ffffff);
  border: 1px solid var(--border, #e5e7eb);
}

.ai-advice-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary, #86868b);
  margin-bottom: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.ai-advice-icon {
  width: 18px;
  height: 18px;
  color: #38bdf8;
}

.ai-advice-body {
  font-size: 13px;
  line-height: 1.7;
  color: var(--text, #1d1d1f);
}

.ai-advice-footer {
  display: flex;
  gap: 16px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--border, #e5e7eb);
}

.ai-advice-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: var(--text-secondary, #86868b);
}

.ai-meta-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #38bdf8;
}
</style>
