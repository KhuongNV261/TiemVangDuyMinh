const express = require('express');
const session = require('cookie-session');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const isVercel = process.env.VERCEL === '1' || process.env.VERCEL_URL;
const DATA_FILE = isVercel ? path.join('/tmp', 'data.json') : path.join(__dirname, 'data.json');

// ─── Database (Postgres / Redis) – dùng để lưu dữ liệu vĩnh viễn ─────────────
let redis = null;
let pgClient = null;

try {
  const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  const pgUrl = process.env.POSTGRES_URL;

  if (pgUrl) {
    const { Client } = require('pg');
    pgClient = new Client({ connectionString: pgUrl, ssl: { rejectUnauthorized: false } });
    pgClient.connect().then(() => {
      return pgClient.query(`
        CREATE TABLE IF NOT EXISTS gold_store (
          key VARCHAR(50) PRIMARY KEY,
          data JSONB
        )
      `);
    }).then(() => console.log('✅ Dùng Postgres Database (Neon)'))
      .catch(e => console.log('⚠️ Lỗi kết nối Postgres:', e.message));
  } else if (redisUrl && redisToken) {
    const { Redis } = require('@upstash/redis');
    redis = new Redis({
      url: redisUrl,
      token: redisToken,
    });
    console.log('✅ Dùng Redis Database để lưu dữ liệu vĩnh viễn');
  } else {
    console.log('📁 Dùng file data.json (local)');
  }
} catch (e) {
  console.warn('⚠️  Database không khả dụng, dùng file:', e.message);
}

// ─── Default data ─────────────────────────────────────────────────────────────
const DEFAULT_DATA = {
  password: '$2a$10$MRexv1PyHXayPxFUU6Akhuvui9ps7ekp0xlFm.aX9wwtgoy83pvwO',
  ticker: '🏅 DNTN Vàng Bạc Trang Sức Duy Mịnh ◆ Địa chỉ: 242 Triệu Việt Vương, Giao Ninh, Ninh Bình ◆ Hotline: 0915 541 933 ◆ Mua bán vàng nguyên liệu · Trang sức ◆ Giá cập nhật liên tục mỗi ngày',
  goldItems: [
    { id: 1, name: 'VÀNG 99.9', buyPrice: 13750, sellPrice: 14000, enabled: true },
    { id: 2, name: 'VÀNG 610',  buyPrice: 0,     sellPrice: 0,     enabled: false },
    { id: 3, name: 'VÀNG 10K',  buyPrice: 0,     sellPrice: 0,     enabled: false },
    { id: 4, name: 'BẠC',       buyPrice: 0,     sellPrice: 0,     enabled: false }
  ],
  lastUpdated: new Date().toISOString()
};

// ─── Data helpers (async, hỗ trợ cả Redis lẫn file) ─────────────────────────
async function readData() {
  try {
    if (pgClient) {
      const res = await pgClient.query("SELECT data FROM gold_store WHERE key = 'gold:data'");
      if (res.rows.length > 0) return res.rows[0].data;
      return DEFAULT_DATA;
    }
    if (redis) {
      const d = await redis.get('gold:data');
      return d || DEFAULT_DATA;
    }
    if (isVercel && !fs.existsSync(DATA_FILE)) {
      const initialPath = path.join(__dirname, 'data.json');
      if (fs.existsSync(initialPath)) {
        return JSON.parse(fs.readFileSync(initialPath, 'utf8'));
      }
    }
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { ...DEFAULT_DATA };
  }
}

async function writeData(data) {
  if (pgClient) {
    await pgClient.query(
      `INSERT INTO gold_store (key, data) VALUES ('gold:data', $1) 
       ON CONFLICT (key) DO UPDATE SET data = $1`,
      [data]
    );
  } else if (redis) {
    await redis.set('gold:data', data);
  } else {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  }
}

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  name: 'session',
  secret: process.env.SESSION_SECRET || 'vangbacduyminh-secret-key-2026',
  maxAge: 1000 * 60 * 60 * 8
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Quá nhiều lần đăng nhập. Thử lại sau 15 phút.' }
});

