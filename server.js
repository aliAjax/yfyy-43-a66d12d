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

  CREATE TABLE IF NOT EXISTS appointment_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    appointment_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    user_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    rating INTEGER NOT NULL,
    feedback TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (appointment_id) REFERENCES appointments(id),
    FOREIGN KEY (item_id) REFERENCES items(id),
    UNIQUE(appointment_id)
  );

  CREATE TABLE IF NOT EXISTS phone_restrictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL UNIQUE,
    reason TEXT,
    end_date TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS windows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS item_windows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL,
    window_id INTEGER NOT NULL,
    default_capacity INTEGER NOT NULL DEFAULT 10,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
    FOREIGN KEY (window_id) REFERENCES windows(id) ON DELETE CASCADE,
    UNIQUE(item_id, window_id)
  );

  CREATE TABLE IF NOT EXISTS window_slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    window_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    max_count INTEGER NOT NULL DEFAULT 10,
    current_count INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (window_id) REFERENCES windows(id),
    FOREIGN KEY (item_id) REFERENCES items(id),
    UNIQUE(window_id, item_id, date)
  );

  CREATE TABLE IF NOT EXISTS time_slot_capacities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    max_count INTEGER NOT NULL DEFAULT 0,
    current_count INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (item_id) REFERENCES items(id),
    UNIQUE(item_id, date, start_time, end_time)
  );

  CREATE INDEX IF NOT EXISTS idx_materials_item ON item_materials(item_id);
  CREATE INDEX IF NOT EXISTS idx_appointments_phone_item ON appointments(phone, item_id);
  CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(appointment_date);
  CREATE INDEX IF NOT EXISTS idx_reminders_phone ON appointment_reminders(phone);
  CREATE INDEX IF NOT EXISTS idx_reminders_appointment ON appointment_reminders(appointment_id);
  CREATE INDEX IF NOT EXISTS idx_reminders_created ON appointment_reminders(created_at);
  CREATE INDEX IF NOT EXISTS idx_reviews_appointment ON appointment_reviews(appointment_id);
  CREATE INDEX IF NOT EXISTS idx_reviews_item ON appointment_reviews(item_id);
  CREATE INDEX IF NOT EXISTS idx_reviews_created ON appointment_reviews(created_at);
  CREATE INDEX IF NOT EXISTS idx_phone_restrictions_phone ON phone_restrictions(phone);
  CREATE INDEX IF NOT EXISTS idx_phone_restrictions_end_date ON phone_restrictions(end_date);
  CREATE INDEX IF NOT EXISTS idx_windows_status ON windows(status);
  CREATE INDEX IF NOT EXISTS idx_item_windows_item ON item_windows(item_id);
  CREATE INDEX IF NOT EXISTS idx_item_windows_window ON item_windows(window_id);
  CREATE INDEX IF NOT EXISTS idx_window_slots_window_item ON window_slots(window_id, item_id, date);
  CREATE TABLE IF NOT EXISTS appointment_reschedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    appointment_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    old_date TEXT NOT NULL,
    old_time_slot TEXT NOT NULL,
    old_window_id INTEGER,
    new_date TEXT NOT NULL,
    new_time_slot TEXT NOT NULL,
    new_window_id INTEGER,
    operator_type TEXT NOT NULL DEFAULT 'user',
    operator_name TEXT,
    reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (appointment_id) REFERENCES appointments(id),
    FOREIGN KEY (item_id) REFERENCES items(id),
    FOREIGN KEY (old_window_id) REFERENCES windows(id),
    FOREIGN KEY (new_window_id) REFERENCES windows(id)
  );

  CREATE INDEX IF NOT EXISTS idx_reschedules_appointment ON appointment_reschedules(appointment_id);
  CREATE INDEX IF NOT EXISTS idx_reschedules_item ON appointment_reschedules(item_id);
  CREATE INDEX IF NOT EXISTS idx_reschedules_created ON appointment_reschedules(created_at);
  CREATE INDEX IF NOT EXISTS idx_time_slots_item_date ON time_slot_capacities(item_id, date);
