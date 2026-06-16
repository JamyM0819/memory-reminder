const crypto = require('crypto');

// Store active tokens in memory
const tokens = new Set();

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const verify = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return hash === verify;
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function requireAuth(req, res, next) {
  // Auth routes don't need auth
  if (req.path.startsWith('/auth/')) return next();

  const token = req.headers['x-auth-token'];
  if (!token || !tokens.has(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function setupAuth(app, db) {
  // Check if password is set
  app.get('/api/auth/status', (req, res) => {
    const password = db.getSetting('password');
    res.json({ hasPassword: !!password });
  });

  // First-time setup: set password
  app.post('/api/auth/setup', (req, res) => {
    const password = db.getSetting('password');
    if (password) return res.status(400).json({ error: 'Password already set' });

    const { password: pwd } = req.body;
    if (!pwd || pwd.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });

    db.setSetting('password', JSON.stringify(hashPassword(pwd)));

    const token = generateToken();
    tokens.add(token);
    res.json({ token });
  });

  // Login
  app.post('/api/auth/login', (req, res) => {
    const stored = db.getSetting('password');
    if (!stored) return res.status(400).json({ error: 'No password set' });

    const { password: pwd } = req.body;
    if (!pwd) return res.status(400).json({ error: 'Password is required' });

    if (!verifyPassword(pwd, stored)) {
      return res.status(401).json({ error: 'Wrong password' });
    }

    const token = generateToken();
    tokens.add(token);
    res.json({ token });
  });

  // Change password
  app.post('/api/auth/change-password', (req, res) => {
    const token = req.headers['x-auth-token'];
    if (!token || !tokens.has(token)) return res.status(401).json({ error: 'Unauthorized' });

    const stored = db.getSetting('password');
    const { oldPassword, newPassword } = req.body;

    if (!verifyPassword(oldPassword, stored)) {
      return res.status(401).json({ error: 'Wrong password' });
    }
    if (!newPassword || newPassword.length < 4) {
      return res.status(400).json({ error: 'New password must be at least 4 characters' });
    }

    db.setSetting('password', JSON.stringify(hashPassword(newPassword)));
    res.json({ ok: true });
  });

  return requireAuth;
}

module.exports = { setupAuth };
