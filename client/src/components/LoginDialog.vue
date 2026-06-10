<template>
  <!-- 登录/注册弹窗 — Apple 风格 glassmorphism -->
  <Teleport to="body">
    <div v-if="visible" class="login-overlay" @click.self="$emit('close')">
      <div class="login-dialog" :class="{ dark: isDark }">
        <button class="login-close" @click="$emit('close')" aria-label="关闭">✕</button>

        <!-- Logo / 标题 -->
        <div class="login-header">
          <div class="login-icon">📊</div>
          <h2>{{ isRegister ? '创建账户' : '登录' }}</h2>
          <p class="login-subtitle">{{ isRegister ? '注册后可同步数据到云端' : '登录后可跨设备同步' }}</p>
        </div>

        <!-- 表单 -->
        <form class="login-form" @submit.prevent="handleSubmit">
          <div class="form-field">
            <label for="username">用户名</label>
            <input
              id="username"
              v-model="username"
              type="text"
              placeholder="输入用户名"
              autocomplete="username"
              maxlength="30"
              required
            />
          </div>

          <div class="form-field">
            <label for="password">密码</label>
            <input
              id="password"
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              placeholder="至少 6 位密码"
              autocomplete="current-password"
              minlength="6"
              required
            />
            <button type="button" class="toggle-pw" @click="showPassword = !showPassword">
              {{ showPassword ? '👁' : '👁‍🗨' }}
            </button>
          </div>

          <!-- 错误信息 -->
          <div v-if="error" class="form-error">{{ error }}</div>

          <!-- 提交按钮 -->
          <button type="submit" class="login-btn" :disabled="loading">
            <span v-if="loading" class="spinner"></span>
            <span v-else>{{ isRegister ? '注册' : '登录' }}</span>
          </button>

          <!-- 切换登录/注册 -->
          <p class="login-switch" @click="toggleMode">
            {{ isRegister ? '已有账户？去登录' : '没有账户？去注册' }}
          </p>

          <!-- 游客模式 -->
          <p class="guest-mode" @click="$emit('close')">
            先随便看看 →
          </p>
        </form>
      </div>
    </div>
  </Teleport>
</template>

<script>
import { ref, inject } from 'vue'

export default {
  name: 'LoginDialog',
  props: {
    visible: { type: Boolean, default: false },
  },
  emits: ['close', 'login-success'],
  setup(props, { emit }) {
    const isDark = inject('theme', ref(false))
    const isRegister = ref(false)
    const username = ref('')
    const password = ref('')
    const showPassword = ref(false)
    const loading = ref(false)
    const error = ref('')

    function toggleMode() {
      isRegister.value = !isRegister.value
      error.value = ''
    }

    async function handleSubmit() {
      const u = username.value.trim()
      const p = password.value.trim()

      if (!u || u.length < 2) { error.value = '用户名至少 2 个字符'; return }
      if (!p || p.length < 6) { error.value = '密码至少 6 个字符'; return }

      loading.value = true
      error.value = ''

      try {
        const endpoint = isRegister.value ? '/api/auth/register' : '/api/auth/login'
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: u, password: p }),
        })
        const json = await res.json()

        if (!json.success) {
          error.value = json.error || '操作失败'
          return
        }

        // 保存 token 到 localStorage
        localStorage.setItem('jwt-token', json.data.token)

        // 设置全局 API header
        if (window.__axiosInstance) {
          window.__axiosInstance.defaults.headers['Authorization'] = `Bearer ${json.data.token}`
          window.__axiosInstance.defaults.headers['x-api-token'] = localStorage.getItem('api-token') || 'stock-viewer-default-token'
        }

        emit('login-success', json.data.user)
        emit('close')
      } catch (e) {
        error.value = '网络错误，请稍后重试'
      } finally {
        loading.value = false
      }
    }

    return { isDark, isRegister, username, password, showPassword, loading, error, toggleMode, handleSubmit }
  },
}
</script>