`);

const columns = db.prepare("PRAGMA table_info(items)").all();
const hasDefaultMaxCount = columns.some(c => c.name === 'default_max_count');
if (!hasDefaultMaxCount) {
  db.exec('ALTER TABLE items ADD COLUMN default_max_count INTEGER NOT NULL DEFAULT 20');
}

const aptColumns = db.prepare("PRAGMA table_info(appointments)").all();
const hasQueueNumber = aptColumns.some(c => c.name === 'queue_number');
if (!hasQueueNumber) {
  db.exec('ALTER TABLE appointments ADD COLUMN queue_number INTEGER');
}
const hasCalledAt = aptColumns.some(c => c.name === 'called_at');
if (!hasCalledAt) {
  db.exec('ALTER TABLE appointments ADD COLUMN called_at DATETIME');
}
const hasWindowId = aptColumns.some(c => c.name === 'window_id');
if (!hasWindowId) {
  db.exec('ALTER TABLE appointments ADD COLUMN window_id INTEGER');
}
const hasSource = aptColumns.some(c => c.name === 'source');
if (!hasSource) {
  db.exec("ALTER TABLE appointments ADD COLUMN source TEXT NOT NULL DEFAULT 'user'");
}
const hasOperatorName = aptColumns.some(c => c.name === 'operator_name');
if (!hasOperatorName) {
  db.exec('ALTER TABLE appointments ADD COLUMN operator_name TEXT');
}

const itemColumns = db.prepare("PRAGMA table_info(items)").all();
const hasAdvanceWeeks = itemColumns.some(c => c.name === 'advance_weeks');
if (!hasAdvanceWeeks) {
  db.exec('ALTER TABLE items ADD COLUMN advance_weeks INTEGER');
}
const hasAllowSameDay = itemColumns.some(c => c.name === 'allow_same_day');
if (!hasAllowSameDay) {
  db.exec('ALTER TABLE items ADD COLUMN allow_same_day INTEGER');
}
const hasCancelDeadlineHours = itemColumns.some(c => c.name === 'cancel_deadline_hours');
if (!hasCancelDeadlineHours) {
  db.exec('ALTER TABLE items ADD COLUMN cancel_deadline_hours INTEGER');
}
const hasRescheduleDeadlineHours = itemColumns.some(c => c.name === 'reschedule_deadline_hours');
if (!hasRescheduleDeadlineHours) {
  db.exec('ALTER TABLE items ADD COLUMN reschedule_deadline_hours INTEGER');
}
const hasMaxActiveAppointments = itemColumns.some(c => c.name === 'max_active_appointments');
if (!hasMaxActiveAppointments) {
  db.exec('ALTER TABLE items ADD COLUMN max_active_appointments INTEGER');
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

  const windowCount = db.prepare('SELECT COUNT(*) as cnt FROM windows').get().cnt;
  if (windowCount === 0) {
    const insertWindow = db.prepare('INSERT INTO windows (name, description, status, sort_order) VALUES (?, ?, ?, ?)');
    insertWindow.run('1号窗口', '综合业务窗口', 'active', 1);
    insertWindow.run('2号窗口', '综合业务窗口', 'active', 2);
    insertWindow.run('3号窗口', '社保专窗', 'active', 3);
    insertWindow.run('4号窗口', '户政专窗', 'active', 4);
    insertWindow.run('5号窗口', '民政专窗', 'active', 5);
    console.log('已初始化默认窗口数据');
  }

  const itemWindowCount = db.prepare('SELECT COUNT(*) as cnt FROM item_windows').get().cnt;
  if (itemWindowCount === 0) {
    const items = db.prepare('SELECT * FROM items ORDER BY id').all();
    const windows = db.prepare('SELECT * FROM windows ORDER BY sort_order').all();
    
    const insertItemWindow = db.prepare('INSERT INTO item_windows (item_id, window_id, default_capacity) VALUES (?, ?, ?)');
    
    items.forEach(item => {
      windows.forEach(window => {
        let capacity = Math.ceil((item.default_max_count || 20) / 2);
        if (item.name === '社保业务' && window.name === '3号窗口') {
          capacity = item.default_max_count || 25;
        }
        if (item.name === '身份证办理' && window.name === '4号窗口') {
          capacity = item.default_max_count || 30;
        }
        if (item.name === '民政业务' && window.name === '5号窗口') {
          capacity = item.default_max_count || 15;
        }
        if (window.name === '1号窗口' || window.name === '2号窗口') {
          capacity = Math.ceil((item.default_max_count || 20) / 3);
        }
        insertItemWindow.run(item.id, window.id, capacity);
      });
    });
    console.log('已初始化默认事项-窗口关联数据');
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
  const windowText = appointment.window_name ? `，办理窗口：${appointment.window_name}` : '';
  const templates = {
    created: `【预约成功】您的${appointment.item_name || '业务'}预约已成功，预约日期：${appointment.appointment_date} ${appointment.time_slot}${windowText}，请准时前往办理。`,
    cancelled: `【预约取消】您的${appointment.item_name || '业务'}预约已取消，预约日期：${appointment.appointment_date} ${appointment.time_slot}。`,
    arrived: `【到场提醒】您的${appointment.item_name || '业务'}预约已签到，请在休息区等待叫号。`,
    calling: `【叫号提醒】请${appointment.user_name || ''}顾客前往${appointment.window_name || appointment.item_name || '业务'}窗口办理，您的号码是${appointment.queue_number || ''}号。`,
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

function getAppointmentStartTime(timeSlot) {
  if (!timeSlot) return '09:00';
  const parts = timeSlot.split('-');
  return parts[0] || '09:00';
}

function getMaxAdvanceDate(item) {
  const weeks = (item.advance_weeks !== null && item.advance_weeks !== undefined) ? item.advance_weeks : 4;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const maxDate = new Date(today);
  maxDate.setDate(today.getDate() + weeks * 7 - 1);
  return maxDate;
}

function isDateWithinAdvanceWeeks(dateStr, item) {
  const date = new Date(dateStr);
  date.setHours(0, 0, 0, 0);
  const maxDate = getMaxAdvanceDate(item);
  maxDate.setHours(23, 59, 59, 999);
  return date <= maxDate;
}

function isSameDayBookingAllowed(item) {
  if (item.allow_same_day === null || item.allow_same_day === undefined) {
    return true;
  }
  return item.allow_same_day === 1;
}

function isSameDayReschedulingAllowed(item) {
  if (item.allow_same_day === null || item.allow_same_day === undefined) {
    return false;
  }
  return item.allow_same_day === 1;
}

function getAppointmentDateTime(dateStr, timeSlot) {
  const startTime = getAppointmentStartTime(timeSlot);
  const [hours, minutes] = startTime.split(':').map(Number);
  const date = new Date(dateStr);
  date.setHours(hours, minutes, 0, 0);
  return date;
}

function isCancellationAllowed(appointment, item) {
  if (appointment.status !== 'pending') return false;

  const deadlineHours = item.cancel_deadline_hours;
  if (deadlineHours === null || deadlineHours === undefined) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const aptDate = new Date(appointment.appointment_date);
    aptDate.setHours(0, 0, 0, 0);
    return aptDate >= today;
  }

  const aptDateTime = getAppointmentDateTime(appointment.appointment_date, appointment.time_slot);
  const now = new Date();
  const deadline = new Date(aptDateTime.getTime() - deadlineHours * 60 * 60 * 1000);
  return now <= deadline;
}

function isReschedulingAllowed(appointment, item) {
  if (appointment.status !== 'pending') return false;

  const deadlineHours = item.reschedule_deadline_hours;
  if (deadlineHours === null || deadlineHours === undefined) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const aptDate = new Date(appointment.appointment_date);
    aptDate.setHours(0, 0, 0, 0);
    return aptDate >= today;
  }

  const aptDateTime = getAppointmentDateTime(appointment.appointment_date, appointment.time_slot);
  const now = new Date();
  const deadline = new Date(aptDateTime.getTime() - deadlineHours * 60 * 60 * 1000);
  return now <= deadline;
}

function getMaxActiveAppointments(item) {
  return (item.max_active_appointments !== null && item.max_active_appointments !== undefined)
    ? item.max_active_appointments
    : 1;
}

function countActiveAppointments(phone, itemId) {
  return db.prepare(
    `SELECT COUNT(*) as cnt FROM appointments 
     WHERE phone = ? AND item_id = ? AND status IN ('pending', 'arrived', 'calling')`
  ).get(phone, itemId).cnt;
}

app.get('/api/items', (req, res) => {
  const items = db.prepare('SELECT * FROM items ORDER BY id').all();
  res.json(items);
});

app.post('/api/items', (req, res) => {
  const { name, description, default_max_count, advance_weeks, allow_same_day, cancel_deadline_hours, reschedule_deadline_hours, max_active_appointments } = req.body;
  if (!name) {
    return res.status(400).json({ error: '事项名称不能为空' });
  }
  const maxCount = default_max_count && default_max_count > 0 ? parseInt(default_max_count) : 20;
  const advanceWeeks = advance_weeks !== undefined && advance_weeks !== '' ? parseInt(advance_weeks) : null;
  const allowSameDay = parseNullableBool(allow_same_day, null);
  const cancelDeadlineHours = cancel_deadline_hours !== undefined && cancel_deadline_hours !== '' ? parseInt(cancel_deadline_hours) : null;
  const rescheduleDeadlineHours = reschedule_deadline_hours !== undefined && reschedule_deadline_hours !== '' ? parseInt(reschedule_deadline_hours) : null;
  const maxActiveAppointments = max_active_appointments !== undefined && max_active_appointments !== '' ? parseInt(max_active_appointments) : null;

  if (advanceWeeks !== null && advanceWeeks < 1) {
    return res.status(400).json({ error: '提前预约周数不能小于1' });
  }
  if (cancelDeadlineHours !== null && cancelDeadlineHours < 0) {
    return res.status(400).json({ error: '取消截止小时数不能小于0' });
  }
  if (rescheduleDeadlineHours !== null && rescheduleDeadlineHours < 0) {
    return res.status(400).json({ error: '改期截止小时数不能小于0' });
  }
  if (maxActiveAppointments !== null && maxActiveAppointments < 1) {
    return res.status(400).json({ error: '未完成预约上限不能小于1' });
  }

  const result = db.prepare(
    'INSERT INTO items (name, description, default_max_count, advance_weeks, allow_same_day, cancel_deadline_hours, reschedule_deadline_hours, max_active_appointments) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(name, description || '', maxCount, advanceWeeks, allowSameDay, cancelDeadlineHours, rescheduleDeadlineHours, maxActiveAppointments);
  res.json({
    id: result.lastInsertRowid,
    name,
    description: description || '',
    default_max_count: maxCount,
    advance_weeks: advanceWeeks,
    allow_same_day: allowSameDay,
    cancel_deadline_hours: cancelDeadlineHours,
    reschedule_deadline_hours: rescheduleDeadlineHours,
    max_active_appointments: maxActiveAppointments
  });
});

function parseNullableInt(value, fallback) {
  if (value === undefined) return fallback;
  if (value === null || value === '') return null;
  const parsed = parseInt(value);
  return isNaN(parsed) ? null : parsed;
}

function parseNullableBool(value, fallback) {
  if (value === undefined) return fallback;
  if (value === null || value === '') return null;
  if (value === true || value === 1 || value === '1') return 1;
  if (value === false || value === 0 || value === '0') return 0;
  return null;
}

app.put('/api/items/:id', (req, res) => {
  const { id } = req.params;
  const { name, description, default_max_count, advance_weeks, allow_same_day, cancel_deadline_hours, reschedule_deadline_hours, max_active_appointments } = req.body;
  if (!name) {
    return res.status(400).json({ error: '事项名称不能为空' });
  }

  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
  if (!item) {
    return res.status(404).json({ error: '事项不存在' });
  }

  const maxCount = default_max_count !== undefined ? (default_max_count > 0 ? parseInt(default_max_count) : 20) : item.default_max_count;
  const advanceWeeks = parseNullableInt(advance_weeks, item.advance_weeks);
  const allowSameDay = parseNullableBool(allow_same_day, item.allow_same_day);
  const cancelDeadlineHours = parseNullableInt(cancel_deadline_hours, item.cancel_deadline_hours);
  const rescheduleDeadlineHours = parseNullableInt(reschedule_deadline_hours, item.reschedule_deadline_hours);
  const maxActiveAppointments = parseNullableInt(max_active_appointments, item.max_active_appointments);

  if (advanceWeeks !== null && advanceWeeks < 1) {
    return res.status(400).json({ error: '提前预约周数不能小于1' });
  }
  if (cancelDeadlineHours !== null && cancelDeadlineHours < 0) {
    return res.status(400).json({ error: '取消截止小时数不能小于0' });
  }
  if (rescheduleDeadlineHours !== null && rescheduleDeadlineHours < 0) {
    return res.status(400).json({ error: '改期截止小时数不能小于0' });
  }
  if (maxActiveAppointments !== null && maxActiveAppointments < 1) {
    return res.status(400).json({ error: '未完成预约上限不能小于1' });
  }

  db.prepare(
    'UPDATE items SET name = ?, description = ?, default_max_count = ?, advance_weeks = ?, allow_same_day = ?, cancel_deadline_hours = ?, reschedule_deadline_hours = ?, max_active_appointments = ? WHERE id = ?'
  ).run(name, description || '', maxCount, advanceWeeks, allowSameDay, cancelDeadlineHours, rescheduleDeadlineHours, maxActiveAppointments, id);
  res.json({
    id: parseInt(id),
    name,
    description: description || '',
    default_max_count: maxCount,
    advance_weeks: advanceWeeks,
    allow_same_day: allowSameDay,
    cancel_deadline_hours: cancelDeadlineHours,
    reschedule_deadline_hours: rescheduleDeadlineHours,
    max_active_appointments: maxActiveAppointments
  });
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

app.get('/api/windows', (req, res) => {
  const { status } = req.query;
  let sql = 'SELECT * FROM windows';
  const params = [];
  if (status) {
    sql += ' WHERE status = ?';
    params.push(status);
  }
  sql += ' ORDER BY sort_order ASC, id ASC';
  const windows = db.prepare(sql).all(...params);
  res.json(windows);
});

app.post('/api/windows', (req, res) => {
  const { name, description, sort_order } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: '窗口名称不能为空' });
  }
  const order = sort_order !== undefined ? parseInt(sort_order) || 0 : 0;
  const result = db.prepare(
    'INSERT INTO windows (name, description, status, sort_order) VALUES (?, ?, ?, ?)'
  ).run(name.trim(), description || '', 'active', order);
  res.json({
    id: result.lastInsertRowid,
    name: name.trim(),
    description: description || '',
    status: 'active',
    sort_order: order
  });
});

app.put('/api/windows/:id', (req, res) => {
  const { id } = req.params;
  const { name, description, sort_order, status } = req.body;

  const window = db.prepare('SELECT * FROM windows WHERE id = ?').get(id);
  if (!window) {
    return res.status(404).json({ error: '窗口不存在' });
  }

  if (name !== undefined && !name.trim()) {
    return res.status(400).json({ error: '窗口名称不能为空' });
  }

  const newName = name !== undefined ? name.trim() : window.name;
  const newDesc = description !== undefined ? description : window.description;
  const newOrder = sort_order !== undefined ? parseInt(sort_order) || 0 : window.sort_order;
  const newStatus = status !== undefined ? status : window.status;

  if (newStatus && !['active', 'inactive'].includes(newStatus)) {
    return res.status(400).json({ error: '无效的状态值' });
  }

  db.prepare(
    'UPDATE windows SET name = ?, description = ?, sort_order = ?, status = ? WHERE id = ?'
  ).run(newName, newDesc, newOrder, newStatus, id);

  res.json({
    id: parseInt(id),
    name: newName,
    description: newDesc,
    sort_order: newOrder,
    status: newStatus
  });
});

app.delete('/api/windows/:id', (req, res) => {
  const { id } = req.params;
  const window = db.prepare('SELECT * FROM windows WHERE id = ?').get(id);
  if (!window) {
    return res.status(404).json({ error: '窗口不存在' });
  }

  const hasAppointments = db.prepare(
    'SELECT COUNT(*) as cnt FROM appointments WHERE window_id = ?'
  ).get(id).cnt;
  if (hasAppointments > 0) {
    return res.status(400).json({ error: '该窗口存在预约记录，无法删除，建议停用' });
  }

  db.prepare('DELETE FROM windows WHERE id = ?').run(id);
  db.prepare('DELETE FROM item_windows WHERE window_id = ?').run(id);
  db.prepare('DELETE FROM window_slots WHERE window_id = ?').run(id);
  res.json({ success: true });
});

app.put('/api/windows/:id/status', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!status || !['active', 'inactive'].includes(status)) {
    return res.status(400).json({ error: '无效的状态值' });
  }

  const window = db.prepare('SELECT * FROM windows WHERE id = ?').get(id);
  if (!window) {
    return res.status(404).json({ error: '窗口不存在' });
  }

  db.prepare('UPDATE windows SET status = ? WHERE id = ?').run(status, id);
  res.json({ success: true, id: parseInt(id), status });
});

app.get('/api/items/:itemId/windows', (req, res) => {
  const { itemId } = req.params;
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId);
  if (!item) {
    return res.status(404).json({ error: '事项不存在' });
  }

  const itemWindows = db.prepare(`
    SELECT iw.*, w.name as window_name, w.description as window_description, w.status as window_status, w.sort_order
    FROM item_windows iw
    LEFT JOIN windows w ON iw.window_id = w.id
    WHERE iw.item_id = ?
    ORDER BY w.sort_order ASC, w.id ASC
  `).all(itemId);

  res.json(itemWindows);
});

app.put('/api/items/:itemId/windows', (req, res) => {
  const { itemId } = req.params;
  const { windows } = req.body;

  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId);
  if (!item) {
    return res.status(404).json({ error: '事项不存在' });
  }

  if (!Array.isArray(windows)) {
    return res.status(400).json({ error: '窗口数据格式错误' });
  }

  for (let i = 0; i < windows.length; i++) {
    const w = windows[i];
    if (!w.window_id) {
      return res.status(400).json({ error: `第 ${i + 1} 条窗口配置缺少窗口ID` });
    }
    if (w.default_capacity !== undefined && (parseInt(w.default_capacity) < 0 || isNaN(parseInt(w.default_capacity)))) {
      return res.status(400).json({ error: `第 ${i + 1} 条窗口配置的默认容量无效` });
    }
  }

  const insertStmt = db.prepare(
    'INSERT OR REPLACE INTO item_windows (item_id, window_id, default_capacity) VALUES (?, ?, ?)'
  );
  const deleteStmt = db.prepare(
    'DELETE FROM item_windows WHERE item_id = ? AND window_id = ?'
  );

  const existingWindowIds = new Set(
    db.prepare('SELECT window_id FROM item_windows WHERE item_id = ?').all(itemId).map(w => w.window_id)
  );
  const newWindowIds = new Set(windows.map(w => parseInt(w.window_id)));

  const tx = db.transaction(() => {
    windows.forEach(w => {
      const capacity = w.default_capacity !== undefined ? parseInt(w.default_capacity) : 10;
      insertStmt.run(itemId, w.window_id, capacity);
      existingWindowIds.delete(parseInt(w.window_id));
    });

    existingWindowIds.forEach(windowId => {
      deleteStmt.run(itemId, windowId);
    });
  });

  try {
    tx();
    const updated = db.prepare(`
      SELECT iw.*, w.name as window_name, w.status as window_status
      FROM item_windows iw
      LEFT JOIN windows w ON iw.window_id = w.id
      WHERE iw.item_id = ?
      ORDER BY w.sort_order ASC
    `).all(itemId);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: '保存失败' });
  }
});

app.get('/api/slots/:itemId/:date', (req, res) => {
  const { itemId, date } = req.params;
  const dateObj = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId);
  if (!item) {
    return res.status(404).json({ error: '事项不存在' });
  }

  if (dateObj < today) {
    return res.json({ available: false, reason: '不能预约过去的日期' });
  }

  const isToday = dateObj.getTime() === today.getTime();
  if (isToday && !isSameDayBookingAllowed(item)) {
    return res.json({ available: false, reason: '该事项不支持当天预约' });
  }

  if (!isDateWithinAdvanceWeeks(date, item)) {
    const maxDate = getMaxAdvanceDate(item);
    const maxDateStr = maxDate.toISOString().split('T')[0];
    return res.json({ available: false, reason: `超出可预约范围，最远可预约至 ${maxDateStr}` });
  }

  if (!isWorkday(date)) {
    return res.json({ available: false, reason: '该日期为节假日或周末，不可预约' });
  }

  const timeSlotCaps = db.prepare(`
    SELECT * FROM time_slot_capacities 
    WHERE item_id = ? AND date = ? 
    ORDER BY sort_order ASC, start_time ASC
  `).all(itemId, date);

  const allItemWindows = db.prepare(`
    SELECT COUNT(*) as cnt
    FROM item_windows iw
    WHERE iw.item_id = ?
  `).get(itemId).cnt;

  const itemWindows = db.prepare(`
    SELECT iw.*, w.name as window_name, w.status as window_status, w.sort_order
    FROM item_windows iw
    LEFT JOIN windows w ON iw.window_id = w.id
    WHERE iw.item_id = ? AND w.status = 'active'
    ORDER BY w.sort_order ASC, w.id ASC
  `).all(itemId);

  if (allItemWindows > 0 && itemWindows.length === 0) {
    res.json({
      available: false,
      reason: '该事项暂无可用办理窗口',
      date,
      max_count: 0,
      current_count: 0,
      available_count: 0,
      time_slots: [],
      use_windows: true,
      windows: []
    });
    return;
  }

  if (timeSlotCaps.length > 0) {
    let totalMax = 0;
    let totalCurrent = 0;
    const timeSlots = [];

    for (const tsc of timeSlotCaps) {
      const availableCount = Math.max(0, tsc.max_count - tsc.current_count);

      totalMax += tsc.max_count;
      totalCurrent += tsc.current_count;

      timeSlots.push({
        id: tsc.id,
        start_time: tsc.start_time,
        end_time: tsc.end_time,
        time: `${tsc.start_time}-${tsc.end_time}`,
        max_count: tsc.max_count,
        current_count: tsc.current_count,
        available_count: availableCount,
        available: availableCount > 0
      });
    }

    const totalAvailable = Math.max(0, totalMax - totalCurrent);

    let windowSlots = [];
    let useWindows = false;
    let windowTotalAvailable = 0;

    if (allItemWindows > 0) {
      useWindows = true;

      itemWindows.forEach(iw => {
        let ws = db.prepare(
          'SELECT * FROM window_slots WHERE window_id = ? AND item_id = ? AND date = ?'
        ).get(iw.window_id, itemId, date);

        if (!ws) {
          const defaultCapacity = iw.default_capacity || 10;
          db.prepare(
            'INSERT INTO window_slots (window_id, item_id, date, max_count, current_count) VALUES (?, ?, ?, ?, 0)'
          ).run(iw.window_id, itemId, date, defaultCapacity);
          ws = db.prepare(
            'SELECT * FROM window_slots WHERE window_id = ? AND item_id = ? AND date = ?'
          ).get(iw.window_id, itemId, date);
        }

        const windowApts = db.prepare(
          `SELECT COUNT(*) as cnt FROM appointments 
           WHERE window_id = ? AND item_id = ? AND appointment_date = ? AND status != ?`
        ).get(iw.window_id, itemId, date, 'cancelled');

        const windowUsedCount = windowApts.cnt;
        const windowAvailable = Math.max(0, ws.max_count - windowUsedCount);

        windowTotalAvailable += windowAvailable;

        windowSlots.push({
          window_id: iw.window_id,
          window_name: iw.window_name,
          max_count: ws.max_count,
          current_count: windowUsedCount,
          available_count: windowAvailable
        });
      });
    }

    const effectiveAvailable = useWindows ? Math.min(totalAvailable, windowTotalAvailable) : totalAvailable;
    if (useWindows && windowTotalAvailable <= 0) {
      timeSlots.forEach(slot => {
        slot.available = false;
      });
    }

    res.json({
      available: effectiveAvailable > 0,
      date,
      max_count: totalMax,
      current_count: totalCurrent,
      available_count: effectiveAvailable,
      time_slots: timeSlots,
      use_time_slots: true,
      use_windows: useWindows,
      windows: windowSlots
    });
    return;
  }

  if (itemWindows.length === 0) {
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
      time_slots: availableSlots,
      use_windows: false,
      windows: []
    });
    return;
  }

  let totalMax = 0;
  let totalCurrent = 0;
  const windowSlots = [];

  itemWindows.forEach(iw => {
    let ws = db.prepare(
      'SELECT * FROM window_slots WHERE window_id = ? AND item_id = ? AND date = ?'
    ).get(iw.window_id, itemId, date);

    if (!ws) {
      const defaultCapacity = iw.default_capacity || 10;
      db.prepare(
        'INSERT INTO window_slots (window_id, item_id, date, max_count, current_count) VALUES (?, ?, ?, ?, 0)'
      ).run(iw.window_id, itemId, date, defaultCapacity);
      ws = db.prepare(
        'SELECT * FROM window_slots WHERE window_id = ? AND item_id = ? AND date = ?'
      ).get(iw.window_id, itemId, date);
    }

    const windowApts = db.prepare(
      `SELECT time_slot FROM appointments 
       WHERE window_id = ? AND item_id = ? AND appointment_date = ? AND status != ?`
    ).all(iw.window_id, itemId, date, 'cancelled');

    const windowUsedCount = windowApts.length;
    const windowAvailable = Math.max(0, ws.max_count - windowUsedCount);

    totalMax += ws.max_count;
    totalCurrent += windowUsedCount;

    windowSlots.push({
      window_id: iw.window_id,
      window_name: iw.window_name,
      max_count: ws.max_count,
      current_count: windowUsedCount,
      available_count: windowAvailable
    });
  });

  const totalAvailable = Math.max(0, totalMax - totalCurrent);
  const timeSlots = generateTimeSlots(totalMax);
  const allAppointments = db.prepare(
    'SELECT time_slot FROM appointments WHERE item_id = ? AND appointment_date = ? AND status != ?'
  ).all(itemId, date, 'cancelled');

  const usedSlots = new Set(allAppointments.map(a => a.time_slot));
  const availableSlots = timeSlots.map(slotTime => ({
    time: slotTime,
    available: !usedSlots.has(slotTime)
  }));

  res.json({
    available: totalAvailable > 0,
    date,
    max_count: totalMax,
    current_count: totalCurrent,
    available_count: totalAvailable,
    time_slots: availableSlots,
    use_windows: true,
    windows: windowSlots
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

function validateAndCreateAppointment({
  item_id,
  user_name,
  phone,
  appointment_date,
  time_slot,
  source = 'user',
  operator_name = null,
  window_id = null
}) {
  if (!item_id || !user_name || !phone || !appointment_date || !time_slot) {
    throw new Error('请填写完整信息');
  }

  const phoneRegex = /^1[3-9]\d{9}$/;
  if (!phoneRegex.test(phone)) {
    throw new Error('请输入正确的手机号');
  }

  const restriction = db.prepare(
    'SELECT * FROM phone_restrictions WHERE phone = ?'
  ).get(phone);

  if (restriction) {
    const todayStr = getTodayStr();
    if (restriction.end_date >= todayStr) {
      throw new Error(`该手机号已被限制预约，限制原因：${restriction.reason || '未填写'}，截止日期：${restriction.end_date}`);
    } else {
      db.prepare('DELETE FROM phone_restrictions WHERE id = ?').run(restriction.id);
    }
  }

  const dateObj = new Date(appointment_date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (dateObj < today) {
    throw new Error('不能预约过去的日期');
  }

  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(item_id);
  if (!item) {
    throw new Error('事项不存在');
  }

  const isToday = dateObj.getTime() === today.getTime();
  if (isToday && !isSameDayBookingAllowed(item)) {
    throw new Error('该事项不支持当天预约');
  }

  if (!isDateWithinAdvanceWeeks(appointment_date, item)) {
    const maxDate = getMaxAdvanceDate(item);
    const maxDateStr = maxDate.toISOString().split('T')[0];
    throw new Error(`超出可预约范围，最远可预约至 ${maxDateStr}`);
  }

  if (!isWorkday(appointment_date)) {
    throw new Error('该日期不可预约');
  }

  const maxActive = getMaxActiveAppointments(item);
  const activeCount = countActiveAppointments(phone, item_id);
  if (activeCount >= maxActive) {
    throw new Error(`该手机号已有 ${activeCount} 个未完成的${item.name}预约，最多可同时有 ${maxActive} 个未完成预约，请先完成或取消后再预约`);
  }

  const timeSlotCaps = db.prepare(`
    SELECT * FROM time_slot_capacities 
    WHERE item_id = ? AND date = ? 
    ORDER BY sort_order ASC, start_time ASC
  `).all(item_id, appointment_date);

  let useTimeSlots = timeSlotCaps.length > 0;
  let matchedTimeSlot = null;

  if (useTimeSlots) {
    for (const tsc of timeSlotCaps) {
      if (time_slot === `${tsc.start_time}-${tsc.end_time}`) {
        matchedTimeSlot = tsc;
        break;
      }
    }

    if (!matchedTimeSlot) {
      throw new Error('所选时段无效，请重新选择');
    }

    if (matchedTimeSlot.current_count >= matchedTimeSlot.max_count) {
      throw new Error('该时段号源已满，请选择其他时段');
    }
  } else {
    const slotCheck = db.prepare(
      `SELECT COUNT(*) as cnt FROM appointments 
       WHERE item_id = ? AND appointment_date = ? AND time_slot = ? AND status != 'cancelled'`
    ).get(item_id, appointment_date, time_slot);

    if (slotCheck.cnt > 0) {
      throw new Error('该时段已被预约，请选择其他时段');
    }
  }

  let assignedWindowId = null;

  const allItemWindows = db.prepare(`
    SELECT COUNT(*) as cnt
    FROM item_windows iw
    WHERE iw.item_id = ?
  `).get(item_id).cnt;

  if (allItemWindows > 0) {
    if (window_id) {
      const itemWindow = db.prepare(`
        SELECT iw.*, w.name as window_name, w.status as window_status
        FROM item_windows iw
        LEFT JOIN windows w ON iw.window_id = w.id
        WHERE iw.item_id = ? AND iw.window_id = ? AND w.status = 'active'
      `).get(item_id, window_id);

      if (!itemWindow) {
        throw new Error('所选窗口不支持该事项或窗口不可用');
      }

      let ws = db.prepare(
        'SELECT * FROM window_slots WHERE window_id = ? AND item_id = ? AND date = ?'
      ).get(window_id, item_id, appointment_date);

      if (!ws) {
        const defaultCapacity = itemWindow.default_capacity || 10;
        db.prepare(
          'INSERT INTO window_slots (window_id, item_id, date, max_count, current_count) VALUES (?, ?, ?, ?, 0)'
        ).run(window_id, item_id, appointment_date, defaultCapacity);
        ws = db.prepare(
          'SELECT * FROM window_slots WHERE window_id = ? AND item_id = ? AND date = ?'
        ).get(window_id, item_id, appointment_date);
      }

      const windowUsed = db.prepare(
        `SELECT COUNT(*) as cnt FROM appointments 
         WHERE window_id = ? AND item_id = ? AND appointment_date = ? AND status != 'cancelled'`
      ).get(window_id, item_id, appointment_date).cnt;

      if (windowUsed >= ws.max_count) {
        throw new Error('该窗口号源已满，请选择其他窗口或日期');
      }

      assignedWindowId = window_id;
    } else {
      const itemWindows = db.prepare(`
        SELECT iw.*, w.name as window_name, w.status as window_status
        FROM item_windows iw
        LEFT JOIN windows w ON iw.window_id = w.id
        WHERE iw.item_id = ? AND w.status = 'active'
        ORDER BY w.sort_order ASC, w.id ASC
      `).all(item_id);

      if (itemWindows.length === 0) {
        throw new Error('该事项暂无可用办理窗口');
      }

      let bestWindow = null;
      let bestAvailable = -1;

      for (const iw of itemWindows) {
        let ws = db.prepare(
          'SELECT * FROM window_slots WHERE window_id = ? AND item_id = ? AND date = ?'
        ).get(iw.window_id, item_id, appointment_date);

        if (!ws) {
          const defaultCapacity = iw.default_capacity || 10;
          db.prepare(
            'INSERT INTO window_slots (window_id, item_id, date, max_count, current_count) VALUES (?, ?, ?, ?, 0)'
          ).run(iw.window_id, item_id, appointment_date, defaultCapacity);
          ws = db.prepare(
            'SELECT * FROM window_slots WHERE window_id = ? AND item_id = ? AND date = ?'
          ).get(iw.window_id, item_id, appointment_date);
        }

        const windowUsed = db.prepare(
          `SELECT COUNT(*) as cnt FROM appointments 
           WHERE window_id = ? AND item_id = ? AND appointment_date = ? AND status != 'cancelled'`
        ).get(iw.window_id, item_id, appointment_date).cnt;

        const available = ws.max_count - windowUsed;

        if (available > 0 && available > bestAvailable) {
          bestAvailable = available;
          bestWindow = iw;
        }
      }

      if (!bestWindow) {
        throw new Error('所有窗口的号源均已满，请选择其他日期');
      }

      assignedWindowId = bestWindow.window_id;
    }
  } else if (!useTimeSlots) {
    let dailySlot = db.prepare('SELECT * FROM daily_slots WHERE item_id = ? AND date = ?').get(item_id, appointment_date);
    if (!dailySlot) {
      const defaultMax = item.default_max_count || 20;
      db.prepare('INSERT INTO daily_slots (item_id, date, max_count, current_count) VALUES (?, ?, ?, 0)').run(item_id, appointment_date, defaultMax);
      dailySlot = db.prepare('SELECT * FROM daily_slots WHERE item_id = ? AND date = ?').get(item_id, appointment_date);
    }

    if (dailySlot.current_count >= dailySlot.max_count) {
      throw new Error('该日期号源已满，请选择其他日期');
    }
  }

  const todayCount = db.prepare(
    'SELECT COUNT(*) as cnt FROM appointments WHERE item_id = ? AND appointment_date = ?'
  ).get(item_id, appointment_date).cnt;
  const queueNumber = todayCount + 1;

  const tx = db.transaction(() => {
    const result = db.prepare(
      'INSERT INTO appointments (item_id, user_name, phone, appointment_date, time_slot, status, queue_number, window_id, source, operator_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(item_id, user_name, phone, appointment_date, time_slot, 'pending', queueNumber, assignedWindowId, source, operator_name);

    const appointmentId = result.lastInsertRowid;

    if (useTimeSlots && matchedTimeSlot) {
      db.prepare(
        'UPDATE time_slot_capacities SET current_count = current_count + 1 WHERE id = ?'
      ).run(matchedTimeSlot.id);
    }

    if (assignedWindowId) {
      db.prepare(
        'UPDATE window_slots SET current_count = current_count + 1 WHERE window_id = ? AND item_id = ? AND date = ?'
      ).run(assignedWindowId, item_id, appointment_date);
    } else if (!useTimeSlots) {
      db.prepare('UPDATE daily_slots SET current_count = current_count + 1 WHERE item_id = ? AND date = ?').run(item_id, appointment_date);
    }

    const itemName = item.name;
    const windowName = assignedWindowId ? 
      db.prepare('SELECT name FROM windows WHERE id = ?').get(assignedWindowId)?.name : '';
    const reminderContent = generateReminderContent('created', {
      item_name: itemName,
      window_name: windowName,
      appointment_date,
      time_slot
    });
    createReminder(appointmentId, phone, 'created', reminderContent);

    return { id: appointmentId, window_id: assignedWindowId, window_name: windowName, queue_number: queueNumber };
  });

  return tx();
}

app.post('/api/appointments', (req, res) => {
  const { item_id, user_name, phone, appointment_date, time_slot } = req.body;

  try {
    const result = validateAndCreateAppointment({
      item_id,
      user_name,
      phone,
      appointment_date,
      time_slot,
      source: 'user'
    });

    res.json({
      id: result.id,
      item_id,
      user_name,
      phone,
      appointment_date,
      time_slot,
      status: 'pending',
      window_id: result.window_id,
      window_name: result.window_name
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/admin/appointments', (req, res) => {
  const { item_id, user_name, phone, appointment_date, time_slot, window_id, operator_name } = req.body;

  try {
    const result = validateAndCreateAppointment({
      item_id,
      user_name,
      phone,
      appointment_date,
      time_slot,
      source: 'admin',
      operator_name: operator_name || '管理员',
      window_id: window_id ? Number(window_id) : null
    });

    res.json({
      id: result.id,
      item_id,
      user_name,
      phone,
      appointment_date,
      time_slot,
      status: 'pending',
      window_id: result.window_id,
      window_name: result.window_name,
      queue_number: result.queue_number,
      source: 'admin'
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/appointments', (req, res) => {
  const { date, item_id, status, phone } = req.query;

  let sql = `SELECT a.*, i.name as item_name, w.name as window_name
             FROM appointments a 
             LEFT JOIN items i ON a.item_id = i.id
             LEFT JOIN windows w ON a.window_id = w.id
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
    SELECT a.*, i.name as item_name, i.description as item_description, w.name as window_name
    FROM appointments a
    LEFT JOIN items i ON a.item_id = i.id
    LEFT JOIN windows w ON a.window_id = w.id
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

  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(appointment.item_id);
  if (!isCancellationAllowed(appointment, item)) {
    const deadlineHours = item.cancel_deadline_hours;
    if (deadlineHours !== null && deadlineHours !== undefined) {
      return res.status(400).json({ error: `已超过取消截止时间（预约前 ${deadlineHours} 小时内不可取消）` });
    }
    return res.status(400).json({ error: '已过期的预约不能取消' });
  }

  db.prepare('UPDATE appointments SET status = ? WHERE id = ?').run('cancelled', id);

  const timeSlotCap = db.prepare(`
    SELECT * FROM time_slot_capacities 
    WHERE item_id = ? AND date = ?
  `).all(appointment.item_id, appointment.appointment_date);

  const hasTimeSlots = timeSlotCap.length > 0;

  if (hasTimeSlots) {
    const matched = timeSlotCap.find(ts => 
      appointment.time_slot === `${ts.start_time}-${ts.end_time}`
    );
    if (matched) {
      db.prepare(
        'UPDATE time_slot_capacities SET current_count = current_count - 1 WHERE id = ?'
      ).run(matched.id);
    }
  }

  if (appointment.window_id) {
    db.prepare(
      'UPDATE window_slots SET current_count = current_count - 1 WHERE window_id = ? AND item_id = ? AND date = ?'
    ).run(appointment.window_id, appointment.item_id, appointment.appointment_date);
  } else if (!hasTimeSlots) {
    db.prepare(
      'UPDATE daily_slots SET current_count = current_count - 1 WHERE item_id = ? AND date = ?'
    ).run(appointment.item_id, appointment.appointment_date);
  }

  const window = appointment.window_id ? 
    db.prepare('SELECT name FROM windows WHERE id = ?').get(appointment.window_id) : null;
  const reminderContent = generateReminderContent('cancelled', {
    item_name: item ? item.name : '',
    window_name: window ? window.name : '',
    appointment_date: appointment.appointment_date,
    time_slot: appointment.time_slot
  });
  createReminder(id, appointment.phone, 'cancelled', reminderContent);

  res.json({ success: true, message: '预约已取消，号源已释放' });
});

