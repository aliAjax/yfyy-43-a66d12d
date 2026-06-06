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
    default_max_count INTEGER NOT NULL DEFAULT 20,
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

  CREATE TABLE IF NOT EXISTS item_materials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS appointment_reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    appointment_id INTEGER NOT NULL,
    phone TEXT NOT NULL,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    send_status TEXT NOT NULL DEFAULT 'sent',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (appointment_id) REFERENCES appointments(id)
  );

  CREATE INDEX IF NOT EXISTS idx_materials_item ON item_materials(item_id);
  CREATE INDEX IF NOT EXISTS idx_appointments_phone_item ON appointments(phone, item_id);
  CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(appointment_date);
  CREATE INDEX IF NOT EXISTS idx_reminders_phone ON appointment_reminders(phone);
  CREATE INDEX IF NOT EXISTS idx_reminders_appointment ON appointment_reminders(appointment_id);
  CREATE INDEX IF NOT EXISTS idx_reminders_created ON appointment_reminders(created_at);
`);

const columns = db.prepare("PRAGMA table_info(items)").all();
const hasDefaultMaxCount = columns.some(c => c.name === 'default_max_count');
if (!hasDefaultMaxCount) {
  db.exec('ALTER TABLE items ADD COLUMN default_max_count INTEGER NOT NULL DEFAULT 20');
}

db.prepare("UPDATE appointment_reminders SET send_status = 'simulated' WHERE send_status = 'sent'").run();

function initDefaultData() {
  const itemCount = db.prepare('SELECT COUNT(*) as cnt FROM items').get().cnt;
  if (itemCount === 0) {
    const insertItem = db.prepare('INSERT INTO items (name, description, default_max_count) VALUES (?, ?, ?)');
    insertItem.run('身份证办理', '首次申领、换领、补领居民身份证', 30);
    insertItem.run('社保业务', '社保查询、缴费、转移等业务', 25);
    insertItem.run('居住证办理', '居住证申领、签注、变更', 20);
    insertItem.run('民政业务', '低保、特困、临时救助等申请', 15);
    console.log('已初始化默认事项数据');
  }

  const holidayCount = db.prepare('SELECT COUNT(*) as cnt FROM holidays').get().cnt;
  if (holidayCount === 0) {
    const insertHoliday = db.prepare('INSERT INTO holidays (date, name) VALUES (?, ?)');
    const year = new Date().getFullYear();
    insertHoliday.run(`${year}-10-01`, '国庆节');
    insertHoliday.run(`${year}-05-01`, '劳动节');
    insertHoliday.run(`${year}-01-01`, '元旦');
    console.log('已初始化默认节假日数据');
  }
}

initDefaultData();

function createReminder(appointmentId, phone, type, content) {
  const stmt = db.prepare(
    'INSERT INTO appointment_reminders (appointment_id, phone, type, content, send_status) VALUES (?, ?, ?, ?, ?)'
  );
  const result = stmt.run(appointmentId, phone, type, content, 'simulated');
  return result.lastInsertRowid;
}

function generateReminderContent(type, appointment) {
  const templates = {
    created: `【预约成功】您的${appointment.item_name || '业务'}预约已成功，预约日期：${appointment.appointment_date} ${appointment.time_slot}，请准时前往办理。`,
    cancelled: `【预约取消】您的${appointment.item_name || '业务'}预约已取消，预约日期：${appointment.appointment_date} ${appointment.time_slot}。`,
    arrived: `【到场提醒】您的${appointment.item_name || '业务'}预约已签到，请前往对应窗口办理业务。`,
    completed: `【办理完成】您的${appointment.item_name || '业务'}已办理完成，感谢您的配合。`
  };
  return templates[type] || '';
}

function getTodayStr() {
  const today = new Date();
  return today.toISOString().split('T')[0];
}

function isValidDate(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return false;
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}` === dateStr;
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
  const { name, description, default_max_count } = req.body;
  if (!name) {
    return res.status(400).json({ error: '事项名称不能为空' });
  }
  const maxCount = default_max_count && default_max_count > 0 ? parseInt(default_max_count) : 20;
  const result = db.prepare('INSERT INTO items (name, description, default_max_count) VALUES (?, ?, ?)').run(name, description || '', maxCount);
  res.json({ id: result.lastInsertRowid, name, description: description || '', default_max_count: maxCount });
});