<style scoped>
.login-overlay {
  position: fixed; inset: 0; z-index: 9999;
  background: rgba(0,0,0,0.45);
  backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center;
  padding: 20px;
}

.login-dialog {
  position: relative;
  background: rgba(255,255,255,0.85);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-radius: 20px;
  padding: 36px 32px 28px;
  width: 380px; max-width: 100%;
  box-shadow: 0 24px 80px rgba(0,0,0,0.15), 0 0 0 1px rgba(255,255,255,0.5);
  border: 1px solid rgba(255,255,255,0.3);
  animation: dialogIn 0.3s ease;
}
.login-dialog.dark {
  background: rgba(30,30,34,0.88);
  border-color: rgba(255,255,255,0.08);
  box-shadow: 0 24px 80px rgba(0,0,0,0.5);
}

@keyframes dialogIn {
  from { opacity: 0; transform: scale(0.95) translateY(10px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}

.login-close {
  position: absolute; top: 14px; right: 16px;
  background: none; border: none; font-size: 18px; cursor: pointer;
  color: #999; width: 32px; height: 32px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.2s;
}
.login-close:hover { background: rgba(0,0,0,0.06); color: #333; }
.dark .login-close:hover { background: rgba(255,255,255,0.1); color: #ccc; }

.login-header { text-align: center; margin-bottom: 24px; }
.login-icon { font-size: 40px; margin-bottom: 8px; }
.login-header h2 { margin: 0; font-size: 22px; font-weight: 600; color: #1d1d1f; }
.dark .login-header h2 { color: #f5f5f7; }
.login-subtitle { margin: 6px 0 0; font-size: 13px; color: #86868b; }

.form-field {
  position: relative; margin-bottom: 16px;
}
.form-field label {
  display: block; font-size: 12px; font-weight: 500; color: #666;
  margin-bottom: 4px; letter-spacing: 0.3px;
}
.dark .form-field label { color: #a1a1a6; }
.form-field input {
  width: 100%; padding: 10px 36px 10px 14px; box-sizing: border-box;
  border: 1.5px solid #d2d2d7; border-radius: 10px;
  font-size: 15px; background: rgba(255,255,255,0.9);
  transition: all 0.2s; outline: none;
}
.form-field input:focus {
  border-color: #0071e3; box-shadow: 0 0 0 3px rgba(0,113,227,0.15);
}
.dark .form-field input {
  background: rgba(44,44,48,0.9); border-color: #48484a; color: #f5f5f7;
}
.dark .form-field input:focus {
  border-color: #2997ff; box-shadow: 0 0 0 3px rgba(41,151,255,0.2);
}
.toggle-pw {
  position: absolute; right: 10px; bottom: 7px;
  background: none; border: none; cursor: pointer; font-size: 16px; padding: 2px; opacity: 0.5;
}
.toggle-pw:hover { opacity: 1; }

.form-error {
  background: rgba(255,69,58,0.1); border: 1px solid rgba(255,69,58,0.3);
  color: #d64045; padding: 8px 12px; border-radius: 8px;
  font-size: 13px; margin-bottom: 12px; text-align: center;
}

.login-btn {
  width: 100%; padding: 12px; border: none; border-radius: 12px;
  background: #0071e3; color: white; font-size: 16px; font-weight: 500;
  cursor: pointer; transition: all 0.2s;
}
.login-btn:hover { background: #006edb; transform: translateY(-1px); }
.login-btn:active { transform: translateY(0); }
.login-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }

.spinner {
  display: inline-block; width: 18px; height: 18px;
  border: 2px solid rgba(255,255,255,0.3); border-top-color: white;
  border-radius: 50%; animation: spin 0.6s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.login-switch {
  text-align: center; margin-top: 14px; font-size: 13px; color: #0071e3;
  cursor: pointer; user-select: none;
}
.login-switch:hover { text-decoration: underline; }

.guest-mode {
  text-align: center; margin-top: 10px; font-size: 13px; color: #86868b;
  cursor: pointer; user-select: none;
}
.guest-mode:hover { color: #0071e3; }
</style>
