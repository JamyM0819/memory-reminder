# 艾宾浩斯记忆提醒器 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy a PWA that lets users record memos and receive push notifications at Ebbinghaus-forgetting-curve intervals, with configurable do-not-disturb periods.

**Architecture:** Single Node.js Express server serving static PWA files + REST API + SQLite database. A cron job runs every minute to check due reminders and push notifications via Web Push Protocol. DND checks at send-time, so falling within a DND period naturally delays the reminder to the next cycle.

**Tech Stack:** Node.js + Express, better-sqlite3, web-push, node-cron; pure HTML/CSS/JS frontend; PWA with Service Worker + manifest.

---

## File Structure

```
F:\temp\jm\claude_project\Memory Helper\
├── package.json              # Dependencies & scripts
├── server.js                 # Express entry: routes, static, startup
├── db.js                     # SQLite: schema init + all query functions
├── push.js                   # Web Push: load keys, send notification
├── scheduler.js              # Cron: scan due reminders, push with DND check
├── public/
│   ├── index.html            # Main page: memo list view
│   ├── add.html              # Add memo page
│   ├── settings.html         # Settings page (DND config)
│   ├── styles.css            # All app styles (mobile-first)
│   ├── app.js                # Frontend: API calls, rendering, routing
│   ├── manifest.json         # PWA manifest for "Add to Home Screen"
│   └── sw.js                 # Service Worker: cache, push event handler
├── start.sh                  # One-click startup script
└── docs/
    └── superpowers/
        └── specs/
            └── 2026-06-16-memory-reminder-design.md
```

---

### Task 1: Project scaffold + package.json + server entry

**Files:**
- Create: `F:\temp\jm\claude_project\Memory Helper\package.json`
- Create: `F:\temp\jm\claude_project\Memory Helper\server.js`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "memory-reminder",
  "version": "1.0.0",
  "description": "Ebbinghaus forgetting-curve memory reminder PWA",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "node server.js"
  },
  "dependencies": {
    "better-sqlite3": "^11.0.0",
    "express": "^4.21.0",
    "node-cron": "^3.0.3",
    "web-push": "^3.6.7"
  }
}
```

- [ ] **Step 2: Create server.js — basic Express server with static serving and API placeholder**

```javascript
const express = require('express');
const path = require('path');
const sqlite = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API routes
const db = require('./db');
const scheduler = require('./scheduler');

// --- Memo routes ---