app.put('/api/items/:id', (req, res) => {
  const { id } = req.params;
  const { name, description, default_max_count } = req.body;
  if (!name) {
    return res.status(400).json({ error: '事项名称不能为空' });
  }
  const maxCount = default_max_count && default_max_count > 0 ? parseInt(default_max_count) : 20;
  db.prepare('UPDATE items SET name = ?, description = ?, default_max_count = ? WHERE id = ?').run(name, description || '', maxCount, id);
  res.json({ id: parseInt(id), name, description: description || '', default_max_count: maxCount });
});

app.delete('/api/items/:id', (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM items WHERE id = ?').run(id);
  db.prepare('DELETE FROM daily_slots WHERE item_id = ?').run(id);
  db.prepare('DELETE FROM appointments WHERE item_id = ?').run(id);
  db.prepare('DELETE FROM item_materials WHERE item_id = ?').run(id);
  res.json({ success: true });
});

app.get('/api/items/:id/materials', (req, res) => {
  const { id } = req.params;
  const materials = db.prepare(
    'SELECT * FROM item_materials WHERE item_id = ? ORDER BY sort_order ASC, id ASC'
  ).all(id);
  res.json(materials);
});

app.post('/api/items/:id/materials', (req, res) => {
  const { id } = req.params;
  const { name, description, sort_order } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: '材料名称不能为空' });
  }

  const item = db.prepare('SELECT id FROM items WHERE id = ?').get(id);
  if (!item) {
    return res.status(404).json({ error: '事项不存在' });
  }

  const order = sort_order !== undefined ? parseInt(sort_order) || 0 : 0;
  const result = db.prepare(
    'INSERT INTO item_materials (item_id, name, description, sort_order) VALUES (?, ?, ?, ?)'
  ).run(id, name.trim(), description || '', order);

  res.json({
    id: result.lastInsertRowid,
    item_id: parseInt(id),
    name: name.trim(),
    description: description || '',
    sort_order: order
  });
});

app.put('/api/materials/:id', (req, res) => {
  const { id } = req.params;
  const { name, description, sort_order } = req.body;

  const material = db.prepare('SELECT * FROM item_materials WHERE id = ?').get(id);
  if (!material) {
    return res.status(404).json({ error: '材料不存在' });
  }

  if (name !== undefined && !name.trim()) {
    return res.status(400).json({ error: '材料名称不能为空' });
  }

  const newName = name !== undefined ? name.trim() : material.name;
  const newDesc = description !== undefined ? description : material.description;
  const newOrder = sort_order !== undefined ? parseInt(sort_order) || 0 : material.sort_order;

  db.prepare(
    'UPDATE item_materials SET name = ?, description = ?, sort_order = ? WHERE id = ?'
  ).run(newName, newDesc, newOrder, id);

  res.json({
    id: parseInt(id),
    item_id: material.item_id,
    name: newName,
    description: newDesc,
    sort_order: newOrder
  });
});

app.delete('/api/materials/:id', (req, res) => {
  const { id } = req.params;
  const material = db.prepare('SELECT id FROM item_materials WHERE id = ?').get(id);
  if (!material) {
    return res.status(404).json({ error: '材料不存在' });
  }
  db.prepare('DELETE FROM item_materials WHERE id = ?').run(id);
  res.json({ success: true });
});

