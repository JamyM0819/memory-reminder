// --- Auth ---
function getToken() { return localStorage.getItem('auth_token'); }

async function authFetch(url, options = {}) {
  const token = getToken();
  if (token) {
    options.headers = { ...options.headers, 'x-auth-token': token };
  }
  const res = await fetch(url, options);
  if (res.status === 401) {
    localStorage.removeItem('auth_token');
    location.href = '/login.html';
    throw new Error('Unauthorized');
  }
  return res;
}

function checkAuth() {
  const token = getToken();
  if (!token) {
    location.href = '/login.html';
    return false;
  }
  return true;
}

// --- API ---
const API = {
  async getMemos() {
    const res = await authFetch('/api/memos');
    return res.json();
  },
  async createMemo(content) {
    const res = await authFetch('/api/memos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  async deleteMemo(id) {
    await authFetch(`/api/memos/${id}`, { method: 'DELETE' });
  },
  async toggleMemo(id) {
    const res = await authFetch(`/api/memos/${id}/toggle`, { method: 'PUT' });
    return res.json();
  },
  async getSettings() {
    const res = await authFetch('/api/settings');
    return res.json();
  },
  async saveSettings(settings) {
    await authFetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    });
  },
  async subscribe(subscription) {
    await authFetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription)
    });
  }
};

// --- Render helpers ---

const INTERVAL_COUNT = 11;

function renderMemoCard(memo) {
  const dots = Array.from({ length: INTERVAL_COUNT }, (_, i) =>
    `<span class="dot ${i < memo.notified_count ? 'done' : ''}"></span>`
  ).join('');

  const nextTime = memo.next_remind_at
    ? `下次: ${memo.next_remind_at.substring(5, 16)}`
    : memo.notified_count >= INTERVAL_COUNT ? '✅ 已完成全部提醒' : '⏸ 已暂停';

  return `
    <div class="memo-card ${memo.is_active ? '' : 'memo-inactive'}" data-id="${memo.id}">
      <div class="memo-content" onclick="location.href='/add.html?id=${memo.id}'">${memo.content}</div>
      <div class="memo-meta">
        <span class="progress-dots">${dots}</span>
        <span>${memo.notified_count}/${INTERVAL_COUNT} · ${nextTime}</span>
      </div>
      <div class="memo-actions">
        <button class="toggle-btn" onclick="event.stopPropagation();handleToggle(${memo.id})">
          ${memo.is_active ? '⏸ 暂停' : '▶ 启用'}
        </button>
        <button class="delete-btn" onclick="event.stopPropagation();handleDelete(${memo.id})">🗑 删除</button>
      </div>
    </div>
  `;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

let toastTimer = null;
function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

// --- Handlers ---

async function handleDelete(id) {
  if (!confirm('删除这条记忆？相关的提醒也会一并删除。')) return;
  await API.deleteMemo(id);
  renderMemoList();
}

async function handleToggle(id) {
  await API.toggleMemo(id);
  renderMemoList();
}

async function renderMemoList() {
  const container = document.getElementById('memo-list');
  if (!container) return;
  container.innerHTML = '<div class="spinner">加载中...</div>';
  try {
    const memos = await API.getMemos();
    if (memos.length === 0) {
      container.innerHTML = '<div class="empty-state">还没有记忆内容<br>点击下方 + 添加第一条</div>';
      return;
    }
    container.innerHTML = memos.map(renderMemoCard).join('');
  } catch (err) {
    container.innerHTML = '<div class="empty-state">加载失败，请刷新重试</div>';
  }
}

// --- Push subscription ---

async function subscribePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.log('Push not supported');
    return;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      const response = await fetch('/api/vapid-public-key');
      const { publicKey } = await response.json();
      const convertedKey = urlBase64ToUint8Array(publicKey);

      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedKey
      });
    }

    await API.subscribe(subscription.toJSON());
    console.log('Push subscribed successfully');
  } catch (err) {
    console.error('Push subscription failed:', err);
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(ch => ch.charCodeAt(0)));
}