app.put('/api/appointments/:id/status', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const validStatuses = ['pending', 'arrived', 'calling', 'completed', 'cancelled'];
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

  if (status === 'calling') {
    if (oldStatus !== 'arrived') {
      return res.status(400).json({ error: '只有已到场的预约才能叫号' });
    }
    const existingCalling = db.prepare(
      'SELECT id FROM appointments WHERE item_id = ? AND appointment_date = ? AND status = ? AND id != ?'
    ).get(appointment.item_id, appointment.appointment_date, 'calling', id);
    if (existingCalling) {
      return res.status(400).json({ error: '该事项已有正在叫号的预约，请先完成或取消' });
    }
    db.prepare('UPDATE appointments SET status = ?, called_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, id);
  } else {
    db.prepare('UPDATE appointments SET status = ? WHERE id = ?').run(status, id);
  }

  if (status === 'cancelled' && oldStatus !== 'cancelled') {
    const timeSlotCap = db.prepare(`
      SELECT * FROM time_slot_capacities 
      WHERE item_id = ? AND date = ?
    `).all(appointment.item_id, appointment.appointment_date);

    const hasTimeSlots = timeSlotCap.length > 0;

    if (hasTimeSlots) {
      const matched = timeSlotCap.find(ts => 
        appointment.time_slot === `${ts.start_time}-${ts.end_time}`
      );
      if (matched) {
        db.prepare(
          'UPDATE time_slot_capacities SET current_count = current_count - 1 WHERE id = ?'
        ).run(matched.id);
      }
    }

    if (appointment.window_id) {
      db.prepare(
        'UPDATE window_slots SET current_count = current_count - 1 WHERE window_id = ? AND item_id = ? AND date = ?'
      ).run(appointment.window_id, appointment.item_id, appointment.appointment_date);
    } else if (!hasTimeSlots) {
      db.prepare(
        'UPDATE daily_slots SET current_count = current_count - 1 WHERE item_id = ? AND date = ?'
      ).run(appointment.item_id, appointment.appointment_date);
    }
  }

  if (oldStatus === 'cancelled' && status !== 'cancelled') {
    const timeSlotCap = db.prepare(`
      SELECT * FROM time_slot_capacities 
      WHERE item_id = ? AND date = ?
    `).all(appointment.item_id, appointment.appointment_date);

    const hasTimeSlots = timeSlotCap.length > 0;
    let canRestore = true;

    if (hasTimeSlots) {
      const matched = timeSlotCap.find(ts => 
        appointment.time_slot === `${ts.start_time}-${ts.end_time}`
      );
      if (matched) {
        if (matched.current_count >= matched.max_count) {
          canRestore = false;
        }
      }
    }

    if (appointment.window_id) {
      const slot = db.prepare(
        'SELECT * FROM window_slots WHERE window_id = ? AND item_id = ? AND date = ?'
      ).get(appointment.window_id, appointment.item_id, appointment.appointment_date);
      if (slot && slot.current_count >= slot.max_count) {
        canRestore = false;
      }
    } else if (!hasTimeSlots) {
      const slot = db.prepare('SELECT * FROM daily_slots WHERE item_id = ? AND date = ?').get(appointment.item_id, appointment.appointment_date);
      if (slot && slot.current_count >= slot.max_count) {
        canRestore = false;
      }
    }

    if (!canRestore) {
      db.prepare('UPDATE appointments SET status = ? WHERE id = ?').run(oldStatus, id);
      return res.status(400).json({ error: '号源已满，无法恢复预约' });
    }

    if (hasTimeSlots) {
      const matched = timeSlotCap.find(ts => 
        appointment.time_slot === `${ts.start_time}-${ts.end_time}`
      );
      if (matched) {
        db.prepare(
          'UPDATE time_slot_capacities SET current_count = current_count + 1 WHERE id = ?'
        ).run(matched.id);
      }
    }

    if (appointment.window_id) {
      db.prepare(
        'UPDATE window_slots SET current_count = current_count + 1 WHERE window_id = ? AND item_id = ? AND date = ?'
      ).run(appointment.window_id, appointment.item_id, appointment.appointment_date);
    } else if (!hasTimeSlots) {
      db.prepare(
        'UPDATE daily_slots SET current_count = current_count + 1 WHERE item_id = ? AND date = ?'
      ).run(appointment.item_id, appointment.appointment_date);
    }
  }

  const reminderTypes = ['arrived', 'calling', 'completed', 'cancelled'];
  if (reminderTypes.includes(status) && oldStatus !== status) {
    const item = db.prepare('SELECT name FROM items WHERE id = ?').get(appointment.item_id);
    const window = appointment.window_id ?
      db.prepare('SELECT name FROM windows WHERE id = ?').get(appointment.window_id) : null;
    const reminderContent = generateReminderContent(status, {
      item_name: item ? item.name : '',
      window_name: window ? window.name : '',
      appointment_date: appointment.appointment_date,
      time_slot: appointment.time_slot,
      user_name: appointment.user_name,
      queue_number: appointment.queue_number
    });
    createReminder(appointment.id, appointment.phone, status, reminderContent);
  }

  res.json({ success: true, status });
});

