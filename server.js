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

  CREATE TABLE IF NOT EXISTS parts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT DEFAULT '',
    compatible TEXT DEFAULT '',
    qty INTEGER DEFAULT 0,
    min_qty INTEGER DEFAULT 1,
    buy_price REAL DEFAULT 0,
    sell_price REAL DEFAULT 0,
    supplier TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS stock_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    part_id INTEGER,
    date TEXT DEFAULT CURRENT_TIMESTAMP,
    type TEXT,
    qty INTEGER DEFAULT 0,
    note TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    user TEXT DEFAULT 'Адмін',
    action TEXT,
    entity_type TEXT,
    entity_id TEXT,
    old_value TEXT DEFAULT '',
    new_value TEXT DEFAULT '',
    note TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS repair_parts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repair_id TEXT NOT NULL,
    part_id INTEGER NOT NULL,
    part_name TEXT NOT NULL,
    qty REAL DEFAULT 1,
    unit_cost REAL DEFAULT 0,
    unit_price REAL DEFAULT 0,
    total_cost REAL DEFAULT 0,
    total_price REAL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

['color','condition','internal_notes','photos TEXT DEFAULT "[]"'].forEach(col => {
  try { db.exec(`ALTER TABLE repairs ADD COLUMN ${col}`); } catch(e) {}
});

// TOTAL COST SYSTEM — ручна собівартість + запчастини зі складу
['additional_cost REAL DEFAULT 0','parts_cost REAL DEFAULT 0','parts_price REAL DEFAULT 0'].forEach(col => {
  try { db.exec(`ALTER TABLE repairs ADD COLUMN ${col}`); } catch(e) {}
});
try {
  db.exec(`
    UPDATE repairs
    SET
      parts_cost = COALESCE((SELECT SUM(total_cost) FROM repair_parts WHERE repair_id=repairs.id),0),
      parts_price = COALESCE((SELECT SUM(total_price) FROM repair_parts WHERE repair_id=repairs.id),0);
    UPDATE repairs
    SET additional_cost = CASE
      WHEN COALESCE(additional_cost,0)=0 THEN MAX(COALESCE(cost,0) - COALESCE(parts_cost,0), 0)
      ELSE additional_cost
    END;
    UPDATE repairs SET cost = COALESCE(additional_cost,0) + COALESCE(parts_cost,0);
  `);
} catch(e) {}

const mc = db.prepare('SELECT COUNT(*) as c FROM masters').get();
if (mc.c === 0) ['Іван','Олег','Марія','Сергій'].forEach(n => db.prepare('INSERT OR IGNORE INTO masters(name)VALUES(?)').run(n));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(path.join(__dirname, 'public')));

function auth(req, res, next) {
  const token = req.headers['x-auth-token'];
  if (!token) return res.status(401).json({ error: 'Не авторизовано' });
  if (!db.prepare('SELECT 1 FROM sessions WHERE token=?').get(token)) return res.status(401).json({ error: 'Сесія закінчилась' });
  next();
}

function logActivity(action, entityType, entityId, oldValue='', newValue='', note='') {
  try {
    db.prepare(`INSERT INTO activity_log(user,action,entity_type,entity_id,old_value,new_value,note) VALUES(?,?,?,?,?,?,?)`)
      .run('Адмін', action || '', entityType || '', String(entityId || ''), oldValue ? String(oldValue) : '', newValue ? String(newValue) : '', note ? String(note) : '');
  } catch(e) {}
}

app.get('/api/activity', auth, (req, res) => {
  const { search, type, date_from, date_to } = req.query;
  let sql = 'SELECT * FROM activity_log WHERE 1=1'; const p = [];
  if(type){ sql += ' AND entity_type=?'; p.push(type); }
  if(date_from){ sql += ' AND date(created_at)>=?'; p.push(date_from); }
  if(date_to){ sql += ' AND date(created_at)<=?'; p.push(date_to); }
  if(search){ sql += ' AND (action LIKE ? OR entity_type LIKE ? OR entity_id LIKE ? OR old_value LIKE ? OR new_value LIKE ? OR note LIKE ?)'; const q='%'+search+'%'; p.push(q,q,q,q,q,q); }
  sql += ' ORDER BY id DESC LIMIT 500';
  res.json(db.prepare(sql).all(...p));
});