app.get('/api/memos', (req, res) => {
  try {
    const memos = db.getAllMemos();
    res.json(memos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/memos', (req, res) => {
  try {
    const { content } = req.body;
    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return res.status(400).json({ error: 'Content is required' });
    }
    const memo = db.createMemo(content.trim());
    res.status(201).json(memo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/memos/:id', (req, res) => {
  try {
    const { content } = req.body;
    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return res.status(400).json({ error: 'Content is required' });
    }
    const memo = db.updateMemo(req.params.id, content.trim());
    if (!memo) return res.status(404).json({ error: 'Memo not found' });
    res.json(memo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/memos/:id', (req, res) => {
  try {
    db.deleteMemo(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/memos/:id/toggle', (req, res) => {
  try {
    const memo = db.toggleMemo(req.params.id);
    if (!memo) return res.status(404).json({ error: 'Memo not found' });
    res.json(memo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Subscription routes ---

app.post('/api/subscribe', (req, res) => {
  try {
    const { endpoint, keys } = req.body;
    db.saveSubscription(endpoint, JSON.stringify(keys));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/unsubscribe', (req, res) => {
  try {
    const { endpoint } = req.body;
    db.removeSubscription(endpoint);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Settings routes ---

app.get('/api/settings', (req, res) => {
  try {
    const settings = db.getAllSettings();
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/settings', (req, res) => {
  try {
    const settings = req.body;
    for (const [key, value] of Object.entries(settings)) {
      db.setSetting(key, JSON.stringify(value));
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Start ---

scheduler.start(db);

app.listen(PORT, () => {
  console.log(`Memory Reminder running at http://localhost:${PORT}`);
});
```

- [ ] **Step 3: Install dependencies**

Run: `cd "F:\temp\jm\claude_project\Memory Helper" && npm install`

---

### Task 2: Database layer (db.js)

**Files:**
- Create: `F:\temp\jm\claude_project\Memory Helper\db.js`

- [ ] **Step 1: Create db.js with full schema and CRUD**

```javascript
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'memory.db');

// Intervals in milliseconds from creation time
const INTERVALS = [
  5 * 60 * 1000,           // 5 minutes
  30 * 60 * 1000,          // 30 minutes
  60 * 60 * 1000,          // 1 hour
  3 * 60 * 60 * 1000,      // 3 hours
  6 * 60 * 60 * 1000,      // 6 hours
  12 * 60 * 60 * 1000,     // 12 hours
  24 * 60 * 60 * 1000,     // 1 day
  2 * 24 * 60 * 60 * 1000, // 2 days
  4 * 24 * 60 * 60 * 1000, // 4 days
  7 * 24 * 60 * 60 * 1000, // 7 days
  15 * 24 * 60 * 60 * 1000 // 15 days
];

function getDb() {
  const fs = require('fs');
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  return db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memo_id INTEGER NOT NULL,
      interval_index INTEGER NOT NULL,
      remind_at TEXT NOT NULL,
      notified INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (memo_id) REFERENCES memos(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint TEXT NOT NULL UNIQUE,
      keys TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL
    );
  `);

  // Insert default settings if not exists
  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  insertSetting.run('dnd_weekday_start', '"23:00"');
  insertSetting.run('dnd_weekday_end', '"07:00"');
  insertSetting.run('dnd_weekend_start', '"23:00"');
  insertSetting.run('dnd_weekend_end', '"09:00"');
}

// --- Memo CRUD ---

function getAllMemos() {
  const db = getDb();
  initSchema(db);
  const memos = db.prepare(`
    SELECT m.*,
      (SELECT COUNT(*) FROM reminders r WHERE r.memo_id = m.id AND r.notified = 1) as notified_count,
      (SELECT COUNT(*) FROM reminders r WHERE r.memo_id = m.id) as total_count,
      (SELECT MIN(r.remind_at) FROM reminders r WHERE r.memo_id = m.id AND r.notified = 0) as next_remind_at
    FROM memos m
    ORDER BY m.created_at DESC
  `).all();
  db.close();
  return memos;
}

function createMemo(content) {
  const db = getDb();
  initSchema(db);
  const now = Date.now();

  const insertMemo = db.prepare('INSERT INTO memos (content, created_at) VALUES (?, ?)');
  const localTime = new Date(now + 8 * 60 * 60 * 1000).toISOString().replace('T', ' ').substring(0, 19);
  const result = insertMemo.run(content, localTime);
  const memoId = result.lastInsertRowid;

  const insertReminder = db.prepare(
    'INSERT INTO reminders (memo_id, interval_index, remind_at) VALUES (?, ?, ?)'
  );

  const insertMany = db.transaction((intervals) => {
    for (let i = 0; i < intervals.length; i++) {
      const remindAt = new Date(now + intervals[i]);
      const remindAtStr = remindAt.toISOString().replace('T', ' ').substring(0, 19);
      insertReminder.run(memoId, i, remindAtStr);
    }
  });

  insertMany(INTERVALS);
  db.close();

  return { id: Number(memoId), content, created_at: localTime, is_active: 1 };
}

function updateMemo(id, content) {
  const db = getDb();
  initSchema(db);
  const result = db.prepare('UPDATE memos SET content = ? WHERE id = ?').run(content, id);
  db.close();
  if (result.changes === 0) return null;
  return { id: Number(id), content };
}

function deleteMemo(id) {
  const db = getDb();
  initSchema(db);
  db.prepare('DELETE FROM memos WHERE id = ?').run(id);
  db.close();
}

function toggleMemo(id) {
  const db = getDb();
  initSchema(db);
  db.prepare('UPDATE memos SET is_active = CASE WHEN is_active THEN 0 ELSE 1 END WHERE id = ?').run(id);
  const memo = db.prepare('SELECT * FROM memos WHERE id = ?').get(id);
  db.close();
  return memo;
}

// --- Subscriptions ---

function saveSubscription(endpoint, keys) {
  const db = getDb();
  initSchema(db);
  db.prepare(
    'INSERT OR REPLACE INTO subscriptions (endpoint, keys) VALUES (?, ?)'
  ).run(endpoint, keys);
  db.close();
}

function removeSubscription(endpoint) {
  const db = getDb();
  initSchema(db);
  db.prepare('DELETE FROM subscriptions WHERE endpoint = ?').run(endpoint);
  db.close();
}

function getAllSubscriptions() {
  const db = getDb();
  initSchema(db);
  const subs = db.prepare('SELECT * FROM subscriptions').all();
  db.close();
  return subs.map(s => ({ ...s, keys: JSON.parse(s.keys) }));
}

// --- Reminders ---

function getDueReminders() {
  const db = getDb();
  initSchema(db);
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const reminders = db.prepare(`
    SELECT r.*, m.content as memo_content
    FROM reminders r
    JOIN memos m ON r.memo_id = m.id
    WHERE r.notified = 0 AND r.remind_at <= ? AND m.is_active = 1
    ORDER BY r.remind_at ASC
  `).all(now);
  db.close();
  return reminders;
}

function markNotified(id) {
  const db = getDb();
  initSchema(db);
  db.prepare('UPDATE reminders SET notified = 1 WHERE id = ?').run(id);
  db.close();
}

// --- Settings ---

function getAllSettings() {
  const db = getDb();
  initSchema(db);
  const rows = db.prepare('SELECT * FROM settings').all();
  db.close();
  const settings = {};
  for (const row of rows) {
    settings[row.key] = JSON.parse(row.value);
  }
  return settings;
}

function setSetting(key, value) {
  const db = getDb();
  initSchema(db);
  db.prepare(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
  ).run(key, value);
  db.close();
}

module.exports = {
  getAllMemos,
  createMemo,
  updateMemo,
  deleteMemo,
  toggleMemo,
  saveSubscription,
  removeSubscription,
  getAllSubscriptions,
  getDueReminders,
  markNotified,
  getAllSettings,
  setSetting,
  INTERVALS
};
```

- [ ] **Step 2: Create data directory (will be auto-created on first run)**

No action needed — `getDb()` creates the directory automatically.

---

### Task 3: Web Push module (push.js)

**Files:**
- Create: `F:\temp\jm\claude_project\Memory Helper\push.js`

- [ ] **Step 1: Create push.js with VAPID key management and send function**

```javascript
const webpush = require('web-push');
const fs = require('fs');
const path = require('path');

const VAPID_KEYS_PATH = path.join(__dirname, 'data', 'vapid.json');

function loadOrGenerateKeys() {
  const dir = path.dirname(VAPID_KEYS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (fs.existsSync(VAPID_KEYS_PATH)) {
    return JSON.parse(fs.readFileSync(VAPID_KEYS_PATH, 'utf8'));
  }

  const keys = webpush.generateVAPIDKeys();
  fs.writeFileSync(VAPID_KEYS_PATH, JSON.stringify(keys, null, 2));
  return keys;
}

const vapidKeys = loadOrGenerateKeys();

webpush.setVapidDetails(
  'mailto:memory-reminder@localhost',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

function sendNotification(subscription, memoContent) {
  const payload = JSON.stringify({
    title: '🔔 到时间复习了',
    body: memoContent,
    icon: '/icon-192.png',
    badge: '/icon-96.png',
    vibrate: [200, 100, 200]
  });

  return webpush.sendNotification(subscription, payload);
}

function getPublicKey() {
  return vapidKeys.publicKey;
}

module.exports = { sendNotification, getPublicKey };
```

---

### Task 4: Scheduler (scheduler.js)

**Files:**
- Create: `F:\temp\jm\claude_project\Memory Helper\scheduler.js`

- [ ] **Step 1: Create scheduler.js with DND-aware reminder dispatch**

```javascript
const cron = require('node-cron');
const push = require('./push');

function isInDND(settings) {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 6=Sat
  const isWeekend = day === 0 || day === 6;

  const startKey = isWeekend ? 'dnd_weekend_start' : 'dnd_weekday_start';
  const endKey = isWeekend ? 'dnd_weekend_end' : 'dnd_weekday_end';

  const start = settings[startKey];
  const end = settings[endKey];
  if (!start || !end) return false;

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [startH, startM] = start.split(':').map(Number);
  const [endH, endM] = end.split(':').map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  // Handle overnight DND (e.g., 23:00 ~ 07:00)
  if (startMinutes <= endMinutes) {
    // Same-day range (e.g., 09:00 ~ 17:00)
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  } else {
    // Overnight range (e.g., 23:00 ~ 07:00)
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
}

function start(db) {
  // Log startup
  const d = new Date();
  console.log(`[${d.toLocaleString()}] Scheduler started. Checking every minute.`);

  cron.schedule('* * * * *', async () => {
    try {
      const settings = db.getAllSettings();
      if (isInDND(settings)) {
        return; // Skip while in DND — reminders auto-carry to next cycle
      }

      const dueReminders = db.getDueReminders();
      if (dueReminders.length === 0) return;

      const subscriptions = db.getAllSubscriptions();
      if (subscriptions.length === 0) return;

      for (const reminder of dueReminders) {
        try {
          // Send to all subscribed devices
          for (const sub of subscriptions) {
            const pushSub = { endpoint: sub.endpoint, keys: sub.keys };
            await push.sendNotification(pushSub, reminder.memo_content);
          }
          db.markNotified(reminder.id);
          console.log(`[${new Date().toLocaleString()}] Sent reminder #${reminder.id}: ${reminder.memo_content.substring(0, 40)}...`);
        } catch (err) {
          console.error(`Failed to send reminder #${reminder.id}:`, err.message);
        }
      }
    } catch (err) {
      console.error('Scheduler error:', err.message);
    }
  });
}

module.exports = { start };
```

---

### Task 5: Frontend — HTML pages + CSS + JS

**Files:**
- Create: `F:\temp\jm\claude_project\Memory Helper\public\index.html`
- Create: `F:\temp\jm\claude_project\Memory Helper\public\add.html`
- Create: `F:\temp\jm\claude_project\Memory Helper\public\settings.html`
- Create: `F:\temp\jm\claude_project\Memory Helper\public\styles.css`
- Create: `F:\temp\jm\claude_project\Memory Helper\public\app.js`

- [ ] **Step 1: Create styles.css — mobile-first minimal styling**

```css
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: #f5f5f5;
  color: #333;
  max-width: 480px;
  margin: 0 auto;
  min-height: 100vh;
}

/* Header */
.header {
  background: #4a90d9;
  color: #fff;
  padding: 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  position: sticky;
  top: 0;
  z-index: 100;
}
.header h1 { font-size: 18px; font-weight: 600; }
.header a { color: #fff; text-decoration: none; font-size: 22px; }

/* FAB */
.fab {
  position: fixed;
  bottom: 24px;
  right: 24px;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: #4a90d9;
  color: #fff;
  border: none;
  font-size: 28px;
  box-shadow: 0 4px 12px rgba(74, 144, 217, 0.4);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.fab:active { transform: scale(0.95); }

/* Card list */
.memo-list { padding: 12px; }
.memo-card {
  background: #fff;
  border-radius: 10px;
  padding: 14px 16px;
  margin-bottom: 10px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.08);
  position: relative;
}
.memo-content {
  font-size: 15px;
  line-height: 1.5;
  word-break: break-word;
  margin-bottom: 8px;
}
.memo-meta {
  font-size: 12px;
  color: #999;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.progress-dots {
  display: flex;
  gap: 4px;
  align-items: center;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #e0e0e0;
  display: inline-block;
}
.dot.done { background: #4a90d9; }
.memo-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
.memo-actions button {
  border: none;
  background: none;
  font-size: 13px;
  color: #999;
  cursor: pointer;
  padding: 4px 8px;
}
.memo-actions .delete-btn { color: #e74c3c; }
.memo-actions .toggle-btn { color: #f39c12; }
.memo-inactive { opacity: 0.5; }

/* Form page */
.form-page { padding: 16px; }
.form-page textarea {
  width: 100%;
  height: 160px;
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 12px;
  font-size: 16px;
  font-family: inherit;
  resize: vertical;
  outline: none;
}
.form-page textarea:focus { border-color: #4a90d9; }
.form-actions {
  display: flex;
  gap: 10px;
  margin-top: 12px;
}
.btn {
  flex: 1;
  padding: 12px;
  border-radius: 8px;
  border: none;
  font-size: 16px;
  cursor: pointer;
  text-align: center;
}
.btn-primary { background: #4a90d9; color: #fff; }
.btn-secondary { background: #e0e0e0; color: #333; }
.btn-danger { background: #e74c3c; color: #fff; }

/* Settings page */
.settings-page { padding: 16px; }
.settings-group { margin-bottom: 24px; }
.settings-group h3 {
  font-size: 14px;
  color: #999;
  margin-bottom: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.setting-row {
  background: #fff;
  border-radius: 8px;
  padding: 12px 16px;
  margin-bottom: 8px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.setting-row label { font-size: 14px; }
.setting-row input[type="time"] {
  border: 1px solid #ddd;
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 14px;
}

/* Empty state */
.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: #ccc;
  font-size: 16px;
}

/* Toast */
.toast {
  position: fixed;
  bottom: 80px;
  left: 16px;
  right: 16px;
  max-width: 448px;
  margin: 0 auto;
  background: #333;
  color: #fff;
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 14px;
  text-align: center;
  opacity: 0;
  transition: opacity 0.3s;
  pointer-events: none;
  z-index: 200;
}
.toast.show { opacity: 1; }

/* Loading spinner */
.spinner { text-align: center; padding: 40px; color: #ccc; }
```

- [ ] **Step 2: Create app.js — frontend API layer and rendering**

```javascript
// --- API ---
const API = {
  async getMemos() {
    const res = await fetch('/api/memos');
    return res.json();
  },
  async createMemo(content) {
    const res = await fetch('/api/memos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  async deleteMemo(id) {
    await fetch(`/api/memos/${id}`, { method: 'DELETE' });
  },
  async toggleMemo(id) {
    const res = await fetch(`/api/memos/${id}/toggle`, { method: 'PUT' });
    return res.json();
  },
  async updateMemo(id, content) {
    const res = await fetch(`/api/memos/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    return res.json();
  },
  async getSettings() {
    const res = await fetch('/api/settings');
    return res.json();
  },
  async saveSettings(settings) {
    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    });
  },
  async subscribe(subscription) {
    await fetch('/api/subscribe', {
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
    : memo.notified_count >= INTERVAL_COUNT ? '已完成全部提醒' : '已暂停';

  return `
    <div class="memo-card ${memo.is_active ? '' : 'memo-inactive'}" data-id="${memo.id}">
      <div class="memo-content">${escapeHtml(memo.content)}</div>
      <div class="memo-meta">
        <span class="progress-dots">${dots}</span>
        <span>${memo.notified_count}/${INTERVAL_COUNT} · ${nextTime}</span>
      </div>
      <div class="memo-actions">
        <button class="toggle-btn" onclick="handleToggle(${memo.id})">
          ${memo.is_active ? '暂停' : '启用'}
        </button>
        <button class="delete-btn" onclick="handleDelete(${memo.id})">删除</button>
      </div>
    </div>
  `;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
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
```

- [ ] **Step 3: Create index.html — memo list page**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <meta name="theme-color" content="#4a90d9">
  <link rel="manifest" href="/manifest.json">
  <link rel="apple-touch-icon" href="/icon-192.png">
  <title>记忆提醒</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <div class="header">
    <h1>🧠 记忆提醒</h1>
    <a href="/settings.html">⚙️</a>
  </div>

  <div class="memo-list" id="memo-list">
    <div class="spinner">加载中...</div>
  </div>

  <button class="fab" onclick="location.href='/add.html'">+</button>

  <div class="toast" id="toast"></div>

  <script src="/app.js"></script>
  <script>
    renderMemoList();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then(() => {
        subscribePush();
      });
    }
  </script>
</body>
</html>
```

- [ ] **Step 4: Create add.html — add memo page**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>添加记忆</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <div class="header">
    <h1>添加记忆</h1>
    <a href="/" style="font-size:14px;font-weight:normal;">取消</a>
  </div>

  <div class="form-page">
    <textarea id="content" placeholder="写下一段需要记忆的内容&#10;例如：apple 苹果&#10;例如：JS数组去重 → [...new Set(arr)]" autofocus></textarea>
    <div class="form-actions">
      <button class="btn btn-secondary" onclick="history.back()">取消</button>
      <button class="btn btn-primary" onclick="handleSave()">保存</button>
    </div>
  </div>

  <div class="toast" id="toast"></div>

  <script src="/app.js"></script>
  <script>
    async function handleSave() {
      const content = document.getElementById('content').value.trim();
      if (!content) {
        showToast('请输入记忆内容');
        return;
      }
      try {
        await API.createMemo(content);
        location.href = '/';
      } catch (err) {
        showToast('保存失败，请重试');
      }
    }

    document.getElementById('content').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.ctrlKey) handleSave();
    });
  </script>
</body>
</html>
```

- [ ] **Step 5: Create settings.html — DND configuration**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>设置</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <div class="header">
    <h1>设置</h1>
    <a href="/" style="font-size:14px;font-weight:normal;">完成</a>
  </div>

  <div class="settings-page" id="settings-page">
    <div class="settings-group">
      <h3>工作日免打扰（周一~周五）</h3>
      <div class="setting-row">
        <label>开始时间</label>
        <input type="time" id="dnd_weekday_start" value="23:00">
      </div>
      <div class="setting-row">
        <label>结束时间</label>
        <input type="time" id="dnd_weekday_end" value="07:00">
      </div>
    </div>

    <div class="settings-group">
      <h3>休息日免打扰（周六~周日）</h3>
      <div class="setting-row">
        <label>开始时间</label>
        <input type="time" id="dnd_weekend_start" value="23:00">
      </div>
      <div class="setting-row">
        <label>结束时间</label>
        <input type="time" id="dnd_weekend_end" value="09:00">
      </div>
    </div>

    <button class="btn btn-primary" onclick="handleSaveSettings()" style="margin-top:8px;">保存设置</button>
  </div>

  <div class="toast" id="toast"></div>

  <script src="/app.js"></script>
  <script>
    async function loadSettings() {
      try {
        const s = await API.getSettings();
        if (s.dnd_weekday_start) document.getElementById('dnd_weekday_start').value = s.dnd_weekday_start;
        if (s.dnd_weekday_end) document.getElementById('dnd_weekday_end').value = s.dnd_weekday_end;
        if (s.dnd_weekend_start) document.getElementById('dnd_weekend_start').value = s.dnd_weekend_start;
        if (s.dnd_weekend_end) document.getElementById('dnd_weekend_end').value = s.dnd_weekend_end;
      } catch (err) {
        showToast('加载设置失败');
      }
    }

    async function handleSaveSettings() {
      const settings = {
        dnd_weekday_start: document.getElementById('dnd_weekday_start').value,
        dnd_weekday_end: document.getElementById('dnd_weekday_end').value,
        dnd_weekend_start: document.getElementById('dnd_weekend_start').value,
        dnd_weekend_end: document.getElementById('dnd_weekend_end').value
      };
      try {
        await API.saveSettings(settings);
        showToast('设置已保存');
      } catch (err) {
        showToast('保存失败');
      }
    }

    loadSettings();
  </script>
</body>
</html>
```

---

### Task 6: PWA config — manifest.json + Service Worker + VAPID public key endpoint

**Files:**
- Create: `F:\temp\jm\claude_project\Memory Helper\public\manifest.json`
- Create: `F:\temp\jm\claude_project\Memory Helper\public\sw.js`
- Modify: `F:\temp\jm\claude_project\Memory Helper\server.js` (add VAPID public key endpoint)

- [ ] **Step 1: Create manifest.json**

```json
{
  "name": "记忆提醒",
  "short_name": "记忆提醒",
  "description": "基于艾宾浩斯遗忘曲线的记忆提醒工具",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#f5f5f5",
  "theme_color": "#4a90d9",
  "icons": [
    { "src": "/icon-96.png", "sizes": "96x96", "type": "image/png" },
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

- [ ] **Step 2: Create sw.js — Service Worker with push event handler and cache**

```javascript
const CACHE_NAME = 'memory-reminder-v1';
const ASSETS = ['/', '/add.html', '/settings.html', '/styles.css', '/app.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Only cache GET requests to same origin
  if (event.request.method === 'GET' && event.request.url.startsWith(self.location.origin)) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
  }
});

self.addEventListener('push', (event) => {
  if (!event.data) return;
  try {
    const data = event.data.json();
    const options = {
      body: data.body,
      icon: data.icon || '/icon-192.png',
      badge: data.badge || '/icon-96.png',
      vibrate: data.vibrate || [200, 100, 200],
      tag: 'memory-reminder',
      requireInteraction: true
    };
    event.waitUntil(
      self.registration.showNotification(data.title || '记得复习', options)
    );
  } catch (err) {
    console.error('Push handler error:', err);
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      if (clientList.length > 0) {
        clientList[0].focus();
      } else {
        clients.openWindow('/');
      }
    })
  );
});
```

- [ ] **Step 3: Generate simple PNG icons for the PWA**

```bash
# Install canvas dependencies not needed — we'll create minimal SVG-based PNGs
# Instead, create a script or use a simple approach
```

Actually, for icons we'll just serve placeholder SVG icons or generate minimal PNGs. Let me use a simple approach — create an inline SVG favicon and reference that.

Better approach: Create a simple script to generate PNG icons, or skip icon files and just use emoji favicon. Actually for PWA we need real icon PNGs. Let me generate them with a simple Node.js script, or use SVG icons that Chrome supports.

The simplest approach: use SVG files as PWA icons (modern Chrome supports SVG icons in manifest).

- [ ] **Step 3: Create SVG icons for PWA manifest**

Create `F:\temp\jm\claude_project\Memory Helper\public\icon-96.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
  <rect width="96" height="96" rx="20" fill="#4a90d9"/>
  <text x="48" y="62" text-anchor="middle" font-size="48" fill="white">🧠</text>
</svg>
```

Create `F:\temp\jm\claude_project\Memory Helper\public\icon-192.svg` (same, 192x192):

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 192 192">
  <rect width="192" height="192" rx="40" fill="#4a90d9"/>
  <text x="96" y="124" text-anchor="middle" font-size="96" fill="white">🧠</text>
</svg>
```

Create `F:\temp\jm\claude_project\Memory Helper\public\icon-512.svg` (same, 512x512):

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="106" fill="#4a90d9"/>
  <text x="256" y="330" text-anchor="middle" font-size="256" fill="white">🧠</text>
</svg>
```

Update manifest.json to use SVG:

```json
"icons": [
  { "src": "/icon-96.svg", "sizes": "96x96", "type": "image/svg+xml" },
  { "src": "/icon-192.svg", "sizes": "192x192", "type": "image/svg+xml" },
  { "src": "/icon-512.svg", "sizes": "512x512", "type": "image/svg+xml" }
]
```

- [ ] **Step 4: Add VAPID public key endpoint to server.js**

Add this route before `app.listen`:

```javascript
const push = require('./push');

app.get('/api/vapid-public-key', (req, res) => {
  res.json({ publicKey: push.getPublicKey() });
});
```

---

### Task 7: Startup script and final wiring

**Files:**
- Create: `F:\temp\jm\claude_project\Memory Helper\start.sh`

- [ ] **Step 1: Create start.sh**

```bash
#!/bin/bash
cd "$(dirname "$0")"
echo "Installing dependencies..."
npm install
echo ""
echo "Starting Memory Reminder server..."
echo "Open http://localhost:3000 in Chrome on your phone (same WiFi)"
echo ""
node server.js
```

Also create `start.bat` for Windows:

```bat
@echo off
cd /d "%~dp0"
echo Installing dependencies...
call npm install
echo.
echo Starting Memory Reminder server...
echo Open http://localhost:3000 in Chrome on your phone (same WiFi)
echo.
node server.js
pause
```

- [ ] **Step 2: Verify server.js includes all requires**

Ensure server.js has:
```javascript
const push = require('./push');
```
at the top, and the VAPID public key endpoint added before `app.listen`.

---

### Task 8: Test the application end-to-end

- [ ] **Step 1: Start the server**

```bash
cd "F:\temp\jm\claude_project\Memory Helper" && node server.js
```

Expected: `Memory Reminder running at http://localhost:3000`

- [ ] **Step 2: Test API — create a memo**

```bash
curl -s -X POST http://localhost:3000/api/memos \
  -H "Content-Type: application/json" \
  -d '{"content":"apple 苹果"}' | head -c 200
```

Expected: returns JSON with id, content, created_at

- [ ] **Step 3: Test API — get memos**

```bash
curl -s http://localhost:3000/api/memos | head -c 500
```

Expected: returns JSON array with the memo, notified_count=0, total_count=11, next_remind_at set

- [ ] **Step 4: Test DND settings**

```bash
curl -s http://localhost:3000/api/settings
```

Expected: returns JSON with dnd_weekday_start, dnd_weekday_end, dnd_weekend_start, dnd_weekend_end

- [ ] **Step 5: Open in browser**

Open `http://localhost:3000` in Chrome. Expected: memo list page loads, shows the "apple 苹果" memo with 11 progress dots, all gray.

- [ ] **Step 6: Test push notification (requires HTTPS for production)**

Note: Web Push requires HTTPS in production. For local testing, Chrome allows push on localhost. The server needs to be accessible from the phone on the same network.

---

### Spec Coverage Check

| Spec requirement | Task |
|---|---|
| 11 Ebbinghaus intervals (5min → 15d) | Task 2 — db.js INTERVALS array |
| Create memo + auto-generate reminders | Task 2 — createMemo() |
| Push notification at each interval | Task 3 + Task 4 |
| DND: weekday separate from weekend | Task 4 — isInDND() + settings |
| DND: customizable start/end times | Task 5 — settings.html |
| DND time falls in → delay (skip cycle) | Task 4 — return early, next cron picks up |
| PWA: add to home screen | Task 6 — manifest.json + sw.js |
| Mobile-first UI | Task 5 — styles.css (max-width 480px) |
| Single user, no login | Designed inherently — no auth endpoints |
| Pure text memos | Task 5 — textarea, plain text storage |

All spec requirements covered. No placeholders in the plan.

---

### Execution Handoff

Plan complete and saved. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