function requireAuth(req, res, next) {
  if (req.session?.authenticated) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// ─── Public API ───────────────────────────────────────────────────────────────
app.get('/api/prices', async (req, res) => {
  const data = await readData();
  res.json({
    items: data.goldItems.filter(i => i.enabled),
    ticker: data.ticker || '',
    lastUpdated: data.lastUpdated
  });
});

// ─── Auth ─────────────────────────────────────────────────────────────────────
app.post('/api/login', loginLimiter, async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Vui lòng nhập mật khẩu.' });
  const data = await readData();
  const ok = await bcrypt.compare(password, data.password);
  if (ok) {
    req.session.authenticated = true;
    res.json({ success: true, message: 'Đăng nhập thành công!' });
  } else {
    res.status(401).json({ error: 'Mật khẩu không đúng.' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session = null;
  res.json({ success: true });
});

app.get('/api/auth/check', (req, res) => {
  res.json({ authenticated: !!req.session?.authenticated });
});

// ─── Admin API ────────────────────────────────────────────────────────────────
app.get('/api/admin/items', requireAuth, async (req, res) => {
  const data = await readData();
  res.json({ items: data.goldItems, lastUpdated: data.lastUpdated });
});

app.put('/api/admin/items', requireAuth, async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items)) return res.status(400).json({ error: 'Dữ liệu không hợp lệ.' });
    const data = await readData();
    data.goldItems = items;
    data.lastUpdated = new Date().toISOString();
    await writeData(data);
    res.json({ success: true });
  } catch (error) {
    console.error('Lỗi khi lưu items:', error);
    res.status(500).json({ error: 'Lỗi máy chủ khi lưu. Nếu dùng Vercel, hãy cấu hình Upstash Redis.' });
  }
});

app.get('/api/admin/ticker', requireAuth, async (req, res) => {
  const data = await readData();
  res.json({ ticker: data.ticker || '' });
});

app.put('/api/admin/ticker', requireAuth, async (req, res) => {
  try {
    const { ticker } = req.body;
    if (typeof ticker !== 'string') return res.status(400).json({ error: 'Nội dung không hợp lệ.' });
    const data = await readData();
    data.ticker = ticker.trim();
    data.lastUpdated = new Date().toISOString();
    await writeData(data);
    res.json({ success: true });
  } catch (error) {
    console.error('Lỗi khi lưu ticker:', error);
    res.status(500).json({ error: 'Lỗi máy chủ khi lưu. Nếu dùng Vercel, hãy cấu hình Upstash Redis.' });
  }
});

app.post('/api/admin/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Vui lòng điền đầy đủ.' });
    if (newPassword.length < 4) return res.status(400).json({ error: 'Mật khẩu mới phải ít nhất 4 ký tự.' });
    const data = await readData();
    const ok = await bcrypt.compare(currentPassword, data.password);
    if (!ok) return res.status(401).json({ error: 'Mật khẩu hiện tại không đúng.' });
    data.password = await bcrypt.hash(newPassword, 10);
    await writeData(data);
    res.json({ success: true, message: 'Đổi mật khẩu thành công!' });
  } catch (error) {
    console.error('Lỗi khi đổi mật khẩu:', error);
    res.status(500).json({ error: 'Lỗi khi lưu mật khẩu.' });
  }
});

// ─── Deploy ───────────────────────────────────────────────────────────────────
app.post('/api/admin/deploy', requireAuth, async (req, res) => {
  const hookUrl = process.env.VERCEL_DEPLOY_HOOK;
  if (!hookUrl) {
    return res.status(400).json({ error: 'Chưa cấu hình VERCEL_DEPLOY_HOOK trong biến môi trường.' });
  }
  try {
    const response = await fetch(hookUrl, { method: 'POST' });
    if (!response.ok) throw new Error('Hook failed');
    res.json({ success: true, message: 'Đã gửi lệnh Deploy lên Vercel!' });
  } catch (error) {
    console.error('Lỗi khi gọi deploy hook:', error);
    res.status(500).json({ error: 'Không thể gọi Deploy Hook. Kiểm tra lại URL.' });
  }
});

// ─── Pages ────────────────────────────────────────────────────────────────────
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ─── Start ────────────────────────────────────────────────────────────────────
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✅ Server: http://localhost:${PORT}`);
    console.log(`🔑 Mật khẩu: admin123`);
  });
}

module.exports = app;