app.post('/api/login', (req, res) => {
  if (req.body.password !== ADMIN_PASSWORD) { logActivity('Помилка входу', 'auth', '', '', '', 'Невірний пароль'); return res.status(403).json({ error: 'Невірний пароль' }); }
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(token)VALUES(?)').run(token);
  db.prepare("DELETE FROM sessions WHERE created_at < datetime('now','-7 days')").run();
  logActivity('Вхід у CRM', 'auth', 'login');
  res.json({ token, role:'admin' });
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
  const additionalCost = Number(r.additional_cost ?? r.cost ?? 0);
  db.prepare(`INSERT INTO repairs(id,date_in,date_out,date_plan,client,phone,type,model,serial,password,kit,problem,color,status,master,cost,price,pay_status,pay_method,condition,notes,internal_notes,photos)VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id,r.date_in,r.date_out||null,r.date_plan||null,r.client,r.phone,r.type,r.model,
    r.serial||'',r.password||'',r.kit||'',r.problem||'',r.color||'',
    r.status||'На діагностиці',r.master||'',additionalCost,r.price||0,
    r.pay_status||'Не оплачено',r.pay_method||'',r.condition||'',r.notes||'',r.internal_notes||'','[]'
  );
  db.prepare('UPDATE repairs SET additional_cost=? WHERE id=?').run(additionalCost, id);
  recalcRepairTotals(id);
  logActivity('Створено ремонт', 'repair', id, '', `${r.client||''} ${r.type||''} ${r.model||''}`.trim());
  res.json({ id });
});

app.put('/api/repairs/:id', auth, (req, res) => {
  const r = req.body;
  const old = db.prepare('SELECT * FROM repairs WHERE id=?').get(req.params.id);
  db.prepare(`UPDATE repairs SET date_in=?,date_out=?,date_plan=?,client=?,phone=?,type=?,model=?,serial=?,password=?,kit=?,problem=?,color=?,status=?,master=?,cost=?,price=?,pay_status=?,pay_method=?,condition=?,notes=?,internal_notes=? WHERE id=?`).run(
    r.date_in,r.date_out||null,r.date_plan||null,r.client,r.phone,r.type,r.model,
    r.serial||'',r.password||'',r.kit||'',r.problem||'',r.color||'',r.status,r.master||'',
    Number(r.additional_cost ?? r.cost ?? 0),r.price||0,r.pay_status,r.pay_method||'',r.condition||'',r.notes||'',r.internal_notes||'',req.params.id
  );
  db.prepare('UPDATE repairs SET additional_cost=? WHERE id=?').run(Number(r.additional_cost ?? r.cost ?? 0), req.params.id);
  recalcRepairTotals(req.params.id);
  const changes = [];
  if(old){ ['status','master','price','pay_status','pay_method','client','phone','model'].forEach(k=>{ if(String(old[k]||'') !== String(r[k]||'')) changes.push(`${k}: ${old[k]||'—'} → ${r[k]||'—'}`); }); }
  if(changes.length) logActivity('Оновлено ремонт', 'repair', req.params.id, '', '', changes.join('; '));
  // Автозапис в касу якщо оплата щойно стала "Оплачено"
  if(old && r.pay_status === 'Оплачено' && old.pay_status !== 'Оплачено' && r.price > 0){
    const method = r.pay_method || 'Готівка';
    const date = new Date().toISOString().slice(0,10);
    db.prepare("INSERT INTO cash_log(date,type,amount,method,description) VALUES(?,?,?,?,?)").run(
      date, 'in', r.price, method, `Оплата ${req.params.id} (${r.type} ${r.model})`
    );
  }
  res.json({ ok:true });
});

app.patch('/api/repairs/:id/status', auth, (req, res) => { const old=db.prepare('SELECT status FROM repairs WHERE id=?').get(req.params.id); db.prepare('UPDATE repairs SET status=? WHERE id=?').run(req.body.status, req.params.id); logActivity('Змінено статус', 'repair', req.params.id, old?old.status:'', req.body.status||''); res.json({ ok:true }); });
app.patch('/api/repairs/:id/pay', auth, (req, res) => {
  const repair = db.prepare('SELECT * FROM repairs WHERE id=?').get(req.params.id);
  if(!repair) return res.status(404).json({error:'Not found'});
  const pay_status = req.body.pay_status || repair.pay_status || 'Не оплачено';
  const pay_method = req.body.pay_method !== undefined ? req.body.pay_method : (repair.pay_method || '');
  db.prepare('UPDATE repairs SET pay_status=?,pay_method=? WHERE id=?').run(pay_status, pay_method||'', req.params.id);
  if(String(repair.pay_status||'')!==String(pay_status||'') || String(repair.pay_method||'')!==String(pay_method||'')) logActivity('Змінено оплату', 'repair', req.params.id, `${repair.pay_status||'—'} / ${repair.pay_method||'—'}`, `${pay_status||'—'} / ${pay_method||'—'}`);
  // Автозапис в касу при оплаті
  if(pay_status === 'Оплачено' && repair.pay_status !== 'Оплачено' && repair.price > 0){
    const method = pay_method || repair.pay_method || 'Готівка';
    const date = new Date().toISOString().slice(0,10);
    db.prepare("INSERT INTO cash_log(date,type,amount,method,description) VALUES(?,?,?,?,?)").run(
      date, 'in', repair.price, method, `Оплата ${repair.id} (${repair.type} ${repair.model})`
    );
  }
  res.json({ ok:true });
});
app.patch('/api/repairs/:id/price', auth, (req, res) => { const old=db.prepare('SELECT price FROM repairs WHERE id=?').get(req.params.id); db.prepare('UPDATE repairs SET price=? WHERE id=?').run(req.body.price||0, req.params.id); logActivity('Змінено ціну', 'repair', req.params.id, old?old.price:'', req.body.price||0); res.json({ ok:true }); });
app.delete('/api/repairs/:id', auth, (req, res) => { const old=db.prepare('SELECT * FROM repairs WHERE id=?').get(req.params.id); db.prepare('DELETE FROM repairs WHERE id=?').run(req.params.id); db.prepare('DELETE FROM repair_comments WHERE repair_id=?').run(req.params.id); logActivity('Видалено ремонт', 'repair', req.params.id, old?`${old.client||''} ${old.type||''} ${old.model||''}`:'', ''); res.json({ ok:true }); });

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
app.post('/api/cash', auth, (req, res) => { const {date,type,amount,method,description,repair_id}=req.body; const info=db.prepare('INSERT INTO cash_log(date,type,amount,method,description,repair_id)VALUES(?,?,?,?,?,?)').run(date,type,amount||0,method||'Готівка',description||'',repair_id||null); logActivity('Додано касовий запис', 'cash', info.lastInsertRowid, '', `${type} ${amount||0} ${method||'Готівка'} ${description||''}`); res.json({ ok:true }); });

app.delete('/api/cash/:id', auth, (req, res) => {
  const { admin_password } = req.body || {};
  if (admin_password !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Видалення доступне тільки адміну' });
  const row = db.prepare('SELECT * FROM cash_log WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Запис каси не знайдено' });
  db.prepare('DELETE FROM cash_log WHERE id=?').run(req.params.id);
  logActivity('Видалено касовий запис', 'cash', req.params.id, row?`${row.type} ${row.amount} ${row.method} ${row.description||''}`:'', '');
  res.json({ ok:true });
});

// STATS
app.get('/api/stats', auth, (req, res) => {
  const repairs = db.prepare('SELECT * FROM repairs ORDER BY created_at DESC').all();
  const expenses = db.prepare('SELECT * FROM expenses ORDER BY date DESC').all();
  const cashRows = db.prepare('SELECT * FROM cash_log ORDER BY date DESC, created_at DESC').all();

  const today = new Date().toISOString().slice(0,10);
  const monthNow = today.slice(0,7);
  const money = v => Number(v || 0);
  const repairDate = r => (r.date_in && String(r.date_in).slice(0,10)) || (r.created_at && String(r.created_at).slice(0,10)) || today;
  const repairMonth = r => repairDate(r).slice(0,7);
  const isPaid = r => r.pay_status === 'Оплачено';
  const isIssued = r => r.status === 'Видано';
  const isReady = r => r.status === 'Готово';
  const isRefusal = r => ['Відмова','Отказ','Відмовився'].includes(r.status);

  const total = repairs.length;
  const active = repairs.filter(r => !isIssued(r) && !isRefusal(r)).length;
  const todayAccepted = repairs.filter(r => repairDate(r) === today).length;
  const ready = repairs.filter(isReady).length;
  const inWork = repairs.filter(r => ['В ремонті','В роботі','На діагностиці','Діагностика','Очікує запчастину'].includes(r.status)).length;
  const refusals = repairs.filter(isRefusal).length;
  const overdue = repairs.filter(r => r.date_plan && r.date_plan < today && !['Готово','Видано','Відмова','Отказ'].includes(r.status)).length;
  const notPicked = repairs.filter(r => isReady(r)).length;

  const paidMonth = repairs.filter(r => isPaid(r) && repairMonth(r) === monthNow);
  const mRev = paidMonth.reduce((s,r)=>s+money(r.price),0);
  const mCost = paidMonth.reduce((s,r)=>s+money(r.cost),0);
  const mExp = expenses.filter(e => (e.date||'').slice(0,7) === monthNow).reduce((s,e)=>s+money(e.amount),0);
  const debt = repairs.filter(r => r.pay_status !== 'Оплачено' && money(r.price)>0).reduce((s,r)=>s+money(r.price),0);
  const cash = cashRows.filter(c => c.method === 'Готівка').reduce((s,c)=>s+(c.type==='in'?money(c.amount):-money(c.amount)),0);
  const card = cashRows.filter(c => ['Картка','Переказ','Безготівка'].includes(c.method)).reduce((s,c)=>s+(c.type==='in'?money(c.amount):-money(c.amount)),0);

  const months = [];
  const now = new Date();
  for(let i=11;i>=0;i--){
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    months.push(d.toISOString().slice(0,7));
  }
  const monthly = months.map(month => {
    const mr = repairs.filter(r => repairMonth(r) === month);
    const paid = mr.filter(isPaid);
    const exp = expenses.filter(e => (e.date||'').slice(0,7) === month).reduce((s,e)=>s+money(e.amount),0);
    const revenue = paid.reduce((s,r)=>s+money(r.price),0);
    const cost = paid.reduce((s,r)=>s+money(r.cost),0);
    return { month, count: mr.length, paidCount: paid.length, revenue, cost, expenses: exp, profit: revenue - cost - exp };
  }).reverse();

  const group = (arr, keyFn, valueFn) => {
    const m = new Map();
    arr.forEach(x => {
      const k = keyFn(x) || 'Інше';
      if(!m.has(k)) m.set(k, valueFn ? {c:0, revenue:0, profit:0} : 0);
      if(valueFn){
        const o = m.get(k); const v = valueFn(x);
        o.c += 1; o.revenue += v.revenue || 0; o.profit += v.profit || 0;
      } else m.set(k, m.get(k)+1);
    });
    return [...m.entries()];
  };

  const byStatus = group(repairs, r => r.status || 'Без статусу').map(([status,c])=>({status,c}));
  const byType = group(repairs, r => r.type || 'Інше').map(([type,c])=>({type,c})).sort((a,b)=>b.c-a.c);
  const byMaster = group(repairs.filter(r => r.master), r => r.master, r => ({
    revenue: isPaid(r) ? money(r.price) : 0,
    profit: isPaid(r) ? money(r.price)-money(r.cost) : 0
  })).map(([master,d])=>({master,c:d.c,revenue:d.revenue,profit:d.profit})).sort((a,b)=>b.profit-a.profit);

  res.json({
    active,total,todayAccepted,inWork,ready,notPicked,refusals,
    monthRevenue:mRev,monthCost:mCost,monthExpenses:mExp,monthProfit:mRev-mCost-mExp,
    debt,overdue,cashBalance:cash,cardBalance:card,
    monthly,byStatus,byType,byMaster,
    lastRepairs: repairs.slice(0,8),
    overdueRepairs: repairs.filter(r => r.date_plan && r.date_plan < today && !['Готово','Видано','Відмова','Отказ'].includes(r.status)).slice(0,8)
  });
});



function csvEscape(v){
  v = v === null || v === undefined ? '' : String(v);
  return '"' + v.replace(/"/g,'""') + '"';
}
function parseCsvLine(line){
  const out=[]; let cur='', q=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(ch==='"'){
      if(q && line[i+1]==='"'){cur+='"'; i++;}
      else q=!q;
    }else if(ch===',' && !q){out.push(cur); cur='';}
    else cur+=ch;
  }
  out.push(cur);
  return out;
}
function parseCsv(text){
  text = String(text||'').replace(/^\uFEFF/, '').replace(/\r\n/g,'\n').replace(/\r/g,'\n');
  const lines = text.split('\n').filter(l=>l.trim().length);
  if(!lines.length) return [];
  const headers = parseCsvLine(lines.shift()).map(h=>h.trim());
  return lines.map(line=>{
    const vals=parseCsvLine(line);
    const obj={}; headers.forEach((h,i)=>obj[h]=vals[i]!==undefined?vals[i].trim():'');
    return obj;
  });
}
// SETTINGS
db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);`);
db.exec(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, login TEXT UNIQUE, password TEXT, role TEXT DEFAULT 'manager', active INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP);`);
try { db.prepare('INSERT OR IGNORE INTO users(name,login,password,role,active) VALUES(?,?,?,?,?)').run('Адмін','admin',ADMIN_PASSWORD,'admin',1); } catch(e) {}
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


// USERS (settings only; без прив'язки до майстра)
app.get('/api/users', auth, (req, res) => {
  const rows = db.prepare('SELECT id,name,login,role,active,created_at FROM users ORDER BY id DESC').all();
  res.json(rows);
});
app.post('/api/users', auth, (req, res) => {
  const { name, login, password, role, active } = req.body;
  if(!login || !password) return res.status(400).json({ error: 'Логін і пароль обов’язкові' });
  try {
    db.prepare('INSERT INTO users(name,login,password,role,active) VALUES(?,?,?,?,?)').run(name||login, login, password, role||'manager', active===0?0:1);
    res.json({ ok:true });
  } catch(e) { res.status(400).json({ error: 'Такий логін вже існує' }); }
});
app.put('/api/users/:id', auth, (req, res) => {
  const { name, login, password, role, active } = req.body;
  const old = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if(!old) return res.status(404).json({ error:'Користувача не знайдено' });
  try {
    db.prepare('UPDATE users SET name=?, login=?, password=?, role=?, active=? WHERE id=?').run(name||login, login, password || old.password, role||old.role, active===0?0:1, req.params.id);
    res.json({ ok:true });
  } catch(e) { res.status(400).json({ error: 'Такий логін вже існує' }); }
});
app.delete('/api/users/:id', auth, (req, res) => {
  db.prepare('DELETE FROM users WHERE id=?').run(req.params.id);
  res.json({ ok:true });
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



// REPAIR PARTS — прив'язка запчастин до ремонту
function recalcRepairTotals(repairId){
  const sums = db.prepare('SELECT COALESCE(SUM(total_cost),0) AS partsCost, COALESCE(SUM(total_price),0) AS partsPrice FROM repair_parts WHERE repair_id=?').get(repairId);
  const repair = db.prepare('SELECT price, additional_cost FROM repairs WHERE id=?').get(repairId) || { price: 0, additional_cost: 0 };
  const partsCost = Number(sums.partsCost || 0);
  const partsPrice = Number(sums.partsPrice || 0);
  const additionalCost = Number(repair.additional_cost || 0);
  const totalCost = partsCost + additionalCost;
  const price = Number(repair.price || 0);
  db.prepare('UPDATE repairs SET parts_cost=?, parts_price=?, cost=? WHERE id=?').run(partsCost, partsPrice, totalCost, repairId);
  return { cost: totalCost, partsCost, partsPrice, additionalCost, price, profit: price - totalCost };
}
function recalcRepairCost(repairId){
  return recalcRepairTotals(repairId).cost;
}

app.get('/api/repairs/:id/parts', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM repair_parts WHERE repair_id=? ORDER BY created_at DESC, id DESC').all(req.params.id);
  res.json(rows);
});

app.post('/api/repairs/:id/parts', auth, (req, res) => {
  const repair = db.prepare('SELECT * FROM repairs WHERE id=?').get(req.params.id);
  if(!repair) return res.status(404).json({ error:'Ремонт не знайдено' });

  const partId = Number(req.body.part_id || 0);
  const qty = Number(req.body.qty || 1);
  if(!partId || qty <= 0) return res.status(400).json({ error:'Оберіть запчастину і кількість' });

  const part = db.prepare('SELECT * FROM parts WHERE id=?').get(partId);
  if(!part) return res.status(404).json({ error:'Запчастину не знайдено' });
  if(Number(part.qty||0) < qty) return res.status(400).json({ error:`Недостатньо на складі. Доступно: ${part.qty||0}` });

  const unitCost = Number(part.buy_price || 0);
  const unitPrice = Number(req.body.unit_price ?? part.sell_price ?? 0);
  const totalCost = unitCost * qty;
  const totalPrice = unitPrice * qty;

  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO repair_parts(repair_id,part_id,part_name,qty,unit_cost,unit_price,total_cost,total_price)
      VALUES(?,?,?,?,?,?,?,?)`).run(req.params.id, part.id, part.name, qty, unitCost, unitPrice, totalCost, totalPrice);

    db.prepare('UPDATE parts SET qty=qty-? WHERE id=?').run(qty, part.id);
    db.prepare('INSERT INTO stock_movements(part_id,type,qty,note) VALUES(?,?,?,?)')
      .run(part.id, 'out', qty, `Списано на ремонт ${req.params.id}`);

    db.prepare('UPDATE repairs SET price=COALESCE(price,0)+? WHERE id=?').run(totalPrice, req.params.id);
    recalcRepairTotals(req.params.id);
  });
  tx();

  res.json({ ok:true, ...recalcRepairTotals(req.params.id) });
});