function parseSlotMaxCount(value) {
  const parsed = parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : NaN;
}

app.put('/api/slots/:itemId/:date/windows/max', (req, res) => {
  const { itemId, date } = req.params;
  const { windows } = req.body;

  if (!Array.isArray(windows) || windows.length === 0) {
    return res.status(400).json({ error: '窗口号源数据不能为空' });
  }

  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId);
  if (!item) {
    return res.status(404).json({ error: '事项不存在' });
  }

  const seenWindowIds = new Set();
  const updates = [];

  for (const entry of windows) {
    const windowId = parseInt(entry.window_id, 10);
    const maxCount = parseSlotMaxCount(entry.max_count);

    if (!windowId || seenWindowIds.has(windowId)) {
      return res.status(400).json({ error: '窗口号源数据无效' });
    }
    seenWindowIds.add(windowId);

    if (isNaN(maxCount) || maxCount < 0) {
      return res.status(400).json({ error: '号源数量不能小于0' });
    }

    const window = db.prepare('SELECT * FROM windows WHERE id = ?').get(windowId);
    if (!window) {
      return res.status(404).json({ error: `窗口不存在：${windowId}` });
    }

    const itemWindow = db.prepare(
      'SELECT * FROM item_windows WHERE item_id = ? AND window_id = ?'
    ).get(itemId, windowId);
    if (!itemWindow) {
      return res.status(400).json({ error: `窗口"${window.name}"未配置此事项` });
    }

    const existing = db.prepare(
      'SELECT * FROM window_slots WHERE window_id = ? AND item_id = ? AND date = ?'
    ).get(windowId, itemId, date);

    const usedCount = db.prepare(
      `SELECT COUNT(*) as cnt FROM appointments
       WHERE window_id = ? AND item_id = ? AND appointment_date = ? AND status != 'cancelled'`
    ).get(windowId, itemId, date).cnt;

    if (maxCount < usedCount) {
      return res.status(400).json({ error: `窗口"${window.name}"号源数量不能小于已预约数量` });
    }

    updates.push({ windowId, maxCount, usedCount, existing: !!existing });
  }

  const tx = db.transaction(() => {
    updates.forEach(({ windowId, maxCount, usedCount, existing }) => {
      if (existing) {
        db.prepare(
          'UPDATE window_slots SET max_count = ? WHERE window_id = ? AND item_id = ? AND date = ?'
        ).run(maxCount, windowId, itemId, date);
      } else {
        db.prepare(
          'INSERT INTO window_slots (window_id, item_id, date, max_count, current_count) VALUES (?, ?, ?, ?, ?)'
        ).run(windowId, itemId, date, maxCount, usedCount);
      }
    });
  });

  tx();

  const updated = db.prepare(`
    SELECT ws.*, w.name as window_name
    FROM window_slots ws
    LEFT JOIN windows w ON ws.window_id = w.id
    WHERE ws.item_id = ? AND ws.date = ?
    ORDER BY w.sort_order ASC, w.id ASC
  `).all(itemId, date);

  res.json({ success: true, windows: updated });
});

