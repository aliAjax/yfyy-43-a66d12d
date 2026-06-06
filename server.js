const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = new Database('appointment.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS daily_slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    max_count INTEGER NOT NULL DEFAULT 20,
    current_count INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (item_id) REFERENCES items(id),
    UNIQUE(item_id, date)
  );

  CREATE TABLE IF NOT EXISTS holidays (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL UNIQUE,
    name TEXT
  );

  CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL,
    user_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    appointment_date TEXT NOT NULL,
    time_slot TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (item_id) REFERENCES items(id)
  );

  CREATE INDEX IF NOT EXISTS idx_appointments_phone_item ON appointments(phone, item_id);
  CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(appointment_date);
`);

function getTodayStr() {
  const today = new Date();
  return today.toISOString().split('T')[0];
}

function isWorkday(dateStr) {
  const date = new Date(dateStr);
  const day = date.getDay();
  if (day === 0 || day === 6) return false;

  const holiday = db.prepare('SELECT id FROM holidays WHERE date = ?').get(dateStr);
  if (holiday) return false;

  return true;
}

app.get('/api/items', (req, res) => {
  const items = db.prepare('SELECT * FROM items ORDER BY id').all();
  res.json(items);
});

app.post('/api/items', (req, res) => {
  const { name, description } = req.body;
  if (!name) {
    return res.status(400).json({ error: '事项名称不能为空' });
  }
  const result = db.prepare('INSERT INTO items (name, description) VALUES (?, ?)').run(name, description || '');
  res.json({ id: result.lastInsertRowid, name, description: description || '' });
});

app.put('/api/items/:id', (req, res) => {
  const { id } = req.params;
  const { name, description } = req.body;
  if (!name) {
    return res.status(400).json({ error: '事项名称不能为空' });
  }
  db.prepare('UPDATE items SET name = ?, description = ? WHERE id = ?').run(name, description || '', id);
  res.json({ id: parseInt(id), name, description: description || '' });
});

app.delete('/api/items/:id', (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM items WHERE id = ?').run(id);
  db.prepare('DELETE FROM daily_slots WHERE item_id = ?').run(id);
  db.prepare('DELETE FROM appointments WHERE item_id = ?').run(id);
  res.json({ success: true });
});

app.get('/api/holidays', (req, res) => {
  const holidays = db.prepare('SELECT * FROM holidays ORDER BY date').all();
  res.json(holidays);
});

app.post('/api/holidays', (req, res) => {
  const { date, name } = req.body;
  if (!date) {
    return res.status(400).json({ error: '日期不能为空' });
  }
  try {
    const result = db.prepare('INSERT INTO holidays (date, name) VALUES (?, ?)').run(date, name || '');
    res.json({ id: result.lastInsertRowid, date, name: name || '' });
  } catch (e) {
    res.status(400).json({ error: '该日期已设置为节假日' });
  }
});

app.delete('/api/holidays/:id', (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM holidays WHERE id = ?').run(id);
  res.json({ success: true });
});

app.get('/api/slots/:itemId/:date', (req, res) => {
  const { itemId, date } = req.params;
  const dateObj = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (dateObj < today) {
    return res.json({ available: false, reason: '不能预约过去的日期' });
  }

  if (!isWorkday(date)) {
    return res.json({ available: false, reason: '该日期为节假日或周末，不可预约' });
  }

  let slot = db.prepare('SELECT * FROM daily_slots WHERE item_id = ? AND date = ?').get(itemId, date);

  if (!slot) {
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId);
    if (!item) {
      return res.status(404).json({ error: '事项不存在' });
    }
    const defaultMax = 20;
    db.prepare('INSERT INTO daily_slots (item_id, date, max_count, current_count) VALUES (?, ?, ?, 0)').run(itemId, date, defaultMax);
    slot = db.prepare('SELECT * FROM daily_slots WHERE item_id = ? AND date = ?').get(itemId, date);
  }

  const timeSlots = generateTimeSlots(slot.max_count);
  const appointments = db.prepare('SELECT time_slot FROM appointments WHERE item_id = ? AND appointment_date = ? AND status != ?').all(itemId, date, 'cancelled');

  const usedSlots = new Set(appointments.map(a => a.time_slot));
  const availableSlots = timeSlots.map(slot => ({
    time: slot,
    available: !usedSlots.has(slot)
  }));

  res.json({
    available: true,
    date,
    max_count: slot.max_count,
    current_count: usedSlots.size,
    time_slots: availableSlots
  });
});

function generateTimeSlots(count) {
  const slots = [];
  const startTime = 9 * 60;
  const endTime = 17 * 60;
  const totalMinutes = endTime - startTime - 60;
  const interval = Math.max(15, Math.floor(totalMinutes / count));

  let current = startTime;
  while (current < endTime - 30 && slots.length < count) {
    if (current >= 12 * 60 && current < 13 * 60) {
      current = 13 * 60;
      continue;
    }
    const hour = Math.floor(current / 60);
    const minute = current % 60;
    slots.push(`${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`);
    current += interval;
  }

  return slots;
}

app.post('/api/appointments', (req, res) => {
  const { item_id, user_name, phone, appointment_date, time_slot } = req.body;

  if (!item_id || !user_name || !phone || !appointment_date || !time_slot) {
    return res.status(400).json({ error: '请填写完整信息' });
  }

  const phoneRegex = /^1[3-9]\d{9}$/;
  if (!phoneRegex.test(phone)) {
    return res.status(400).json({ error: '请输入正确的手机号' });
  }

  const dateObj = new Date(appointment_date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (dateObj < today) {
    return res.status(400).json({ error: '不能预约过去的日期' });
  }

  if (!isWorkday(appointment_date)) {
    return res.status(400).json({ error: '该日期不可预约' });
  }

  const existing = db.prepare(
    `SELECT id FROM appointments 
     WHERE phone = ? AND item_id = ? AND appointment_date = ? AND status != 'cancelled'`
  ).get(phone, item_id, appointment_date);

  if (existing) {
    return res.status(400).json({ error: '该手机号今日已预约过此事项，请勿重复预约' });
  }

  const slotCheck = db.prepare(
    `SELECT COUNT(*) as cnt FROM appointments 
     WHERE item_id = ? AND appointment_date = ? AND time_slot = ? AND status != 'cancelled'`
  ).get(item_id, appointment_date, time_slot);

  if (slotCheck.cnt > 0) {
    return res.status(400).json({ error: '该时段已被预约，请选择其他时段' });
  }

  const result = db.prepare(
    'INSERT INTO appointments (item_id, user_name, phone, appointment_date, time_slot, status) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(item_id, user_name, phone, appointment_date, time_slot, 'pending');

  db.prepare(
    `INSERT OR REPLACE INTO daily_slots (item_id, date, max_count, current_count)
     VALUES (?, ?, COALESCE((SELECT max_count FROM daily_slots WHERE item_id = ? AND date = ?), 20),
             COALESCE((SELECT current_count FROM daily_slots WHERE item_id = ? AND date = ?), 0) + 1)`
  ).run(item_id, appointment_date, item_id, appointment_date, item_id, appointment_date);

  res.json({
    id: result.lastInsertRowid,
    item_id,
    user_name,
    phone,
    appointment_date,
    time_slot,
    status: 'pending'
  });
});

app.get('/api/appointments', (req, res) => {
  const { date, item_id, status, phone } = req.query;

  let sql = `SELECT a.*, i.name as item_name 
             FROM appointments a 
             LEFT JOIN items i ON a.item_id = i.id 
             WHERE 1=1`;
  const params = [];

  if (date) {
    sql += ' AND a.appointment_date = ?';
    params.push(date);
  }
  if (item_id) {
    sql += ' AND a.item_id = ?';
    params.push(item_id);
  }
  if (status) {
    sql += ' AND a.status = ?';
    params.push(status);
  }
  if (phone) {
    sql += ' AND a.phone = ?';
    params.push(phone);
  }

  sql += ' ORDER BY a.appointment_date DESC, a.time_slot ASC';

  const appointments = db.prepare(sql).all(...params);
  res.json(appointments);
});

app.put('/api/appointments/:id/status', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const validStatuses = ['pending', 'arrived', 'completed', 'cancelled'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: '无效的状态' });
  }

  const appointment = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  if (!appointment) {
    return res.status(404).json({ error: '预约不存在' });
  }

  db.prepare('UPDATE appointments SET status = ? WHERE id = ?').run(status, id);

  if (status === 'cancelled' && appointment.status !== 'cancelled') {
    db.prepare(
      'UPDATE daily_slots SET current_count = current_count - 1 WHERE item_id = ? AND date = ?'
    ).run(appointment.item_id, appointment.appointment_date);
  }

  if (appointment.status === 'cancelled' && status !== 'cancelled') {
    db.prepare(
      'UPDATE daily_slots SET current_count = current_count + 1 WHERE item_id = ? AND date = ?'
    ).run(appointment.item_id, appointment.appointment_date);
  }

  res.json({ success: true, status });
});

app.put('/api/slots/:itemId/:date/max', (req, res) => {
  const { itemId, date } = req.params;
  const { max_count } = req.body;

  if (!max_count || max_count < 1) {
    return res.status(400).json({ error: '号源数量必须大于0' });
  }

  const existing = db.prepare('SELECT * FROM daily_slots WHERE item_id = ? AND date = ?').get(itemId, date);

  if (existing) {
    if (max_count < existing.current_count) {
      return res.status(400).json({ error: '号源数量不能小于已预约数量' });
    }
    db.prepare('UPDATE daily_slots SET max_count = ? WHERE item_id = ? AND date = ?').run(max_count, itemId, date);
  } else {
    db.prepare('INSERT INTO daily_slots (item_id, date, max_count, current_count) VALUES (?, ?, ?, 0)').run(itemId, date, max_count);
  }

  res.json({ success: true, max_count: parseInt(max_count) });
});

app.get('/api/stats', (req, res) => {
  const today = getTodayStr();
  const totalToday = db.prepare('SELECT COUNT(*) as count FROM appointments WHERE appointment_date = ?').get(today).count;
  const pendingToday = db.prepare('SELECT COUNT(*) as count FROM appointments WHERE appointment_date = ? AND status = ?').get(today, 'pending').count;
  const completedToday = db.prepare('SELECT COUNT(*) as count FROM appointments WHERE appointment_date = ? AND status = ?').get(today, 'completed').count;
  const arrivedToday = db.prepare('SELECT COUNT(*) as count FROM appointments WHERE appointment_date = ? AND status = ?').get(today, 'arrived').count;
  const totalItems = db.prepare('SELECT COUNT(*) as count FROM items').get().count;

  res.json({
    today,
    total_today: totalToday,
    pending_today: pendingToday,
    completed_today: completedToday,
    arrived_today: arrivedToday,
    total_items: totalItems
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.listen(PORT, () => {
  console.log(`预约系统已启动: http://localhost:${PORT}`);
  console.log(`后台管理: http://localhost:${PORT}/admin`);
});