app.delete('/api/repairs/:repairId/parts/:rowId', auth, (req, res) => {
  const row = db.prepare('SELECT * FROM repair_parts WHERE id=? AND repair_id=?').get(req.params.rowId, req.params.repairId);
  if(!row) return res.status(404).json({ error:'Запис не знайдено' });

  const tx = db.transaction(() => {
    db.prepare('UPDATE parts SET qty=qty+? WHERE id=?').run(Number(row.qty||0), row.part_id);
    db.prepare('INSERT INTO stock_movements(part_id,type,qty,note) VALUES(?,?,?,?)')
      .run(row.part_id, 'in', Number(row.qty||0), `Повернення зі списання ремонту ${req.params.repairId}`);
    db.prepare('DELETE FROM repair_parts WHERE id=?').run(req.params.rowId);
    db.prepare('UPDATE repairs SET price=MAX(COALESCE(price,0)-?,0) WHERE id=?').run(Number(row.total_price||0), req.params.repairId);
    recalcRepairTotals(req.params.repairId);
  });
  tx();

  res.json({ ok:true, ...recalcRepairTotals(req.params.repairId) });
});

// WAREHOUSE / PARTS

// PARTS CSV IMPORT / EXPORT
app.get('/api/parts/export', auth, (req, res) => {
  const rows = db.prepare('SELECT name,category,compatible,qty,min_qty,buy_price,sell_price,supplier,notes FROM parts ORDER BY category ASC, name ASC').all();
  const header = ['name','category','compatible','qty','min_qty','buy_price','sell_price','supplier','notes'];
  const csv = [header.join(',')].concat(rows.map(r=>header.map(h=>csvEscape(r[h])).join(','))).join('\n');
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition','attachment; filename="am_store_parts_export.csv"');
  res.send('\uFEFF'+csv);
});

