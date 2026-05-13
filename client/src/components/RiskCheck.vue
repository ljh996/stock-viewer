<template>
  <div class="risk-check">
    <div class="rc-title">🛡️ 选股风控检查</div>
    <div class="rc-desc">查看股票时，逐项检查以下红线，全部通过方可买入</div>

    <div class="rc-checks">
      <div
        v-for="(check, i) in checks"
        :key="i"
        class="rc-check"
        :class="{ 'rc-check-fail': check.value === false, 'rc-check-pass': check.value === true }"
      >
        <div class="rc-check-header">
          <span class="rc-check-icon">{{ check.value === false ? '🚫' : check.value === true ? '✅' : '⬜' }}</span>
          <span class="rc-check-label">{{ check.label }}</span>
        </div>
        <div class="rc-check-desc">{{ check.desc }}</div>
        <div class="rc-check-toggle">
          <label class="rc-switch">
            <input type="checkbox" v-model="check.value" />
            <span class="rc-switch-slider"></span>
          </label>
          <span class="rc-switch-text">{{ check.value === true ? '已通过' : check.value === false ? '未通过' : '待检查' }}</span>
        </div>
      </div>
    </div>

    <!-- 总结 -->
    <div class="rc-result" :class="resultClass">
      <template v-if="failCount === 0 && passCount > 0">
        ✅ 全部检查通过，可以考虑买入
      </template>
      <template v-else-if="failCount > 0">
        🚫 {{ failCount }} 项未通过，{{ failCount >= 2 ? '强烈建议放弃' : '需谨慎考虑' }}
      </template>
      <template v-else>
        ⬜ 请逐项检查后再做决定
      </template>
    </div>
  </div>
</template>

<script>
import { ref, computed } from 'vue'

export default {
  name: 'RiskCheck',
  setup() {
    const checks = ref([
      {
        label: '缩量阴跌创新低',
        desc: '不断缩量阴跌并创新低的个股，严禁买入',
        value: null,
      },
      {
        label: '爆炒过',
        desc: '前期已被爆炒过的个股，严禁买入',
        value: null,
      },
      {
        label: '基本面问题',
        desc: '财务造假、ST、退市风险等基本面有问题的个股，严禁买入',
        value: null,
      },
      {
        label: '长期缩量横盘',
        desc: '长期缩量横盘、波动不大的个股，严禁买入',
        value: null,
      },
      {
        label: '趋势明显下跌',
        desc: '市场和个股趋势明显下跌时，必须空仓或仓位10%以内',
        value: null,
      },
      {
        label: '反弹到波段顶部',
        desc: '短线操作严禁在股票反弹到波段顶部时买入',
        value: null,
      },
      {
        label: '日均成交量≥3%',
        desc: '次新股每天平均成交量不低于3%（仅次新股适用）',
        value: null,
      },
      {
        label: '从高点下跌≥50%',
        desc: '股票从最高点必须下跌50%以上方可考虑买入',
        value: null,
      },
    ])

    const passCount = computed(() => checks.value.filter(c => c.value === true).length)
    const failCount = computed(() => checks.value.filter(c => c.value === false).length)

    const resultClass = computed(() => {
      if (failCount.value === 0 && passCount.value > 0) return 'rc-result-pass'
      if (failCount.value > 0) return 'rc-result-fail'
      return 'rc-result-pending'
    })

    return { checks, passCount, failCount, resultClass }
  },
}
</script>

<style scoped>
.risk-check { font-size: 13px; }
.rc-title { font-weight: 600; font-size: 14px; margin-bottom: 4px; }
.rc-desc { font-size: 12px; color: var(--text-secondary); margin-bottom: 12px; }
.rc-checks { margin-bottom: 12px; }
.rc-check {
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  margin-bottom: 6px;
  transition: all 0.15s;
}
.rc-check-pass { border-color: #86efac; background: #f0fdf4; }
.rc-check-fail { border-color: #fca5a5; background: #fef2f2; }
.rc-check-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
.rc-check-icon { font-size: 14px; }
.rc-check-label { font-weight: 600; font-size: 13px; }
.rc-check-desc { font-size: 11px; color: var(--text-secondary); margin-bottom: 6px; padding-left: 22px; }
.rc-check-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-left: 22px;
}
.rc-switch {
  position: relative;
  display: inline-block;
  width: 36px;
  height: 20px;
}
.rc-switch input { opacity: 0; width: 0; height: 0; }
.rc-switch-slider {
  position: absolute;
  cursor: pointer;
  top: 0; left: 0; right: 0; bottom: 0;
  background: #d1d5db;
  border-radius: 20px;
  transition: 0.2s;
}
.rc-switch-slider::before {
  content: '';
  position: absolute;
  width: 16px; height: 16px;
  left: 2px; bottom: 2px;
  background: white;
  border-radius: 50%;
  transition: 0.2s;
}
.rc-switch input:checked + .rc-switch-slider { background: #16a34a; }
.rc-switch input:checked + .rc-switch-slider::before { transform: translateX(16px); }
.rc-switch-text { font-size: 11px; color: var(--text-secondary); }
.rc-result {
  padding: 12px;
  border-radius: 8px;
  font-weight: 600;
  text-align: center;
  font-size: 14px;
}
.rc-result-pass { background: #f0fdf4; color: #16a34a; border: 1px solid #bbf7d0; }
.rc-result-fail { background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; }
.rc-result-pending { background: #f8f9fa; color: var(--text-secondary); border: 1px solid var(--border); }
</style>
