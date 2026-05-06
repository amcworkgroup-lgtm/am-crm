const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'amstore2024';

const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
[DATA_DIR, UPLOADS_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

const db = new Database(path.join(DATA_DIR, 'crm.db'));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + '_' + file.originalname.replace(/[^a-z0-9.]/gi, '_'))
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

db.exec(`
  CREATE TABLE IF NOT EXISTS repairs (
    id TEXT PRIMARY KEY, date_in TEXT, date_out TEXT, date_plan TEXT,
    client TEXT, phone TEXT, type TEXT, model TEXT, serial TEXT,
    password TEXT, kit TEXT, problem TEXT, color TEXT,
    status TEXT DEFAULT 'На діагностиці', master TEXT,
    cost REAL DEFAULT 0, price REAL DEFAULT 0,
    pay_status TEXT DEFAULT 'Не оплачено', pay_method TEXT,
    condition TEXT, notes TEXT, internal_notes TEXT,
    photos TEXT DEFAULT '[]', created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS masters (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE);
  CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS repair_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, repair_id TEXT, text TEXT, author TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT, category TEXT,
    description TEXT, amount REAL DEFAULT 0, repair_id TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS cash_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT, type TEXT,
    amount REAL, method TEXT DEFAULT 'Готівка', description TEXT,
    repair_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

['color','condition','internal_notes','photos TEXT DEFAULT "[]"'].forEach(col => {
  try { db.exec(`ALTER TABLE repairs ADD COLUMN ${col}`); } catch(e) {}
});

const mc = db.prepare('SELECT COUNT(*) as c FROM masters').get();
if (mc.c === 0) ['Іван','Олег','Марія','Сергій'].forEach(n => db.prepare('INSERT OR IGNORE INTO masters(name)VALUES(?)').run(n));

app.use(express.json());
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(path.join(__dirname, 'public')));

function auth(req, res, next) {
  const token = req.headers['x-auth-token'];
  if (!token) return res.status(401).json({ error: 'Не авторизовано' });
  if (!db.prepare('SELECT 1 FROM sessions WHERE token=?').get(token)) return res.status(401).json({ error: 'Сесія закінчилась' });
  next();
}

app.post('/api/login', (req, res) => {
  console.log('LOGIN attempt, ADMIN_PASSWORD:', ADMIN_PASSWORD, 'received:', req.body.password);
  if (req.body.password !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Невірний пароль' });
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(token)VALUES(?)').run(token);
  db.prepare("DELETE FROM sessions WHERE created_at < datetime('now','-7 days')").run();
  res.json({ token });
});
app.post('/api/logout', auth, (req, res) => { db.prepare('DELETE FROM sessions WHERE token=?').run(req.headers['x-auth-token']); res.json({ ok:true }); });

// REPAIRS
app.get('/api/repairs', auth, (req, res) => {
  const { status, search, master, date_from, date_to, sort, overdue } = req.query;
  let sql = 'SELECT * FROM repairs WHERE 1=1'; const p = [];
  if (status) { sql += ' AND status=?'; p.push(status); }
  if (overdue) { sql += " AND date_plan IS NOT NULL AND date_plan!='' AND date_plan < date('now') AND status NOT IN ('Видано','Готово')"; }
  if (master) { sql += ' AND master=?'; p.push(master); }
  if (search) { sql += ' AND (client LIKE ? OR phone LIKE ? OR id LIKE ? OR model LIKE ?)'; const s=`%${search}%`; p.push(s,s,s,s); }
  if (date_from) { sql += ' AND date_in>=?'; p.push(date_from); }
  if (date_to) { sql += ' AND date_in<=?'; p.push(date_to); }
  sql += ' ORDER BY ' + ({date:'date_in DESC',price:'price DESC',client:'client ASC',id:'id DESC'}[sort]||'created_at DESC');
  res.json(db.prepare(sql).all(...p));
});

app.post('/api/repairs', auth, (req, res) => {
  const r = req.body;
  const id = 'R' + String(Date.now()).slice(-5).padStart(5,'0');
  db.prepare(`INSERT INTO repairs(id,date_in,date_out,date_plan,client,phone,type,model,serial,password,kit,problem,color,status,master,cost,price,pay_status,pay_method,condition,notes,internal_notes,photos)VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id,r.date_in,r.date_out||null,r.date_plan||null,r.client,r.phone,r.type,r.model,
    r.serial||'',r.password||'',r.kit||'',r.problem||'',r.color||'',
    r.status||'На діагностиці',r.master||'',r.cost||0,r.price||0,
    r.pay_status||'Не оплачено',r.pay_method||'',r.condition||'',r.notes||'',r.internal_notes||'','[]'
  );
  res.json({ id });
});