app.put('/api/items/:id/materials/batch', (req, res) => {
  const { id } = req.params;
  const { materials } = req.body;

  const item = db.prepare('SELECT id FROM items WHERE id = ?').get(id);
  if (!item) {
    return res.status(404).json({ error: '事项不存在' });
  }

  if (!Array.isArray(materials)) {
    return res.status(400).json({ error: '材料数据格式错误' });
  }

  for (let i = 0; i < materials.length; i++) {
    const mat = materials[i];
    if (!mat.name || !mat.name.trim()) {
      return res.status(400).json({ error: `第 ${i + 1} 条材料名称不能为空` });
    }
  }

  const insertStmt = db.prepare(
    'INSERT INTO item_materials (item_id, name, description, sort_order) VALUES (?, ?, ?, ?)'
  );
  const updateStmt = db.prepare(
    'UPDATE item_materials SET name = ?, description = ?, sort_order = ? WHERE id = ?'
  );
  const deleteStmt = db.prepare('DELETE FROM item_materials WHERE id = ?');

  const existingIds = new Set(
    db.prepare('SELECT id FROM item_materials WHERE item_id = ?').all(id).map(m => m.id)
  );

  const tx = db.transaction(() => {
    materials.forEach((mat, index) => {
      if (mat.id && existingIds.has(mat.id)) {
        updateStmt.run(
          mat.name?.trim() || '',
          mat.description || '',
          index,
          mat.id
        );
        existingIds.delete(mat.id);
      } else {
        insertStmt.run(
          id,
          mat.name?.trim() || '',
          mat.description || '',
          index
        );
      }
    });

    existingIds.forEach(remainingId => {
      deleteStmt.run(remainingId);
    });
  });

  tx();

  const updatedMaterials = db.prepare(
    'SELECT * FROM item_materials WHERE item_id = ? ORDER BY sort_order ASC, id ASC'
  ).all(id);

  res.json(updatedMaterials);
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
  if (!isValidDate(date)) {
    return res.status(400).json({ error: '日期格式不正确，应为有效的 YYYY-MM-DD 日期' });
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

app.post('/api/holidays/batch', (req, res) => {
  const { holidays } = req.body;
  if (!Array.isArray(holidays) || holidays.length === 0) {
    return res.status(400).json({ error: '节假日数据不能为空' });
  }

  try {
    const validHolidays = [];
    const invalidItems = [];

    holidays.forEach((h, index) => {
      if (!h.date || !isValidDate(h.date)) {
        invalidItems.push({ index: index + 1, date: h.date || '', name: h.name || '', error: '日期格式无效' });
      } else {
        validHolidays.push(h);
      }
    });

    if (validHolidays.length === 0) {
      return res.status(400).json({ error: '没有有效的节假日数据', invalid: invalidItems });
    }

    const insertStmt = db.prepare('INSERT OR REPLACE INTO holidays (date, name) VALUES (?, ?)');
    const insertMany = db.transaction((holidayList) => {
      let count = 0;
      for (const h of holidayList) {
        insertStmt.run(h.date, h.name || '');
        count++;
      }
      return count;
    });

    const imported = insertMany(validHolidays);
    res.json({
      success: true,
      imported,
      total: holidays.length,
      invalid: invalidItems
    });
  } catch (e) {
    res.status(500).json({ error: '批量导入失败' });
  }
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

  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId);
  if (!item) {
    return res.status(404).json({ error: '事项不存在' });
  }

  let slot = db.prepare('SELECT * FROM daily_slots WHERE item_id = ? AND date = ?').get(itemId, date);

  if (!slot) {
    const defaultMax = item.default_max_count || 20;
    db.prepare('INSERT INTO daily_slots (item_id, date, max_count, current_count) VALUES (?, ?, ?, 0)').run(itemId, date, defaultMax);
    slot = db.prepare('SELECT * FROM daily_slots WHERE item_id = ? AND date = ?').get(itemId, date);
  }

  const timeSlots = generateTimeSlots(slot.max_count);
  const appointments = db.prepare('SELECT time_slot FROM appointments WHERE item_id = ? AND appointment_date = ? AND status != ?').all(itemId, date, 'cancelled');

  const usedSlots = new Set(appointments.map(a => a.time_slot));
  const availableSlots = timeSlots.map(slotTime => ({
    time: slotTime,
    available: !usedSlots.has(slotTime)
  }));

  const availableCount = availableSlots.filter(s => s.available).length;

  res.json({
    available: availableCount > 0,
    date,
    max_count: slot.max_count,
    current_count: usedSlots.size,
    available_count: availableCount,
    time_slots: availableSlots
  });
});

function generateTimeSlots(count) {
  const slots = [];
  const startTime = 9 * 60;
  const endTime = 17 * 60;
  const lunchStart = 12 * 60;
  const lunchEnd = 13 * 60;

  const morningMinutes = lunchStart - startTime;
  const afternoonMinutes = endTime - lunchEnd;
  const totalWorkMinutes = morningMinutes + afternoonMinutes;

  const interval = Math.max(10, Math.floor(totalWorkMinutes / count));

  let current = startTime;
  while (current < lunchStart && slots.length < count) {
    const hour = Math.floor(current / 60);
    const minute = current % 60;
    slots.push(`${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`);
    current += interval;
  }

  current = lunchEnd;
  while (current < endTime && slots.length < count) {
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

  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(item_id);
  if (!item) {
    return res.status(400).json({ error: '事项不存在' });
  }

  const existingActive = db.prepare(
    `SELECT id, appointment_date FROM appointments 
     WHERE phone = ? AND item_id = ? AND status IN ('pending', 'arrived')
     ORDER BY appointment_date ASC
     LIMIT 1`
  ).get(phone, item_id);

  if (existingActive) {
    return res.status(400).json({ 
      error: `该手机号已有未完成的${item.name}预约（${existingActive.appointment_date}），请先完成或取消后再预约` 
    });
  }

  const slotCheck = db.prepare(
    `SELECT COUNT(*) as cnt FROM appointments 
     WHERE item_id = ? AND appointment_date = ? AND time_slot = ? AND status != 'cancelled'`
  ).get(item_id, appointment_date, time_slot);

  if (slotCheck.cnt > 0) {
    return res.status(400).json({ error: '该时段已被预约，请选择其他时段' });
  }

  let dailySlot = db.prepare('SELECT * FROM daily_slots WHERE item_id = ? AND date = ?').get(item_id, appointment_date);
  if (!dailySlot) {
    const defaultMax = item.default_max_count || 20;
    db.prepare('INSERT INTO daily_slots (item_id, date, max_count, current_count) VALUES (?, ?, ?, 0)').run(item_id, appointment_date, defaultMax);
    dailySlot = db.prepare('SELECT * FROM daily_slots WHERE item_id = ? AND date = ?').get(item_id, appointment_date);
  }

  if (dailySlot.current_count >= dailySlot.max_count) {
    return res.status(400).json({ error: '该日期号源已满，请选择其他日期' });
  }

  const result = db.prepare(
    'INSERT INTO appointments (item_id, user_name, phone, appointment_date, time_slot, status) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(item_id, user_name, phone, appointment_date, time_slot, 'pending');

  db.prepare('UPDATE daily_slots SET current_count = current_count + 1 WHERE item_id = ? AND date = ?').run(item_id, appointment_date);

  const appointmentId = result.lastInsertRowid;
  const itemName = item.name;
  const reminderContent = generateReminderContent('created', {
    item_name: itemName,
    appointment_date,
    time_slot
  });
  createReminder(appointmentId, phone, 'created', reminderContent);

  res.json({
    id: appointmentId,
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

app.get('/api/appointments/query', (req, res) => {
  const { id, phone } = req.query;

  if (!id || !phone) {
    return res.status(400).json({ error: '请提供预约编号和手机号' });
  }

  const appointment = db.prepare(`
    SELECT a.*, i.name as item_name, i.description as item_description
    FROM appointments a
    LEFT JOIN items i ON a.item_id = i.id
    WHERE a.id = ? AND a.phone = ?
  `).get(id, phone);

  if (!appointment) {
    return res.status(404).json({ error: '未找到对应的预约记录，请检查预约编号和手机号' });
  }

  res.json(appointment);
});

app.post('/api/appointments/:id/cancel', (req, res) => {
  const { id } = req.params;
  const { phone } = req.body;

  if (!phone) {
    return res.status(400).json({ error: '请提供手机号' });
  }

  const appointment = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  if (!appointment) {
    return res.status(404).json({ error: '预约不存在' });
  }

  if (appointment.phone !== phone) {
    return res.status(403).json({ error: '手机号不匹配，无权取消该预约' });
  }

  if (appointment.status === 'cancelled') {
    return res.status(400).json({ error: '该预约已取消' });
  }

  if (appointment.status !== 'pending') {
    return res.status(400).json({ error: '只有待办理状态的预约才能取消' });
  }

  const appointmentDate = new Date(appointment.appointment_date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (appointmentDate < today) {
    return res.status(400).json({ error: '已过期的预约不能取消' });
  }

  db.prepare('UPDATE appointments SET status = ? WHERE id = ?').run('cancelled', id);

  db.prepare(
    'UPDATE daily_slots SET current_count = current_count - 1 WHERE item_id = ? AND date = ?'
  ).run(appointment.item_id, appointment.appointment_date);

  const item = db.prepare('SELECT name FROM items WHERE id = ?').get(appointment.item_id);
  const reminderContent = generateReminderContent('cancelled', {
    item_name: item ? item.name : '',
    appointment_date: appointment.appointment_date,
    time_slot: appointment.time_slot
  });
  createReminder(id, appointment.phone, 'cancelled', reminderContent);

  res.json({ success: true, message: '预约已取消，号源已释放' });
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

  const oldStatus = appointment.status;

  if (oldStatus === status) {
    return res.json({ success: true, status });
  }

  db.prepare('UPDATE appointments SET status = ? WHERE id = ?').run(status, id);

  if (status === 'cancelled' && oldStatus !== 'cancelled') {
    db.prepare(
      'UPDATE daily_slots SET current_count = current_count - 1 WHERE item_id = ? AND date = ?'
    ).run(appointment.item_id, appointment.appointment_date);
  }

  if (oldStatus === 'cancelled' && status !== 'cancelled') {
    const slot = db.prepare('SELECT * FROM daily_slots WHERE item_id = ? AND date = ?').get(appointment.item_id, appointment.appointment_date);
    if (slot && slot.current_count >= slot.max_count) {
      db.prepare('UPDATE appointments SET status = ? WHERE id = ?').run(oldStatus, id);
      return res.status(400).json({ error: '号源已满，无法恢复预约' });
    }
    db.prepare(
      'UPDATE daily_slots SET current_count = current_count + 1 WHERE item_id = ? AND date = ?'
    ).run(appointment.item_id, appointment.appointment_date);
  }

  const reminderTypes = ['arrived', 'completed', 'cancelled'];
  if (reminderTypes.includes(status) && oldStatus !== status) {
    const item = db.prepare('SELECT name FROM items WHERE id = ?').get(appointment.item_id);
    const reminderContent = generateReminderContent(status, {
      item_name: item ? item.name : '',
      appointment_date: appointment.appointment_date,
      time_slot: appointment.time_slot
    });
    createReminder(appointment.id, appointment.phone, status, reminderContent);
  }

  res.json({ success: true, status });
});

app.put('/api/slots/:itemId/:date/max', (req, res) => {
  const { itemId, date } = req.params;
  const { max_count } = req.body;

  if (!max_count || max_count < 1) {
    return res.status(400).json({ error: '号源数量必须大于0' });
  }

  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId);
  if (!item) {
    return res.status(404).json({ error: '事项不存在' });
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

app.get('/api/reminders', (req, res) => {
  const { phone, date, type, send_status, page = 1, page_size = 20 } = req.query;

  let countSql = `SELECT COUNT(*) as total FROM appointment_reminders WHERE 1=1`;
  let sql = `SELECT r.*, a.user_name, a.item_id, i.name as item_name, a.appointment_date, a.time_slot 
             FROM appointment_reminders r 
             LEFT JOIN appointments a ON r.appointment_id = a.id
             LEFT JOIN items i ON a.item_id = i.id
             WHERE 1=1`;
  const params = [];
  const countParams = [];

  if (phone) {
    sql += ' AND r.phone = ?';
    countSql += ' AND phone = ?';
    params.push(phone);
    countParams.push(phone);
  }
  if (date) {
    sql += ' AND DATE(r.created_at) = ?';
    countSql += ' AND DATE(created_at) = ?';
    params.push(date);
    countParams.push(date);
  }
  if (type) {
    sql += ' AND r.type = ?';
    countSql += ' AND type = ?';
    params.push(type);
    countParams.push(type);
  }
  if (send_status) {
    sql += ' AND r.send_status = ?';
    countSql += ' AND send_status = ?';
    params.push(send_status);
    countParams.push(send_status);
  }

  sql += ' ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?';
  const limit = parseInt(page_size) || 20;
  const offset = (parseInt(page) - 1) * limit;
  params.push(limit, offset);

  const reminders = db.prepare(sql).all(...params);
  const total = db.prepare(countSql).get(...countParams).total;

  res.json({
    list: reminders,
    total,
    page: parseInt(page),
    page_size: limit,
    total_pages: Math.ceil(total / limit)
  });
});

app.get('/api/reminders/latest', (req, res) => {
  const { phone, appointment_id } = req.query;

  if (!phone && !appointment_id) {
    return res.status(400).json({ error: '请提供手机号或预约编号' });
  }

  let sql = `
    SELECT r.*, a.user_name, i.name as item_name, a.appointment_date, a.time_slot
    FROM appointment_reminders r
    LEFT JOIN appointments a ON r.appointment_id = a.id
    LEFT JOIN items i ON a.item_id = i.id
    WHERE 1=1
  `;
  const params = [];

  if (phone) {
    sql += ' AND r.phone = ?';
    params.push(phone);
  }
  if (appointment_id) {
    sql += ' AND r.appointment_id = ?';
    params.push(appointment_id);
  }

  sql += ' ORDER BY r.created_at DESC, r.id DESC LIMIT 1';

  const reminder = db.prepare(sql).get(...params);

  if (!reminder) {
    return res.status(404).json({ error: '暂无提醒记录' });
  }

  res.json(reminder);
});

app.get('/api/appointments/:id/reminders', (req, res) => {
  const { id } = req.params;

  const reminders = db.prepare(`
    SELECT r.*, i.name as item_name
    FROM appointment_reminders r
    LEFT JOIN appointments a ON r.appointment_id = a.id
    LEFT JOIN items i ON a.item_id = i.id
    WHERE r.appointment_id = ?
    ORDER BY r.created_at DESC, r.id DESC
  `).all(id);

  res.json(reminders);
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