app.post('/api/parts/import', auth, upload.single('file'), (req, res) => {
  if(!req.file) return res.status(400).json({error:'Файл не завантажено'});
  const text = fs.readFileSync(req.file.path, 'utf8');
  const rows = parseCsv(text);
  const insert = db.prepare(`INSERT INTO parts(name,category,compatible,qty,min_qty,buy_price,sell_price,supplier,notes) VALUES(?,?,?,?,?,?,?,?,?)`);
  const update = db.prepare(`UPDATE parts SET category=?, compatible=?, qty=?, min_qty=?, buy_price=?, sell_price=?, supplier=?, notes=? WHERE name=?`);
  const find = db.prepare('SELECT id, qty FROM parts WHERE name=?');
  const move = db.prepare('INSERT INTO stock_movements(part_id,type,qty,note) VALUES(?,?,?,?)');
  let created=0, updated=0;
  const tx = db.transaction((items)=>{
    for(const r of items){
      const name = (r.name || r['Назва'] || r['назва'] || '').trim();
      if(!name) continue;
      const category = r.category || r['Категорія'] || r['категорія'] || '';
      const compatible = r.compatible || r['Сумісність'] || r['сумісність'] || '';
      const qty = Number(r.qty || r['Кількість'] || r['кількість'] || 0);
      const min_qty = Number(r.min_qty || r['Мін'] || r['Мінімум'] || 1);
      const buy_price = Number(r.buy_price || r['Закупка'] || r['закупка'] || 0);
      const sell_price = Number(r.sell_price || r['Продаж'] || r['продаж'] || 0);
      const supplier = r.supplier || r['Постачальник'] || r['постачальник'] || '';
      const notes = r.notes || r['Коментар'] || r['коментар'] || '';
      const old = find.get(name);
      if(old){
        update.run(category, compatible, qty, min_qty, buy_price, sell_price, supplier, notes, name);
        const diff = qty - Number(old.qty||0);
        if(diff !== 0) move.run(old.id, diff>0?'in':'out', Math.abs(diff), 'Імпорт CSV');
        updated++;
      }else{
        const info = insert.run(name, category, compatible, qty, min_qty, buy_price, sell_price, supplier, notes);
        if(qty !== 0) move.run(info.lastInsertRowid, qty>0?'in':'out', Math.abs(qty), 'Імпорт CSV');
        created++;
      }
    }
  });
  tx(rows);
  try { fs.unlinkSync(req.file.path); } catch(e) {}
  res.json({ok:true, created, updated});
});