app.put('/api/repairs/:id', auth, (req, res) => {
  const r = req.body;
  db.prepare(`UPDATE repairs SET date_in=?,date_out=?,date_plan=?,client=?,phone=?,type=?,model=?,serial=?,password=?,kit=?,problem=?,color=?,status=?,master=?,cost=?,price=?,pay_status=?,pay_method=?,condition=?,notes=?,internal_notes=? WHERE id=?`).run(
    r.date_in,r.date_out||null,r.date_plan||null,r.client,r.phone,r.type,r.model,
    r.serial||'',r.password||'',r.kit||'',r.problem||'',r.color||'',r.status,r.master||'',
    r.cost||0,r.price||0,r.pay_status,r.pay_method||'',r.condition||'',r.notes||'',r.internal_notes||'',req.params.id
  );
  res.json({ ok:true });
});

app.patch('/api/repairs/:id/status', auth, (req, res) => { db.prepare('UPDATE repairs SET status=? WHERE id=?').run(req.body.status, req.params.id); res.json({ ok:true }); });
app.patch('/api/repairs/:id/pay', auth, (req, res) => { db.prepare('UPDATE repairs SET pay_status=?,pay_method=? WHERE id=?').run(req.body.pay_status,req.body.pay_method||'',req.params.id); res.json({ ok:true }); });
app.patch('/api/repairs/:id/price', auth, (req, res) => { db.prepare('UPDATE repairs SET price=? WHERE id=?').run(req.body.price||0, req.params.id); res.json({ ok:true }); });
app.delete('/api/repairs/:id', auth, (req, res) => { db.prepare('DELETE FROM repairs WHERE id=?').run(req.params.id); db.prepare('DELETE FROM repair_comments WHERE repair_id=?').run(req.params.id); res.json({ ok:true }); });

// PHOTOS
app.post('/api/repairs/:id/photos', auth, upload.array('photos',10), (req, res) => {
  const rep = db.prepare('SELECT photos FROM repairs WHERE id=?').get(req.params.id);
  if (!rep) return res.status(404).json({ error:'Не знайдено' });
  const photos = JSON.parse(rep.photos||'[]');
  req.files.forEach(f => photos.push('/uploads/'+f.filename));
  db.prepare('UPDATE repairs SET photos=? WHERE id=?').run(JSON.stringify(photos), req.params.id);
  res.json({ photos });
});
app.delete('/api/repairs/:id/photos', auth, (req, res) => {
  const rep = db.prepare('SELECT photos FROM repairs WHERE id=?').get(req.params.id);
  const photos = JSON.parse(rep.photos||'[]').filter(p => p !== req.body.url);
  db.prepare('UPDATE repairs SET photos=? WHERE id=?').run(JSON.stringify(photos), req.params.id);
  try { fs.unlinkSync(path.join(UPLOADS_DIR, path.basename(req.body.url))); } catch(e) {}
  res.json({ photos });
});

// COMMENTS
app.get('/api/repairs/:id/comments', auth, (req, res) => res.json(db.prepare('SELECT * FROM repair_comments WHERE repair_id=? ORDER BY created_at ASC').all(req.params.id)));
app.post('/api/repairs/:id/comments', auth, (req, res) => { db.prepare('INSERT INTO repair_comments(repair_id,text,author)VALUES(?,?,?)').run(req.params.id,req.body.text,req.body.author||'Майстер'); res.json({ ok:true }); });
app.delete('/api/comments/:id', auth, (req, res) => { db.prepare('DELETE FROM repair_comments WHERE id=?').run(req.params.id); res.json({ ok:true }); });

// CLIENTS
app.get('/api/clients', auth, (req, res) => {
  const { search } = req.query;
  let sql = `SELECT client,phone,COUNT(*) as total,COALESCE(SUM(price),0) as total_price,MAX(date_in) as last_visit,COALESCE(SUM(CASE WHEN pay_status!='Оплачено' AND price>0 THEN price ELSE 0 END),0) as debt FROM repairs WHERE 1=1`;
  const p = [];
  if (search) { sql += ' AND (client LIKE ? OR phone LIKE ?)'; const s=`%${search}%`; p.push(s,s); }
  sql += ' GROUP BY phone ORDER BY last_visit DESC';
  res.json(db.prepare(sql).all(...p));
});
app.get('/api/clients/:phone/repairs', auth, (req, res) => res.json(db.prepare('SELECT * FROM repairs WHERE phone=? ORDER BY date_in DESC').all(req.params.phone)));

