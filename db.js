const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = () => {
  const dir = process.env.DATA_DIR || path.join(__dirname, 'data');
  return path.join(dir, 'memory.db');
};

// China timezone helper (UTC+8)
function toLocalISO(date) {
  const local = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return local.toISOString().replace('T', ' ').substring(0, 19);
}


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
  const dbPath = DB_PATH();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const db = new Database(dbPath);
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
  const now = new Date();

  const localTime = toLocalISO(now);
  const insertMemo = db.prepare('INSERT INTO memos (content, created_at) VALUES (?, ?)');
  const result = insertMemo.run(content, localTime);
  const memoId = result.lastInsertRowid;

  const insertReminder = db.prepare(
    'INSERT INTO reminders (memo_id, interval_index, remind_at) VALUES (?, ?, ?)'
  );

  const insertMany = db.transaction((intervals) => {
    for (let i = 0; i < intervals.length; i++) {
      const remindAt = new Date(now.getTime() + intervals[i]);
      insertReminder.run(memoId, i, toLocalISO(remindAt));
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
  const nowStr = toLocalISO(new Date());
  const reminders = db.prepare(`
    SELECT r.*, m.content as memo_content
    FROM reminders r
    JOIN memos m ON r.memo_id = m.id
    WHERE r.notified = 0 AND r.remind_at <= ? AND m.is_active = 1
    ORDER BY r.remind_at ASC
  `).all(nowStr);
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