app.get('/api/parts', auth, (req, res) => {
  const { search, category, low } = req.query;
  let sql = 'SELECT * FROM parts WHERE 1=1';
  const p = [];
  if (search) {
    sql += ' AND (name LIKE ? OR compatible LIKE ? OR supplier LIKE ? OR notes LIKE ?)';
    const q = `%${search}%`; p.push(q,q,q,q);
  }
  if (category) { sql += ' AND category=?'; p.push(category); }
  if (low) { sql += ' AND qty <= min_qty'; }
  sql += ' ORDER BY category ASC, name ASC';
  res.json(db.prepare(sql).all(...p));
});

app.post('/api/parts', auth, (req, res) => {
  const r = req.body || {};
  const info = db.prepare(`INSERT INTO parts(name,category,compatible,qty,min_qty,buy_price,sell_price,supplier,notes) VALUES(?,?,?,?,?,?,?,?,?)`).run(
    r.name || '', r.category || '', r.compatible || '', Number(r.qty||0), Number(r.min_qty||1),
    Number(r.buy_price||0), Number(r.sell_price||0), r.supplier || '', r.notes || ''
  );
  if (Number(r.qty||0) !== 0) {
    db.prepare('INSERT INTO stock_movements(part_id,type,qty,note) VALUES(?,?,?,?)').run(info.lastInsertRowid, 'in', Number(r.qty||0), 'Початковий залишок');
  }
  logActivity('Створено запчастину', 'part', info.lastInsertRowid, '', `${r.name||''} ${r.category||''}`);
  res.json({ id: info.lastInsertRowid });
});