// EXPENSES
app.get('/api/expenses', auth, (req, res) => {
  const { date_from, date_to } = req.query;
  let sql = 'SELECT * FROM expenses WHERE 1=1'; const p = [];
  if (date_from) { sql += ' AND date>=?'; p.push(date_from); }
  if (date_to) { sql += ' AND date<=?'; p.push(date_to); }
  res.json(db.prepare(sql+' ORDER BY date DESC, created_at DESC').all(...p));
});
app.post('/api/expenses', auth, (req, res) => { const {date,category,description,amount,repair_id}=req.body; db.prepare('INSERT INTO expenses(date,category,description,amount,repair_id)VALUES(?,?,?,?,?)').run(date,category,description,amount||0,repair_id||null); res.json({ ok:true }); });
app.delete('/api/expenses/:id', auth, (req, res) => { db.prepare('DELETE FROM expenses WHERE id=?').run(req.params.id); res.json({ ok:true }); });

// CASH
app.get('/api/cash', auth, (req, res) => {
  const { date_from, date_to } = req.query;
  let sql = 'SELECT * FROM cash_log WHERE 1=1'; const p = [];
  if (date_from) { sql += ' AND date>=?'; p.push(date_from); }
  if (date_to) { sql += ' AND date<=?'; p.push(date_to); }
  const rows = db.prepare(sql+' ORDER BY date DESC, created_at DESC').all(...p);
  const cash = db.prepare("SELECT COALESCE(SUM(CASE WHEN type='in' THEN amount ELSE -amount END),0) as v FROM cash_log WHERE method='Готівка'").get().v;
  const card = db.prepare("SELECT COALESCE(SUM(CASE WHEN type='in' THEN amount ELSE -amount END),0) as v FROM cash_log WHERE method='Картка'").get().v;
  res.json({ rows, cash, card, total: cash+card });
});
app.post('/api/cash', auth, (req, res) => { const {date,type,amount,method,description,repair_id}=req.body; db.prepare('INSERT INTO cash_log(date,type,amount,method,description,repair_id)VALUES(?,?,?,?,?,?)').run(date,type,amount||0,method||'Готівка',description||'',repair_id||null); res.json({ ok:true }); });

// STATS
app.get('/api/stats', auth, (req, res) => {
  const active = db.prepare("SELECT COUNT(*) as c FROM repairs WHERE status!='Видано'").get().c;
  const total = db.prepare('SELECT COUNT(*) as c FROM repairs').get().c;
  const mRev = db.prepare(`SELECT COALESCE(SUM(price),0) as v FROM repairs WHERE strftime('%Y-%m',date_in)=strftime('%Y-%m','now')`).get().v;
  const mCost = db.prepare(`SELECT COALESCE(SUM(cost),0) as v FROM repairs WHERE strftime('%Y-%m',date_in)=strftime('%Y-%m','now')`).get().v;
  const mExp = db.prepare(`SELECT COALESCE(SUM(amount),0) as v FROM expenses WHERE strftime('%Y-%m',date)=strftime('%Y-%m','now')`).get().v;
  const debt = db.prepare(`SELECT COALESCE(SUM(price),0) as v FROM repairs WHERE pay_status!='Оплачено' AND price>0`).get().v;
  const overdue = db.prepare(`SELECT COUNT(*) as c FROM repairs WHERE date_plan < date('now') AND status NOT IN ('Готово','Видано')`).get().c;
  const cash = db.prepare("SELECT COALESCE(SUM(CASE WHEN type='in' THEN amount ELSE -amount END),0) as v FROM cash_log WHERE method='Готівка'").get().v;
  const card = db.prepare("SELECT COALESCE(SUM(CASE WHEN type='in' THEN amount ELSE -amount END),0) as v FROM cash_log WHERE method='Картка'").get().v;
  const monthly = db.prepare(`SELECT strftime('%Y-%m',date_in) as month,COUNT(*) as count,COALESCE(SUM(price),0) as revenue,COALESCE(SUM(cost),0) as cost,COALESCE(SUM(price-cost),0) as profit FROM repairs GROUP BY month ORDER BY month DESC LIMIT 8`).all();
  const byStatus = db.prepare('SELECT status,COUNT(*) as c FROM repairs GROUP BY status').all();
  const byMaster = db.prepare(`SELECT master,COUNT(*) as c,COALESCE(SUM(price-cost),0) as profit FROM repairs WHERE master!='' GROUP BY master ORDER BY profit DESC`).all();
  res.json({ active,total,monthRevenue:mRev,monthCost:mCost,monthExpenses:mExp,monthProfit:mRev-mCost-mExp,debt,overdue,cashBalance:cash,cardBalance:card,monthly,byStatus,byMaster });
});

