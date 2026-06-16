const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API routes
const db = require('./db');
const push = require('./push');
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

// --- VAPID public key ---

app.get('/api/vapid-public-key', (req, res) => {
  res.json({ publicKey: push.getPublicKey() });
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Memory Reminder running at http://localhost:${PORT}`);
  console.log(`Access from your phone: use your computer's local IP on port ${PORT}`);
});