app.put('/api/parts/:id', auth, (req, res) => {
  const r = req.body || {};
  db.prepare(`UPDATE parts SET name=?,category=?,compatible=?,qty=?,min_qty=?,buy_price=?,sell_price=?,supplier=?,notes=? WHERE id=?`).run(
    r.name || '', r.category || '', r.compatible || '', Number(r.qty||0), Number(r.min_qty||1),
    Number(r.buy_price||0), Number(r.sell_price||0), r.supplier || '', r.notes || '', req.params.id
  );
  res.json({ ok:true });
});

app.patch('/api/parts/:id/adjust', auth, (req, res) => {
  const delta = Number(req.body.delta || 0);
  const note = req.body.note || '';
  const part = db.prepare('SELECT * FROM parts WHERE id=?').get(req.params.id);
  if(!part) return res.status(404).json({ error:'Запчастину не знайдено' });
  const newQty = Number(part.qty||0) + delta;
  if(newQty < 0) return res.status(400).json({ error:'Залишок не може бути менше 0' });
  db.prepare('UPDATE parts SET qty=? WHERE id=?').run(newQty, req.params.id);
  db.prepare('INSERT INTO stock_movements(part_id,type,qty,note) VALUES(?,?,?,?)').run(req.params.id, delta >= 0 ? 'in' : 'out', Math.abs(delta), note);
  res.json({ ok:true, qty:newQty });
});