// SETTINGS
db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);`);
const DEFAULT_SETTINGS = {
  shop_name: 'AM Store',
  shop_phone: '073 477 30 90',
  shop_address: 'Черкаси, ТРЦ Хрещатик',
  shop_telegram: '@amadze',
  warranty_days: '30',
  accent_color: '#e8580a',
  msg_ready: 'Вітаємо! Ваш {type} {model} готовий до видачі. Вартість ремонту: {price} ₴. Чекаємо вас! {shop_name}, тел. {phone}',
  msg_accept: 'Вітаємо, {client}! Ваш {type} {model} прийнятий на діагностику (замовлення {id}). Повідомимо про результат найближчим часом. {shop_name}',
  msg_debt: 'Нагадуємо про оплату за ремонт {id} ({type} {model}) — {price} ₴. Будь ласка, завітайте до нас. {shop_name}',
  msg_overdue: 'Нагадуємо! Ваш {type} {model} (замовлення {id}) очікує вас вже {days} днів. Будь ласка, заберіть пристрій. {shop_name}, тел. {phone}',
  master_rate: '40',
};
Object.entries(DEFAULT_SETTINGS).forEach(([k,v]) => {
  try { db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)').run(k,v); } catch(e){}
});

app.get('/api/settings', auth, (req, res) => {
  const rows = db.prepare('SELECT key,value FROM settings').all();
  const obj = {};
  rows.forEach(r => obj[r.key] = r.value);
  res.json(obj);
});
app.put('/api/settings', auth, (req, res) => {
  const stmt = db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)');
  Object.entries(req.body).forEach(([k,v]) => stmt.run(k, String(v)));
  res.json({ ok: true });
});

// CHANGE PASSWORD
app.post('/api/change-password', auth, (req, res) => {
  const { current, newPass } = req.body;
  const stored = process.env.ADMIN_PASSWORD || 'amstore2024';
  if (current !== stored) return res.status(403).json({ error: 'Невірний поточний пароль' });
  // Write to .env file
  const fs = require('fs');
  const envPath = require('path').join(__dirname, '.env');
  try {
    let env = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    if (env.includes('ADMIN_PASSWORD=')) {
      env = env.replace(/ADMIN_PASSWORD=.*/g, `ADMIN_PASSWORD=${newPass}`);
    } else {
      env += `\nADMIN_PASSWORD=${newPass}`;
    }
    fs.writeFileSync(envPath, env);
    process.env.ADMIN_PASSWORD = newPass;
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Не вдалось зберегти' }); }
});

// BACKUP
app.get('/api/backup', auth, (req, res) => {
  const dbPath = require('path').join(__dirname, 'data', 'crm.db');
  const date = new Date().toISOString().slice(0,10);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename=crm_backup_${date}.db`);
  res.sendFile(dbPath);
});

// MASTERS
app.get('/api/masters', auth, (req, res) => res.json(db.prepare('SELECT * FROM masters ORDER BY name').all()));
app.post('/api/masters', auth, (req, res) => { try { db.prepare('INSERT INTO masters(name)VALUES(?)').run(req.body.name); res.json({ ok:true }); } catch(e) { res.status(400).json({ error:'Вже існує' }); } });
app.delete('/api/masters/:id', auth, (req, res) => { db.prepare('DELETE FROM masters WHERE id=?').run(req.params.id); res.json({ ok:true }); });

// EXPORT
app.get('/api/export/repairs', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM repairs ORDER BY date_in DESC').all();
  const csv = ['ID,Дата,Клієнт,Телефон,Тип,Модель,Статус,Майстер,Ціна,Оплата'].concat(
    rows.map(r => [r.id,r.date_in,r.client,r.phone,r.type,r.model,r.status,r.master,r.price,r.pay_status].map(v=>`"${v||''}"`).join(','))
  ).join('\n');
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition','attachment; filename=repairs.csv');
  res.send('\uFEFF'+csv);
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => { console.log(`AM Store CRM → http://localhost:${PORT}`); });
