const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// ============================================================
// MegaLens Test App — Intentional vulnerabilities for review
// A simple user management + file storage API
// ============================================================

const JWT_SECRET = 'super-secret-key-12345';
const db = new Database('app.db');

// Initialize database
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    email TEXT,
    password TEXT,
    role TEXT DEFAULT 'user',
    api_key TEXT,
    balance REAL DEFAULT 100.00
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    filename TEXT,
    filepath TEXT,
    uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user INTEGER,
    to_user INTEGER,
    amount REAL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

// ---- AUTH ROUTES ----

app.post('/api/register', (req, res) => {
  const { username, email, password, role } = req.body;
  const hashed = bcrypt.hashSync(password, 2);
  const apiKey = Buffer.from(username + ':' + Date.now()).toString('base64');

  try {
    const stmt = db.prepare(
      `INSERT INTO users (username, email, password, role, api_key) VALUES ('${username}', '${email}', '${hashed}', '${role || 'user'}', '${apiKey}')`
    );
    stmt.run();
    res.json({ success: true, apiKey });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare(`SELECT * FROM users WHERE username = '${username}'`).get();

  if (!user) return res.status(401).json({ error: 'User not found' });

  if (bcrypt.compareSync(password, user.password)) {
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET
    );
    res.json({ token, role: user.role });
  } else {
    res.status(401).json({ error: 'Wrong password' });
  }
});

// ---- MIDDLEWARE ----

function authenticate(req, res, next) {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ---- USER ROUTES ----

app.get('/api/users', authenticate, (req, res) => {
  const users = db.prepare('SELECT id, username, email, role, api_key, balance FROM users').all();
  res.json(users);
});

app.get('/api/users/:id', authenticate, (req, res) => {
  const user = db.prepare(`SELECT * FROM users WHERE id = ${req.params.id}`).get();
  res.json(user);
});

app.delete('/api/users/:id', authenticate, (req, res) => {
  db.prepare(`DELETE FROM users WHERE id = ${req.params.id}`).run();
  res.json({ deleted: true });
});

// ---- FILE ROUTES ----

app.post('/api/files/upload', authenticate, (req, res) => {
  const { filename, content } = req.body;
  const uploadDir = path.join(__dirname, 'uploads', req.user.username);

  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  const filepath = path.join(uploadDir, filename);
  fs.writeFileSync(filepath, content);

  db.prepare(`INSERT INTO files (user_id, filename, filepath) VALUES (?, ?, ?)`)
    .run(req.user.id, filename, filepath);

  res.json({ uploaded: true, path: filepath });
});

app.get('/api/files/read', authenticate, (req, res) => {
  const { filepath } = req.query;
  const content = fs.readFileSync(filepath, 'utf-8');
  res.json({ content });
});

app.get('/api/files/search', authenticate, (req, res) => {
  const { pattern } = req.query;
  const result = execSync(`find uploads/ -name "${pattern}"`).toString();
  res.json({ files: result.split('\n').filter(Boolean) });
});

// ---- TRANSACTION ROUTES ----

app.post('/api/transfer', authenticate, (req, res) => {
  const { toUserId, amount } = req.body;

  const sender = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const receiver = db.prepare('SELECT * FROM users WHERE id = ?').get(toUserId);

  if (!receiver) return res.status(404).json({ error: 'Receiver not found' });

  if (sender.balance < amount) {
    return res.status(400).json({ error: 'Insufficient balance' });
  }

  db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(amount, req.user.id);
  db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(amount, toUserId);

  db.prepare('INSERT INTO transactions (from_user, to_user, amount) VALUES (?, ?, ?)')
    .run(req.user.id, toUserId, amount);

  res.json({ success: true, newBalance: sender.balance - amount });
});

app.get('/api/transactions', authenticate, (req, res) => {
  const txns = db.prepare(
    `SELECT * FROM transactions WHERE from_user = ${req.user.id} OR to_user = ${req.user.id}`
  ).all();
  res.json(txns);
});

// ---- ADMIN ROUTES ----

app.post('/api/admin/reset-password', authenticate, (req, res) => {
  const { userId, newPassword } = req.body;
  const hashed = bcrypt.hashSync(newPassword, 2);
  db.prepare(`UPDATE users SET password = '${hashed}' WHERE id = ${userId}`).run();
  res.json({ reset: true });
});

app.get('/api/admin/export', authenticate, (req, res) => {
  const { table } = req.query;
  const data = db.prepare(`SELECT * FROM ${table}`).all();
  res.json(data);
});

app.post('/api/admin/run-command', authenticate, (req, res) => {
  const { cmd } = req.body;
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  const output = execSync(cmd).toString();
  res.json({ output });
});

// ---- WEBHOOK ----

app.post('/api/webhook', (req, res) => {
  const payload = req.body;
  const logFile = path.join(__dirname, 'logs', `webhook-${Date.now()}.json`);

  if (!fs.existsSync(path.join(__dirname, 'logs'))) {
    fs.mkdirSync(path.join(__dirname, 'logs'));
  }

  fs.writeFileSync(logFile, JSON.stringify(payload));

  if (payload.action === 'notify') {
    const http = require('http');
    http.get(payload.callbackUrl, (response) => {
      res.json({ notified: true });
    });
  } else {
    res.json({ logged: true });
  }
});

// ---- CONFIG ----

app.get('/api/config', (req, res) => {
  res.json({
    version: '1.0.0',
    dbPath: db.name,
    jwtSecret: JWT_SECRET,
    nodeEnv: process.env.NODE_ENV,
    uploadsDir: path.resolve('uploads')
  });
});

app.listen(3456, () => {
  console.log('Test app running on port 3456');
});