app.delete('/api/parts/:id', auth, (req, res) => {
  const old=db.prepare('SELECT * FROM parts WHERE id=?').get(req.params.id);
  db.prepare('DELETE FROM parts WHERE id=?').run(req.params.id);
  db.prepare('DELETE FROM stock_movements WHERE part_id=?').run(req.params.id);
  logActivity('Видалено запчастину', 'part', req.params.id, old?old.name:'', '');
  res.json({ ok:true });
});

app.get('/api/parts/:id/movements', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM stock_movements WHERE part_id=? ORDER BY created_at DESC LIMIT 50').all(req.params.id));
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


// ADMIN: clear all warehouse parts safely
app.post('/api/parts/reset', auth, (req, res) => {
  try {
    const before = db.prepare('SELECT COUNT(*) AS c FROM parts').get().c || 0;
    try { db.prepare('DELETE FROM stock_movements').run(); } catch(e) {}
    db.prepare('DELETE FROM parts').run();
    try { db.prepare('DELETE FROM sqlite_sequence WHERE name=?').run('parts'); } catch(e) {}
    try { db.prepare('DELETE FROM sqlite_sequence WHERE name=?').run('stock_movements'); } catch(e) {}
    res.json({ ok:true, deleted: before });
  } catch(e) {
    res.status(500).json({ error:e.message });
  }
});

app.listen(PORT, () => { console.log(`AM Store CRM → http://localhost:${PORT}`); });