app.put('/api/slots/:itemId/:date/window/:windowId/max', (req, res) => {
  const { itemId, date, windowId } = req.params;
  const maxCount = parseSlotMaxCount(req.body.max_count);

  if (isNaN(maxCount) || maxCount < 0) {
    return res.status(400).json({ error: '号源数量不能小于0' });
  }

  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId);
  if (!item) {
    return res.status(404).json({ error: '事项不存在' });
  }

  const window = db.prepare('SELECT * FROM windows WHERE id = ?').get(windowId);
  if (!window) {
    return res.status(404).json({ error: '窗口不存在' });
  }

  const itemWindow = db.prepare(
    'SELECT * FROM item_windows WHERE item_id = ? AND window_id = ?'
  ).get(itemId, windowId);
  if (!itemWindow) {
    return res.status(400).json({ error: '该窗口未配置此事项' });
  }

  const existing = db.prepare(
    'SELECT * FROM window_slots WHERE window_id = ? AND item_id = ? AND date = ?'
  ).get(windowId, itemId, date);

  const usedCount = db.prepare(
    `SELECT COUNT(*) as cnt FROM appointments 
     WHERE window_id = ? AND item_id = ? AND appointment_date = ? AND status != 'cancelled'`
  ).get(windowId, itemId, date).cnt;

  if (existing) {
    if (maxCount < usedCount) {
      return res.status(400).json({ error: '号源数量不能小于已预约数量' });
    }
    db.prepare(
      'UPDATE window_slots SET max_count = ? WHERE window_id = ? AND item_id = ? AND date = ?'
    ).run(maxCount, windowId, itemId, date);
  } else {
    db.prepare(
      'INSERT INTO window_slots (window_id, item_id, date, max_count, current_count) VALUES (?, ?, ?, ?, ?)'
    ).run(windowId, itemId, date, maxCount, usedCount);
  }

  res.json({ success: true, max_count: maxCount });
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

app.get('/api/slots/:itemId/:date/time-slots', (req, res) => {
  const { itemId, date } = req.params;

  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId);
  if (!item) {
    return res.status(404).json({ error: '事项不存在' });
  }

  if (!isValidDate(date)) {
    return res.status(400).json({ error: '日期格式不正确' });
  }

  const timeSlots = db.prepare(`
    SELECT * FROM time_slot_capacities 
    WHERE item_id = ? AND date = ? 
    ORDER BY sort_order ASC, start_time ASC
  `).all(itemId, date);

  const totalMax = timeSlots.reduce((sum, ts) => sum + ts.max_count, 0);
  const totalCurrent = timeSlots.reduce((sum, ts) => sum + ts.current_count, 0);

  res.json({
    use_time_slots: timeSlots.length > 0,
    date,
    total_max: totalMax,
    total_current: totalCurrent,
    time_slots: timeSlots
  });
});

