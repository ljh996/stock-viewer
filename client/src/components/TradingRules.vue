<template>
  <div class="rules-panel">
    <div class="rules-section" v-for="(section, idx) in sections" :key="idx">
      <div class="rules-section-title" @click="toggleSection(idx)">
        <span>{{ section.icon }} {{ section.title }}</span>
        <span class="rules-toggle">{{ expanded[idx] ? '▼' : '▶' }}</span>
      </div>
      <div v-show="expanded[idx]" class="rules-section-body">
        <div
          v-for="(rule, ri) in section.rules"
          :key="ri"
          class="rule-item"
          :class="{ 'rule-danger': rule.danger, 'rule-warn': rule.warn }"
        >
          <span class="rule-badge" v-if="rule.danger">🚫 严禁</span>
          <span class="rule-badge rule-badge-warn" v-else-if="rule.warn">⚠️ 警告</span>
          <span class="rule-badge rule-badge-tip" v-else>💡 规则</span>
          <span class="rule-text">{{ rule.text }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref } from 'vue'

export default {
  name: 'TradingRules',
  setup() {
    const expanded = ref([true, false, false])

    const sections = [
      {
        icon: '📊',
        title: '仓位管理',
        rules: [
          { text: '7个月必须空仓', warn: true },
          { text: '2个月必须轻仓或半仓', warn: true },
          { text: '2个月必须重仓（个股80%持仓量）', tip: true },
          { text: '1个月保持20%仓位短线，可做可不做（待定）' },
        ],
      },
      {
        icon: '🔄',
        title: '买卖纪律',
        rules: [
          { text: '一年买股票不得超过6只，同时操作不超过3只', danger: true },
          { text: '一个月买卖股票不超过3次', danger: true },
          { text: '重仓条件：大盘下跌20%左右 + 个股从高点跌50%以上的次新股 + 日均成交量≥3%', tip: true },
          { text: '横盘突然放量拉升20%后，回落到低点附近分批买入', tip: true },
          { text: '轻仓/半仓条件：行情走到50% + 个股从高点跌50% + 未涨20% + 日均成交量≥3%', tip: true },
          { text: '操作必须做到：快、狠、准、拿得住' },
          { text: '重仓股第一次日换手率30%左右，必须减仓70%以上', warn: true },
          { text: '第二次日换手率>30%，减仓40%', warn: true },
          { text: '第三次日换手率30%，减仓20%', warn: true },
          { text: '成交量减小、股价回落时，可重新买回', tip: true },
          { text: '当天卖股票，严禁当天又买入其它股票', danger: true },
        ],
      },
      {
        icon: '🛡️',
        title: '风控红线',
        rules: [
          { text: '短线严禁在股票反弹到波段顶部买股', danger: true },
          { text: '不断缩量阴跌创新低的个股，严禁买入', danger: true },
          { text: '爆炒过的个股，严禁买入', danger: true },
          { text: '基本面有问题的个股，严禁买入', danger: true },
          { text: '长期缩量横盘、波动不大的个股，严禁买入', danger: true },
          { text: '趋势明显下跌时，必须空仓或仓位10%以内', danger: true },
          { text: '严禁抱有"股票抗跌、庄家没走护盘"的心态', danger: true },
          { text: '没有行情，严禁勉强交易，搞乱心态', danger: true },
          { text: '风险是涨出来的，机会是跌出来的' },
          { text: '截断亏损，让利润奔跑 💪' },
        ],
      },
    ]

    function toggleSection(idx) {
      expanded.value[idx] = !expanded.value[idx]
    }

    return { sections, expanded, toggleSection }
  },
}
</script>

<style scoped>
.rules-panel {
  font-size: 13px;
}
.rules-section {
  margin-bottom: 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}
.rules-section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: var(--bg);
  font-weight: 600;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s;
}
.rules-section-title:hover {
  background: var(--primary-light, #e8f0fe);
}
.rules-toggle {
  font-size: 11px;
  color: var(--text-secondary);
}
.rules-section-body {
  padding: 8px 12px;
}
.rule-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid var(--border);
}
.rule-item:last-child {
  border-bottom: none;
}
.rule-danger {
  background: rgba(220, 38, 38, 0.04);
  margin: 0 -12px;
  padding: 6px 12px;
  border-radius: 4px;
}
.rule-badge {
  font-size: 11px;
  white-space: nowrap;
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--primary-light, #dbeafe);
  color: var(--primary, #2563eb);
}
.rule-badge-warn {
  background: #fef3c7;
  color: #d97706;
}
.rule-badge-tip {
  background: #dcfce7;
  color: #16a34a;
}
.rule-text {
  line-height: 1.5;
  color: var(--text);
}
.rule-danger .rule-text {
  color: var(--red, #dc2626);
  font-weight: 500;
}
</style>