app.put('/api/slots/:itemId/:date/time-slots', (req, res) => {
  const { itemId, date } = req.params;
  const { time_slots } = req.body;

  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId);
  if (!item) {
    return res.status(404).json({ error: '事项不存在' });
  }

  if (!isValidDate(date)) {
    return res.status(400).json({ error: '日期格式不正确' });
  }

  const countActiveTimeSlotAppointments = (startTime, endTime) => {
    return db.prepare(`
      SELECT COUNT(*) as cnt FROM appointments
      WHERE item_id = ? AND appointment_date = ?
      AND time_slot = ? AND status != 'cancelled'
    `).get(itemId, date, `${startTime}-${endTime}`).cnt;
  };

  if (!Array.isArray(time_slots) || time_slots.length === 0) {
    const activeCount = db.prepare(`
      SELECT COUNT(*) as cnt FROM appointments a
      JOIN time_slot_capacities tsc
        ON a.item_id = tsc.item_id
       AND a.appointment_date = tsc.date
       AND a.time_slot = tsc.start_time || '-' || tsc.end_time
      WHERE tsc.item_id = ? AND tsc.date = ?
      AND a.status != 'cancelled'
    `).get(itemId, date).cnt;

    if (activeCount > 0) {
      return res.status(400).json({ error: '已有预约的分时段配置不能清除，请先取消相关预约或保留分时段模式' });
    }

    db.prepare('DELETE FROM time_slot_capacities WHERE item_id = ? AND date = ?').run(itemId, date);
    return res.json({ success: true, time_slots: [], use_time_slots: false });
  }

  const timeRegex = /^\d{2}:\d{2}$/;
  for (let i = 0; i < time_slots.length; i++) {
    const ts = time_slots[i];
    if (!ts.start_time || !timeRegex.test(ts.start_time)) {
      return res.status(400).json({ error: `第 ${i + 1} 条时段的开始时间格式不正确` });
    }
    if (!ts.end_time || !timeRegex.test(ts.end_time)) {
      return res.status(400).json({ error: `第 ${i + 1} 条时段的结束时间格式不正确` });
    }
    if (ts.start_time >= ts.end_time) {
      return res.status(400).json({ error: `第 ${i + 1} 条时段的开始时间必须早于结束时间` });
    }
    if (ts.max_count === undefined || ts.max_count === null || isNaN(parseInt(ts.max_count)) || parseInt(ts.max_count) < 0) {
      return res.status(400).json({ error: `第 ${i + 1} 条时段的容量必须为非负整数` });
    }
  }

  const sortedSlots = [...time_slots].sort((a, b) => a.start_time.localeCompare(b.start_time));
  for (let i = 0; i < sortedSlots.length - 1; i++) {
    const current = sortedSlots[i];
    const next = sortedSlots[i + 1];
    if (next.start_time < current.end_time) {
      return res.status(400).json({ 
        error: `时段 ${current.start_time}-${current.end_time} 与 ${next.start_time}-${next.end_time} 存在重叠` 
      });
    }
  }

  const existingSlots = db.prepare(
    'SELECT * FROM time_slot_capacities WHERE item_id = ? AND date = ?'
  ).all(itemId, date);

  const existingMap = new Map(existingSlots.map(s => [`${s.start_time}-${s.end_time}`, s]));

  const tx = db.transaction(() => {
    const newSlotKeys = new Set(time_slots.map(ts => `${ts.start_time}-${ts.end_time}`));

    for (const existing of existingSlots) {
      const key = `${existing.start_time}-${existing.end_time}`;
      if (!newSlotKeys.has(key)) {
        const usedCount = countActiveTimeSlotAppointments(existing.start_time, existing.end_time);
        if (usedCount > 0) {
          throw new Error(`时段 ${existing.start_time}-${existing.end_time} 已有预约，无法删除`);
        }
        db.prepare('DELETE FROM time_slot_capacities WHERE id = ?').run(existing.id);
      }
    }

    time_slots.forEach((ts, index) => {
      const key = `${ts.start_time}-${ts.end_time}`;
      const existing = existingMap.get(key);
      const maxCount = parseInt(ts.max_count);
      const usedCount = countActiveTimeSlotAppointments(ts.start_time, ts.end_time);

      if (maxCount < usedCount) {
        throw new Error(`时段 ${ts.start_time}-${ts.end_time} 的容量不能小于已预约数量 ${usedCount}`);
      }

      if (existing) {
        db.prepare(`
          UPDATE time_slot_capacities 
          SET max_count = ?, current_count = ?, sort_order = ?
          WHERE id = ?
        `).run(maxCount, usedCount, index, existing.id);
      } else {
        db.prepare(`
          INSERT INTO time_slot_capacities (item_id, date, start_time, end_time, max_count, current_count, sort_order)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(itemId, date, ts.start_time, ts.end_time, maxCount, usedCount, index);
      }
    });
  });

  try {
    tx();
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const updatedSlots = db.prepare(`
    SELECT * FROM time_slot_capacities 
    WHERE item_id = ? AND date = ? 
    ORDER BY sort_order ASC, start_time ASC
  `).all(itemId, date);

  const totalMax = updatedSlots.reduce((sum, ts) => sum + ts.max_count, 0);
  const totalCurrent = updatedSlots.reduce((sum, ts) => sum + ts.current_count, 0);

  res.json({
    success: true,
    use_time_slots: true,
    total_max: totalMax,
    total_current: totalCurrent,
    time_slots: updatedSlots
  });
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

app.get('/api/board/today', (req, res) => {
  const today = getTodayStr();

  const items = db.prepare('SELECT * FROM items ORDER BY id').all();

  const appointments = db.prepare(`
    SELECT a.*, i.name as item_name, w.name as window_name
    FROM appointments a
    LEFT JOIN items i ON a.item_id = i.id
    LEFT JOIN windows w ON a.window_id = w.id
    WHERE a.appointment_date = ?
    ORDER BY a.item_id ASC, a.queue_number ASC
  `).all(today);

  const result = items.map(item => {
    const itemApts = appointments.filter(a => a.item_id === item.id);
    const calling = itemApts.filter(a => a.status === 'calling');
    const waiting = itemApts.filter(a => a.status === 'arrived');
    const completed = itemApts.filter(a => a.status === 'completed');
    const pending = itemApts.filter(a => a.status === 'pending');

    return {
      item_id: item.id,
      item_name: item.name,
      calling: calling,
      waiting: waiting,
      completed: completed,
      pending: pending,
      total: itemApts.length,
      waiting_count: waiting.length,
      completed_count: completed.length
    };
  });

  const totalWaiting = appointments.filter(a => a.status === 'arrived').length;
  const totalCalling = appointments.filter(a => a.status === 'calling').length;
  const totalCompleted = appointments.filter(a => a.status === 'completed').length;

  res.json({
    date: today,
    items: result,
    summary: {
      total: appointments.length,
      waiting: totalWaiting,
      calling: totalCalling,
      completed: totalCompleted
    }
  });
});

app.post('/api/appointments/:id/call', (req, res) => {
  const { id } = req.params;

  const appointment = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  if (!appointment) {
    return res.status(404).json({ error: '预约不存在' });
  }

  if (appointment.status !== 'arrived') {
    return res.status(400).json({ error: '只有已到场的预约才能叫号' });
  }

  const currentCalling = db.prepare(
    'SELECT id FROM appointments WHERE item_id = ? AND appointment_date = ? AND status = ?'
  ).get(appointment.item_id, appointment.appointment_date, 'calling');

  if (currentCalling) {
    return res.status(400).json({ error: '该事项已有正在叫号的预约，请先完成或取消' });
  }

  const item = db.prepare('SELECT name FROM items WHERE id = ?').get(appointment.item_id);
  const window = appointment.window_id ? 
    db.prepare('SELECT name FROM windows WHERE id = ?').get(appointment.window_id) : null;

  const tx = db.transaction(() => {
    const recheck = db.prepare(
      'SELECT id FROM appointments WHERE item_id = ? AND appointment_date = ? AND status = ?'
    ).get(appointment.item_id, appointment.appointment_date, 'calling');
    if (recheck) {
      throw new Error('该事项已有正在叫号的预约');
    }

    db.prepare('UPDATE appointments SET status = ?, called_at = CURRENT_TIMESTAMP WHERE id = ?').run('calling', id);

    const reminderContent = generateReminderContent('calling', {
      item_name: item ? item.name : '',
      window_name: window ? window.name : '',
      appointment_date: appointment.appointment_date,
      time_slot: appointment.time_slot,
      user_name: appointment.user_name,
      queue_number: appointment.queue_number
    });
    createReminder(appointment.id, appointment.phone, 'calling', reminderContent);
  });

  try {
    tx();
    res.json({ success: true, message: '叫号成功' });
  } catch (e) {
    if (!res.headersSent) {
      if (e.message === '该事项已有正在叫号的预约') {
        res.status(400).json({ error: e.message });
      } else {
        res.status(500).json({ error: '叫号失败' });
      }
    }
  }
});

app.post('/api/appointments/:id/next', (req, res) => {
  const { id } = req.params;
  const { skip_current } = req.body;

  const currentApt = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  if (!currentApt) {
    return res.status(404).json({ error: '预约不存在' });
  }

  if (currentApt.status !== 'calling') {
    return res.status(400).json({ error: '该预约不在叫号状态' });
  }

  const tx = db.transaction(() => {
    if (skip_current) {
      db.prepare('UPDATE appointments SET status = ? WHERE id = ?').run('arrived', id);
    } else {
      db.prepare('UPDATE appointments SET status = ? WHERE id = ?').run('completed', id);
      const item = db.prepare('SELECT name FROM items WHERE id = ?').get(currentApt.item_id);
      const reminderContent = generateReminderContent('completed', {
        item_name: item ? item.name : '',
        appointment_date: currentApt.appointment_date,
        time_slot: currentApt.time_slot,
        user_name: currentApt.user_name,
        queue_number: currentApt.queue_number
      });
      createReminder(currentApt.id, currentApt.phone, 'completed', reminderContent);
    }

    const nextApt = db.prepare(`
      SELECT * FROM appointments
      WHERE item_id = ? AND appointment_date = ? AND status = ?
      ORDER BY queue_number ASC
      LIMIT 1
    `).get(currentApt.item_id, currentApt.appointment_date, 'arrived');

    if (nextApt) {
      const item = db.prepare('SELECT name FROM items WHERE id = ?').get(nextApt.item_id);
      const window = nextApt.window_id ? 
        db.prepare('SELECT name FROM windows WHERE id = ?').get(nextApt.window_id) : null;
      db.prepare('UPDATE appointments SET status = ?, called_at = CURRENT_TIMESTAMP WHERE id = ?').run('calling', nextApt.id);
      const reminderContent = generateReminderContent('calling', {
        item_name: item ? item.name : '',
        window_name: window ? window.name : '',
        appointment_date: nextApt.appointment_date,
        time_slot: nextApt.time_slot,
        user_name: nextApt.user_name,
        queue_number: nextApt.queue_number
      });
      createReminder(nextApt.id, nextApt.phone, 'calling', reminderContent);
      return { has_next: true, next: nextApt };
    }

    return { has_next: false, next: null };
  });

  try {
    const result = tx();
    res.json({
      success: true,
      has_next: result.has_next,
      next_appointment: result.next,
      message: result.has_next ? '已叫下一号' : '当前已是最后一位'
    });
  } catch (e) {
    res.status(500).json({ error: '操作失败' });
  }
});

app.post('/api/items/:itemId/call-next', (req, res) => {
  const { itemId } = req.params;
  const today = getTodayStr();

  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId);
  if (!item) {
    return res.status(404).json({ error: '事项不存在' });
  }

  const currentCalling = db.prepare(
    'SELECT id FROM appointments WHERE item_id = ? AND appointment_date = ? AND status = ?'
  ).get(itemId, today, 'calling');

  if (currentCalling) {
    return res.status(400).json({ error: '该事项已有正在叫号的预约' });
  }

  const nextApt = db.prepare(`
    SELECT * FROM appointments
    WHERE item_id = ? AND appointment_date = ? AND status = ?
    ORDER BY queue_number ASC
    LIMIT 1
  `).get(itemId, today, 'arrived');

  if (!nextApt) {
    return res.json({ success: true, has_next: false, message: '暂无等待叫号的预约' });
  }

  const tx = db.transaction(() => {
    const recheck = db.prepare(
      'SELECT id FROM appointments WHERE item_id = ? AND appointment_date = ? AND status = ?'
    ).get(itemId, today, 'calling');
    if (recheck) {
      throw new Error('该事项已有正在叫号的预约');
    }

    const window = nextApt.window_id ? 
      db.prepare('SELECT name FROM windows WHERE id = ?').get(nextApt.window_id) : null;

    db.prepare('UPDATE appointments SET status = ?, called_at = CURRENT_TIMESTAMP WHERE id = ?').run('calling', nextApt.id);
    const reminderContent = generateReminderContent('calling', {
      item_name: item.name,
      window_name: window ? window.name : '',
      appointment_date: nextApt.appointment_date,
      time_slot: nextApt.time_slot,
      user_name: nextApt.user_name,
      queue_number: nextApt.queue_number
    });
    createReminder(nextApt.id, nextApt.phone, 'calling', reminderContent);
  });

  try {
    tx();
    res.json({ success: true, has_next: true, appointment: nextApt, message: '叫号成功' });
  } catch (e) {
    if (e.message === '该事项已有正在叫号的预约') {
      res.status(400).json({ error: e.message });
    } else {
      res.status(500).json({ error: '叫号失败' });
    }
  }
});

app.get('/api/stats', (req, res) => {
  const today = getTodayStr();
  const totalToday = db.prepare('SELECT COUNT(*) as count FROM appointments WHERE appointment_date = ?').get(today).count;
  const pendingToday = db.prepare('SELECT COUNT(*) as count FROM appointments WHERE appointment_date = ? AND status = ?').get(today, 'pending').count;
  const completedToday = db.prepare('SELECT COUNT(*) as count FROM appointments WHERE appointment_date = ? AND status = ?').get(today, 'completed').count;
  const arrivedToday = db.prepare('SELECT COUNT(*) as count FROM appointments WHERE appointment_date = ? AND status = ?').get(today, 'arrived').count;
  const totalItems = db.prepare('SELECT COUNT(*) as count FROM items').get().count;

  const reviewToday = db.prepare('SELECT COUNT(*) as count FROM appointment_reviews WHERE DATE(created_at) = ?').get(today).count;
  const avgRatingRow = db.prepare('SELECT AVG(rating) as avg_rating FROM appointment_reviews WHERE DATE(created_at) = ?').get(today);
  const avgRatingToday = avgRatingRow.avg_rating ? parseFloat(avgRatingRow.avg_rating.toFixed(1)) : 0;

  res.json({
    today,
    total_today: totalToday,
    pending_today: pendingToday,
    completed_today: completedToday,
    arrived_today: arrivedToday,
    total_items: totalItems,
    review_today: reviewToday,
    avg_rating_today: avgRatingToday
  });
});

app.post('/api/reviews', (req, res) => {
  const { appointment_id, phone, rating, feedback } = req.body;

  if (!appointment_id || !phone || !rating) {
    return res.status(400).json({ error: '请填写完整信息' });
  }

  const ratingNum = parseInt(rating);
  if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    return res.status(400).json({ error: '评分必须在1-5之间' });
  }

  const phoneRegex = /^1[3-9]\d{9}$/;
  if (!phoneRegex.test(phone)) {
    return res.status(400).json({ error: '请输入正确的手机号' });
  }

  const appointment = db.prepare(`
    SELECT a.*, i.name as item_name 
    FROM appointments a 
    LEFT JOIN items i ON a.item_id = i.id 
    WHERE a.id = ?
  `).get(appointment_id);

  if (!appointment) {
    return res.status(404).json({ error: '预约记录不存在' });
  }

  if (appointment.phone !== phone) {
    return res.status(403).json({ error: '手机号不匹配' });
  }

  if (appointment.status !== 'completed') {
    return res.status(400).json({ error: '只有已办理的预约才能评价' });
  }

  const existingReview = db.prepare('SELECT id FROM appointment_reviews WHERE appointment_id = ?').get(appointment_id);
  if (existingReview) {
    return res.status(400).json({ error: '该预约已评价，不能重复评价' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO appointment_reviews (appointment_id, item_id, user_name, phone, rating, feedback)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      appointment_id,
      appointment.item_id,
      appointment.user_name,
      phone,
      ratingNum,
      feedback || ''
    );

    res.json({
      id: result.lastInsertRowid,
      appointment_id,
      rating: ratingNum,
      feedback: feedback || '',
      created_at: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ error: '提交评价失败' });
  }
});

app.get('/api/appointments/:id/review', (req, res) => {
  const { id } = req.params;
  const { phone } = req.query;

  if (!phone) {
    return res.status(400).json({ error: '请提供手机号' });
  }

  const review = db.prepare(`
    SELECT r.*, i.name as item_name
    FROM appointment_reviews r
    LEFT JOIN items i ON r.item_id = i.id
    WHERE r.appointment_id = ? AND r.phone = ?
  `).get(id, phone);

  if (!review) {
    return res.status(404).json({ error: '未找到评价记录' });
  }

  res.json(review);
});

app.get('/api/reviews', (req, res) => {
  const { date, item_id, rating, phone, page = 1, page_size = 20 } = req.query;

  let countSql = `SELECT COUNT(*) as total FROM appointment_reviews WHERE 1=1`;
  let sql = `
    SELECT r.*, i.name as item_name, a.appointment_date, a.time_slot
    FROM appointment_reviews r
    LEFT JOIN items i ON r.item_id = i.id
    LEFT JOIN appointments a ON r.appointment_id = a.id
    WHERE 1=1
  `;
  const params = [];
  const countParams = [];

  if (date) {
    sql += ' AND DATE(r.created_at) = ?';
    countSql += ' AND DATE(created_at) = ?';
    params.push(date);
    countParams.push(date);
  }
  if (item_id) {
    sql += ' AND r.item_id = ?';
    countSql += ' AND item_id = ?';
    params.push(item_id);
    countParams.push(item_id);
  }
  if (rating) {
    sql += ' AND r.rating = ?';
    countSql += ' AND rating = ?';
    params.push(parseInt(rating));
    countParams.push(parseInt(rating));
  }
  if (phone) {
    sql += ' AND r.phone = ?';
    countSql += ' AND phone = ?';
    params.push(phone);
    countParams.push(phone);
  }

  sql += ' ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?';
  const limit = parseInt(page_size) || 20;
  const offset = (parseInt(page) - 1) * limit;
  params.push(limit, offset);

  const reviews = db.prepare(sql).all(...params);
  const total = db.prepare(countSql).get(...countParams).total;

  res.json({
    list: reviews,
    total,
    page: parseInt(page),
    page_size: limit,
    total_pages: Math.ceil(total / limit)
  });
});

app.get('/api/phone-restrictions', (req, res) => {
  const { phone, status, page = 1, page_size = 20 } = req.query;

  let countSql = 'SELECT COUNT(*) as total FROM phone_restrictions WHERE 1=1';
  let sql = 'SELECT * FROM phone_restrictions WHERE 1=1';
  const params = [];
  const countParams = [];

  if (phone) {
    sql += ' AND phone LIKE ?';
    countSql += ' AND phone LIKE ?';
    params.push(`%${phone}%`);
    countParams.push(`%${phone}%`);
  }

  if (status === 'active') {
    const todayStr = getTodayStr();
    sql += ' AND end_date >= ?';
    countSql += ' AND end_date >= ?';
    params.push(todayStr);
    countParams.push(todayStr);
  } else if (status === 'expired') {
    const todayStr = getTodayStr();
    sql += ' AND end_date < ?';
    countSql += ' AND end_date < ?';
    params.push(todayStr);
    countParams.push(todayStr);
  }

  sql += ' ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?';
  const limit = parseInt(page_size) || 20;
  const offset = (parseInt(page) - 1) * limit;
  params.push(limit, offset);

  const restrictions = db.prepare(sql).all(...params);
  const total = db.prepare(countSql).get(...countParams).total;

  const todayStr = getTodayStr();
  const result = restrictions.map(r => ({
    ...r,
    is_active: r.end_date >= todayStr
  }));

  res.json({
    list: result,
    total,
    page: parseInt(page),
    page_size: limit,
    total_pages: Math.ceil(total / limit)
  });
});

app.post('/api/phone-restrictions', (req, res) => {
  const { phone, reason, end_date } = req.body;

  if (!phone) {
    return res.status(400).json({ error: '手机号不能为空' });
  }

  const phoneRegex = /^1[3-9]\d{9}$/;
  if (!phoneRegex.test(phone)) {
    return res.status(400).json({ error: '请输入正确的手机号' });
  }

  if (!end_date) {
    return res.status(400).json({ error: '截止日期不能为空' });
  }

  if (!isValidDate(end_date)) {
    return res.status(400).json({ error: '截止日期格式不正确' });
  }

  const todayStr = getTodayStr();
  if (end_date < todayStr) {
    return res.status(400).json({ error: '截止日期不能早于今天' });
  }

  const existing = db.prepare('SELECT id FROM phone_restrictions WHERE phone = ?').get(phone);
  if (existing) {
    return res.status(400).json({ error: '该手机号已在限制名单中' });
  }

  try {
    const result = db.prepare(
      'INSERT INTO phone_restrictions (phone, reason, end_date) VALUES (?, ?, ?)'
    ).run(phone, reason || '', end_date);

    res.json({
      id: result.lastInsertRowid,
      phone,
      reason: reason || '',
      end_date,
      is_active: true
    });
  } catch (e) {
    res.status(500).json({ error: '添加失败' });
  }
});

app.put('/api/phone-restrictions/:id', (req, res) => {
  const { id } = req.params;
  const { phone, reason, end_date } = req.body;

  const restriction = db.prepare('SELECT * FROM phone_restrictions WHERE id = ?').get(id);
  if (!restriction) {
    return res.status(404).json({ error: '限制记录不存在' });
  }

  if (phone !== undefined) {
    if (!phone) {
      return res.status(400).json({ error: '手机号不能为空' });
    }
    const phoneRegex = /^1[3-9]\d{9}$/;
    if (!phoneRegex.test(phone)) {
      return res.status(400).json({ error: '请输入正确的手机号' });
    }
    const existing = db.prepare('SELECT id FROM phone_restrictions WHERE phone = ? AND id != ?').get(phone, id);
    if (existing) {
      return res.status(400).json({ error: '该手机号已在限制名单中' });
    }
  }

  if (end_date !== undefined) {
    if (!isValidDate(end_date)) {
      return res.status(400).json({ error: '截止日期格式不正确' });
    }
  }

  const newPhone = phone !== undefined ? phone : restriction.phone;
  const newReason = reason !== undefined ? reason : restriction.reason;
  const newEndDate = end_date !== undefined ? end_date : restriction.end_date;

  try {
    db.prepare(
      'UPDATE phone_restrictions SET phone = ?, reason = ?, end_date = ? WHERE id = ?'
    ).run(newPhone, newReason, newEndDate, id);

    const todayStr = getTodayStr();
    res.json({
      id: parseInt(id),
      phone: newPhone,
      reason: newReason,
      end_date: newEndDate,
      is_active: newEndDate >= todayStr
    });
  } catch (e) {
    res.status(500).json({ error: '更新失败' });
  }
});

app.delete('/api/phone-restrictions/:id', (req, res) => {
  const { id } = req.params;

  const restriction = db.prepare('SELECT id FROM phone_restrictions WHERE id = ?').get(id);
  if (!restriction) {
    return res.status(404).json({ error: '限制记录不存在' });
  }

  db.prepare('DELETE FROM phone_restrictions WHERE id = ?').run(id);
  res.json({ success: true });
});

app.post('/api/appointments/:id/reschedule', (req, res) => {
  const { id } = req.params;
  const { phone, new_date, new_time_slot, reason } = req.body;

  if (!phone) {
    return res.status(400).json({ error: '请提供手机号' });
  }
  if (!new_date || !new_time_slot) {
    return res.status(400).json({ error: '请选择新的预约日期和时段' });
  }

  const appointment = db.prepare(`
    SELECT a.*, i.name as item_name 
    FROM appointments a
    LEFT JOIN items i ON a.item_id = i.id
    WHERE a.id = ?
  `).get(id);

  if (!appointment) {
    return res.status(404).json({ error: '预约不存在' });
  }

  if (appointment.phone !== phone) {
    return res.status(403).json({ error: '手机号不匹配，无权改期' });
  }

  if (appointment.status !== 'pending') {
    return res.status(400).json({ error: '只有待办理状态的预约才能改期' });
  }

  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(appointment.item_id);
  if (!item) {
    return res.status(400).json({ error: '事项不存在' });
  }

  if (!isReschedulingAllowed(appointment, item)) {
    const deadlineHours = item.reschedule_deadline_hours;
    if (deadlineHours !== null && deadlineHours !== undefined) {
      return res.status(400).json({ error: `已超过改期截止时间（预约前 ${deadlineHours} 小时内不可改期）` });
    }
    return res.status(400).json({ error: '已过期的预约不能改期' });
  }

  function getLocalDateStr(d) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  
  const todayStr = getLocalDateStr(new Date());
  const newDateObj = new Date(new_date);
  newDateObj.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isNewDateToday = newDateObj.getTime() === today.getTime();

  if (new_date < todayStr) {
    return res.status(400).json({ error: '不能改期到过去的日期' });
  }

  if (isNewDateToday && !isSameDayReschedulingAllowed(item)) {
    return res.status(400).json({ error: '该事项不支持当天预约' });
  }

  if (!isDateWithinAdvanceWeeks(new_date, item)) {
    const maxDate = getMaxAdvanceDate(item);
    const maxDateStr = maxDate.toISOString().split('T')[0];
    return res.status(400).json({ error: `超出可预约范围，最远可预约至 ${maxDateStr}` });
  }

  if (!isWorkday(new_date)) {
    return res.status(400).json({ error: '新日期为节假日或周末，不可预约' });
  }

  if (new_date === appointment.appointment_date && new_time_slot === appointment.time_slot) {
    return res.status(400).json({ error: '新时段与原时段相同，无需改期' });
  }

  const timeSlotCaps = db.prepare(`
    SELECT * FROM time_slot_capacities 
    WHERE item_id = ? AND date = ? 
    ORDER BY sort_order ASC, start_time ASC
  `).all(appointment.item_id, new_date);

  let useTimeSlots = timeSlotCaps.length > 0;
  let matchedNewTimeSlot = null;

  if (useTimeSlots) {
    for (const tsc of timeSlotCaps) {
      if (new_time_slot === `${tsc.start_time}-${tsc.end_time}`) {
        matchedNewTimeSlot = tsc;
        break;
      }
    }
    if (!matchedNewTimeSlot) {
      return res.status(400).json({ error: '所选时段无效，请重新选择' });
    }
    if (matchedNewTimeSlot.current_count >= matchedNewTimeSlot.max_count) {
      return res.status(400).json({ error: '该时段号源已满，请选择其他时段' });
    }
  } else {
    const slotCheck = db.prepare(
      `SELECT COUNT(*) as cnt FROM appointments 
       WHERE item_id = ? AND appointment_date = ? AND time_slot = ? AND status != 'cancelled'`
    ).get(appointment.item_id, new_date, new_time_slot);
    if (slotCheck.cnt > 0) {
      return res.status(400).json({ error: '该时段已被预约，请选择其他时段' });
    }
  }

  let assignedNewWindowId = null;

  const allItemWindows = db.prepare(`
    SELECT COUNT(*) as cnt
    FROM item_windows iw
    WHERE iw.item_id = ?
  `).get(appointment.item_id).cnt;

  if (allItemWindows > 0) {
    const itemWindows = db.prepare(`
      SELECT iw.*, w.name as window_name, w.status as window_status
      FROM item_windows iw
      LEFT JOIN windows w ON iw.window_id = w.id
      WHERE iw.item_id = ? AND w.status = 'active'
      ORDER BY w.sort_order ASC, w.id ASC
    `).all(appointment.item_id);

    if (itemWindows.length === 0) {
      return res.status(400).json({ error: '该事项暂无可用办理窗口' });
    }

    let bestWindow = null;
    let bestAvailable = -1;

    for (const iw of itemWindows) {
      let ws = db.prepare(
        'SELECT * FROM window_slots WHERE window_id = ? AND item_id = ? AND date = ?'
      ).get(iw.window_id, appointment.item_id, new_date);

      if (!ws) {
        const defaultCapacity = iw.default_capacity || 10;
        db.prepare(
          'INSERT INTO window_slots (window_id, item_id, date, max_count, current_count) VALUES (?, ?, ?, ?, 0)'
        ).run(iw.window_id, appointment.item_id, new_date, defaultCapacity);
        ws = db.prepare(
          'SELECT * FROM window_slots WHERE window_id = ? AND item_id = ? AND date = ?'
        ).get(iw.window_id, appointment.item_id, new_date);
      }

      const windowUsed = db.prepare(
        `SELECT COUNT(*) as cnt FROM appointments 
         WHERE window_id = ? AND item_id = ? AND appointment_date = ? AND status != 'cancelled'`
      ).get(iw.window_id, appointment.item_id, new_date).cnt;

      const available = ws.max_count - windowUsed;

      if (available > 0 && available > bestAvailable) {
        bestAvailable = available;
        bestWindow = iw;
      }
    }

    if (!bestWindow) {
      return res.status(400).json({ error: '所有窗口的号源均已满，请选择其他日期' });
    }

    assignedNewWindowId = bestWindow.window_id;
  } else if (!useTimeSlots) {
    let dailySlot = db.prepare('SELECT * FROM daily_slots WHERE item_id = ? AND date = ?').get(appointment.item_id, new_date);
    if (!dailySlot) {
      const defaultMax = item.default_max_count || 20;
      db.prepare('INSERT INTO daily_slots (item_id, date, max_count, current_count) VALUES (?, ?, ?, 0)').run(appointment.item_id, new_date, defaultMax);
      dailySlot = db.prepare('SELECT * FROM daily_slots WHERE item_id = ? AND date = ?').get(appointment.item_id, new_date);
    }
    if (dailySlot.current_count >= dailySlot.max_count) {
      return res.status(400).json({ error: '该日期号源已满，请选择其他日期' });
    }
  }

  const oldTimeSlotCap = db.prepare(`
    SELECT * FROM time_slot_capacities 
    WHERE item_id = ? AND date = ?
  `).all(appointment.item_id, appointment.appointment_date);
  const hasOldTimeSlots = oldTimeSlotCap.length > 0;
  let matchedOldTimeSlot = null;
  if (hasOldTimeSlots) {
    matchedOldTimeSlot = oldTimeSlotCap.find(ts => 
      appointment.time_slot === `${ts.start_time}-${ts.end_time}`
    );
  }

  const tx = db.transaction(() => {
    const recheckAppointment = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
    if (!recheckAppointment || recheckAppointment.status !== 'pending') {
      throw new Error('预约状态已变更，无法改期');
    }

    if (hasOldTimeSlots && matchedOldTimeSlot) {
      const newCount = matchedOldTimeSlot.current_count - 1;
      if (newCount < 0) {
        throw new Error('原时段号源计数异常');
      }
      db.prepare(
        'UPDATE time_slot_capacities SET current_count = current_count - 1 WHERE id = ?'
      ).run(matchedOldTimeSlot.id);
    }

    if (appointment.window_id) {
      db.prepare(
        'UPDATE window_slots SET current_count = current_count - 1 WHERE window_id = ? AND item_id = ? AND date = ?'
      ).run(appointment.window_id, appointment.item_id, appointment.appointment_date);
    } else if (!hasOldTimeSlots) {
      db.prepare(
        'UPDATE daily_slots SET current_count = current_count - 1 WHERE item_id = ? AND date = ?'
      ).run(appointment.item_id, appointment.appointment_date);
    }

    if (useTimeSlots && matchedNewTimeSlot) {
      const recheckSlot = db.prepare('SELECT * FROM time_slot_capacities WHERE id = ?').get(matchedNewTimeSlot.id);
      if (!recheckSlot || recheckSlot.current_count >= recheckSlot.max_count) {
        throw new Error('新时段号源已满，请重新选择');
      }
      db.prepare(
        'UPDATE time_slot_capacities SET current_count = current_count + 1 WHERE id = ?'
      ).run(matchedNewTimeSlot.id);
    }

    if (assignedNewWindowId) {
      const recheckSlot = db.prepare(
        'SELECT * FROM window_slots WHERE window_id = ? AND item_id = ? AND date = ?'
      ).get(assignedNewWindowId, appointment.item_id, new_date);
      if (!recheckSlot || recheckSlot.current_count >= recheckSlot.max_count) {
        throw new Error('新窗口号源已满，请重新选择');
      }
      db.prepare(
        'UPDATE window_slots SET current_count = current_count + 1 WHERE window_id = ? AND item_id = ? AND date = ?'
      ).run(assignedNewWindowId, appointment.item_id, new_date);
    } else if (!useTimeSlots) {
      const recheckSlot = db.prepare('SELECT * FROM daily_slots WHERE item_id = ? AND date = ?').get(appointment.item_id, new_date);
      if (!recheckSlot || recheckSlot.current_count >= recheckSlot.max_count) {
        throw new Error('新日期号源已满，请重新选择');
      }
      db.prepare(
        'UPDATE daily_slots SET current_count = current_count + 1 WHERE item_id = ? AND date = ?'
      ).run(appointment.item_id, new_date);
    }

    db.prepare(
      'UPDATE appointments SET appointment_date = ?, time_slot = ?, window_id = ? WHERE id = ?'
    ).run(new_date, new_time_slot, assignedNewWindowId, id);

    db.prepare(`
      INSERT INTO appointment_reschedules 
      (appointment_id, item_id, old_date, old_time_slot, old_window_id, 
       new_date, new_time_slot, new_window_id, operator_type, operator_name, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, appointment.item_id,
      appointment.appointment_date, appointment.time_slot, appointment.window_id,
      new_date, new_time_slot, assignedNewWindowId,
      'user', appointment.user_name, reason || ''
    );

    const itemName = item.name;
    const windowName = assignedNewWindowId ? 
      db.prepare('SELECT name FROM windows WHERE id = ?').get(assignedNewWindowId)?.name : '';
    const rescheduleContent = `【预约改期】您的${itemName}预约已改期，新预约日期：${new_date} ${new_time_slot}${windowName ? '，办理窗口：' + windowName : ''}，请准时前往办理。`;
    createReminder(id, phone, 'rescheduled', rescheduleContent);

    return { window_id: assignedNewWindowId, window_name: windowName };
  });

  try {
    const result = tx();
    const updatedAppointment = db.prepare(`
      SELECT a.*, i.name as item_name, w.name as window_name
      FROM appointments a
      LEFT JOIN items i ON a.item_id = i.id
      LEFT JOIN windows w ON a.window_id = w.id
      WHERE a.id = ?
    `).get(id);

    res.json({
      success: true,
      message: '改期成功',
      appointment: updatedAppointment
    });
  } catch (e) {
    if (e.message === '预约状态已变更，无法改期' || 
        e.message === '新时段号源已满，请重新选择' ||
        e.message === '新窗口号源已满，请重新选择' ||
        e.message === '新日期号源已满，请重新选择' ||
        e.message === '原时段号源计数异常') {
      res.status(400).json({ error: e.message });
    } else {
      console.error('改期失败:', e);
      res.status(500).json({ error: '改期失败，请重试' });
    }
  }
});

app.get('/api/appointments/:id/reschedules', (req, res) => {
  const { id } = req.params;
  const { phone } = req.query;

  const appointment = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  if (!appointment) {
    return res.status(404).json({ error: '预约不存在' });
  }

  if (phone && appointment.phone !== phone) {
    return res.status(403).json({ error: '手机号不匹配' });
  }

  const reschedules = db.prepare(`
    SELECT r.*, i.name as item_name, 
           w1.name as old_window_name, 
           w2.name as new_window_name
    FROM appointment_reschedules r
    LEFT JOIN items i ON r.item_id = i.id
    LEFT JOIN windows w1 ON r.old_window_id = w1.id
    LEFT JOIN windows w2 ON r.new_window_id = w2.id
    WHERE r.appointment_id = ?
    ORDER BY r.created_at DESC, r.id DESC
  `).all(id);

  res.json(reschedules);
});

app.get('/api/reschedules', (req, res) => {
  const { date, item_id, phone, page = 1, page_size = 20 } = req.query;

  let countSql = 'SELECT COUNT(*) as total FROM appointment_reschedules WHERE 1=1';
  let sql = `
    SELECT r.*, i.name as item_name, 
           w1.name as old_window_name, 
           w2.name as new_window_name,
           a.user_name, a.phone
    FROM appointment_reschedules r
    LEFT JOIN items i ON r.item_id = i.id
    LEFT JOIN windows w1 ON r.old_window_id = w1.id
    LEFT JOIN windows w2 ON r.new_window_id = w2.id
    LEFT JOIN appointments a ON r.appointment_id = a.id
    WHERE 1=1
  `;
  const params = [];
  const countParams = [];

  if (date) {
    sql += ' AND r.new_date = ?';
    countSql += ' AND new_date = ?';
    params.push(date);
    countParams.push(date);
  }
  if (item_id) {
    sql += ' AND r.item_id = ?';
    countSql += ' AND item_id = ?';
    params.push(item_id);
    countParams.push(item_id);
  }
  if (phone) {
    sql += ' AND a.phone = ?';
    countSql += ' AND appointment_id IN (SELECT id FROM appointments WHERE phone = ?)';
    params.push(phone);
    countParams.push(phone);
  }

  sql += ' ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?';
  const limit = parseInt(page_size) || 20;
  const offset = (parseInt(page) - 1) * limit;
  params.push(limit, offset);

  const list = db.prepare(sql).all(...params);
  const total = db.prepare(countSql).get(...countParams).total;

  res.json({
    list,
    total,
    page: parseInt(page),
    page_size: limit,
    total_pages: Math.ceil(total / limit)
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/board', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'board.html'));
});

app.get('/api/windows/:windowId/queue', (req, res) => {
  const { windowId } = req.params;
  const today = getTodayStr();

  const window = db.prepare('SELECT * FROM windows WHERE id = ?').get(windowId);
  if (!window) {
    return res.status(404).json({ error: '窗口不存在' });
  }

  const appointments = db.prepare(`
    SELECT a.*, i.name as item_name, w.name as window_name
    FROM appointments a
    LEFT JOIN items i ON a.item_id = i.id
    LEFT JOIN windows w ON a.window_id = w.id
    WHERE a.window_id = ? AND a.appointment_date = ? AND a.status IN ('arrived', 'calling')
    ORDER BY 
      CASE a.status WHEN 'calling' THEN 0 WHEN 'arrived' THEN 1 END,
      a.queue_number ASC
  `).all(windowId, today);

  const calling = appointments.filter(a => a.status === 'calling');
  const waiting = appointments.filter(a => a.status === 'arrived');

  const totalApts = db.prepare(`
    SELECT COUNT(*) as cnt FROM appointments
    WHERE window_id = ? AND appointment_date = ? AND status != 'cancelled'
  `).get(windowId, today).cnt;

  const completedApts = db.prepare(`
    SELECT COUNT(*) as cnt FROM appointments
    WHERE window_id = ? AND appointment_date = ? AND status = 'completed'
  `).get(windowId, today).cnt;

  res.json({
    window: window,
    date: today,
    calling: calling,
    waiting: waiting,
    total_count: totalApts,
    waiting_count: waiting.length,
    completed_count: completedApts,
    has_calling: calling.length > 0
  });
});

app.post('/api/windows/:windowId/call-next', (req, res) => {
  const { windowId } = req.params;
  const today = getTodayStr();

  const window = db.prepare('SELECT * FROM windows WHERE id = ?').get(windowId);
  if (!window) {
    return res.status(404).json({ error: '窗口不存在' });
  }

  const currentCalling = db.prepare(
    'SELECT id FROM appointments WHERE window_id = ? AND appointment_date = ? AND status = ?'
  ).get(windowId, today, 'calling');

  if (currentCalling) {
    return res.status(400).json({ error: '该窗口已有正在叫号的预约，请先完成或跳过' });
  }

  const nextApt = db.prepare(`
    SELECT a.*, i.name as item_name
    FROM appointments a
    LEFT JOIN items i ON a.item_id = i.id
    WHERE a.window_id = ? AND a.appointment_date = ? AND a.status = ?
    ORDER BY a.queue_number ASC
    LIMIT 1
  `).get(windowId, today, 'arrived');

  if (!nextApt) {
    return res.json({ success: true, has_next: false, message: '暂无等待叫号的预约' });
  }

  const tx = db.transaction(() => {
    const recheck = db.prepare(
      'SELECT id FROM appointments WHERE window_id = ? AND appointment_date = ? AND status = ?'
    ).get(windowId, today, 'calling');
    if (recheck) {
      throw new Error('该窗口已有正在叫号的预约');
    }

    db.prepare('UPDATE appointments SET status = ?, called_at = CURRENT_TIMESTAMP WHERE id = ?').run('calling', nextApt.id);

    const reminderContent = generateReminderContent('calling', {
      item_name: nextApt.item_name || '',
      window_name: window.name || '',
      appointment_date: nextApt.appointment_date,
      time_slot: nextApt.time_slot,
      user_name: nextApt.user_name,
      queue_number: nextApt.queue_number
    });
    createReminder(nextApt.id, nextApt.phone, 'calling', reminderContent);
  });

  try {
    tx();
    res.json({ success: true, has_next: true, appointment: nextApt, message: '叫号成功' });
  } catch (e) {
    if (e.message === '该窗口已有正在叫号的预约') {
      res.status(400).json({ error: e.message });
    } else {
      res.status(500).json({ error: '叫号失败' });
    }
  }
});

app.post('/api/windows/:windowId/complete', (req, res) => {
  const { windowId } = req.params;
  const today = getTodayStr();

  const window = db.prepare('SELECT * FROM windows WHERE id = ?').get(windowId);
  if (!window) {
    return res.status(404).json({ error: '窗口不存在' });
  }

  const currentApt = db.prepare(
    'SELECT * FROM appointments WHERE window_id = ? AND appointment_date = ? AND status = ?'
  ).get(windowId, today, 'calling');

  if (!currentApt) {
    return res.status(400).json({ error: '该窗口当前没有正在叫号的预约' });
  }

  const item = db.prepare('SELECT name FROM items WHERE id = ?').get(currentApt.item_id);

  db.prepare('UPDATE appointments SET status = ? WHERE id = ?').run('completed', currentApt.id);

  const reminderContent = generateReminderContent('completed', {
    item_name: item ? item.name : '',
    window_name: window.name || '',
    appointment_date: currentApt.appointment_date,
    time_slot: currentApt.time_slot,
    user_name: currentApt.user_name,
    queue_number: currentApt.queue_number
  });
  createReminder(currentApt.id, currentApt.phone, 'completed', reminderContent);

  res.json({ success: true, message: '办理完成', completed_appointment: currentApt });
});

app.post('/api/windows/:windowId/skip', (req, res) => {
  const { windowId } = req.params;
  const today = getTodayStr();

  const window = db.prepare('SELECT * FROM windows WHERE id = ?').get(windowId);
  if (!window) {
    return res.status(404).json({ error: '窗口不存在' });
  }

  const currentApt = db.prepare(
    'SELECT * FROM appointments WHERE window_id = ? AND appointment_date = ? AND status = ?'
  ).get(windowId, today, 'calling');

  if (!currentApt) {
    return res.status(400).json({ error: '该窗口当前没有正在叫号的预约' });
  }

  const tx = db.transaction(() => {
    db.prepare('UPDATE appointments SET status = ? WHERE id = ?').run('arrived', currentApt.id);

    const nextApt = db.prepare(`
      SELECT a.*, i.name as item_name
      FROM appointments a
      LEFT JOIN items i ON a.item_id = i.id
      WHERE a.window_id = ? AND a.appointment_date = ? AND a.status = ? AND a.id != ?
      ORDER BY a.queue_number ASC
      LIMIT 1
    `).get(windowId, today, 'arrived', currentApt.id);

    if (nextApt) {
      db.prepare('UPDATE appointments SET status = ?, called_at = CURRENT_TIMESTAMP WHERE id = ?').run('calling', nextApt.id);
      const reminderContent = generateReminderContent('calling', {
        item_name: nextApt.item_name || '',
        window_name: window.name || '',
        appointment_date: nextApt.appointment_date,
        time_slot: nextApt.time_slot,
        user_name: nextApt.user_name,
        queue_number: nextApt.queue_number
      });
      createReminder(nextApt.id, nextApt.phone, 'calling', reminderContent);
      return { has_next: true, next: nextApt, skipped: currentApt };
    }

    return { has_next: false, next: null, skipped: currentApt };
  });

  try {
    const result = tx();
    res.json({
      success: true,
      has_next: result.has_next,
      next_appointment: result.next,
      skipped_appointment: result.skipped,
      message: result.has_next ? '已跳过，叫下一位' : '已跳过，暂无下一位'
    });
  } catch (e) {
    res.status(500).json({ error: '操作失败' });
  }
});

app.get('/api/board/windows', (req, res) => {
  const today = getTodayStr();

  const windows = db.prepare('SELECT * FROM windows WHERE status = ? ORDER BY sort_order ASC, id ASC').all('active');

  const result = windows.map(window => {
    const appointments = db.prepare(`
      SELECT a.*, i.name as item_name
      FROM appointments a
      LEFT JOIN items i ON a.item_id = i.id
      WHERE a.window_id = ? AND a.appointment_date = ?
      ORDER BY a.queue_number ASC
    `).all(window.id, today);

    const calling = appointments.filter(a => a.status === 'calling');
    const waiting = appointments.filter(a => a.status === 'arrived');
    const completed = appointments.filter(a => a.status === 'completed');
    const pending = appointments.filter(a => a.status === 'pending');

    const currentCalling = calling.length > 0 ? calling[0] : null;

    return {
      window_id: window.id,
      window_name: window.name,
      window_description: window.description,
      current_calling: currentCalling,
      current_number: currentCalling ? currentCalling.queue_number : null,
      waiting_count: waiting.length,
      completed_count: completed.length,
      pending_count: pending.length,
      total_count: appointments.length
    };
  });

  const totalCalling = result.filter(r => r.current_calling).length;
  const totalWaiting = result.reduce((sum, r) => sum + r.waiting_count, 0);
  const totalCompleted = result.reduce((sum, r) => sum + r.completed_count, 0);

  res.json({
    date: today,
    windows: result,
    summary: {
      total_windows: windows.length,
      calling: totalCalling,
      waiting: totalWaiting,
      completed: totalCompleted
    }
  });
});

app.listen(PORT, () => {
  console.log(`预约系统已启动: http://localhost:${PORT}`);
  console.log(`后台管理: http://localhost:${PORT}/admin`);
});
