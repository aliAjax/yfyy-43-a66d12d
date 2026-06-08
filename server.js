const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDatabase, getSystemSetting: getSysSetting, setSystemSetting: setSysSetting } = require('./db');
const createReminderService = require('./services/reminderService');
const createCapacityService = require('./services/capacityService');
const createWindowService = require('./services/windowService');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = initDatabase();

const capacityService = createCapacityService(db);
const reminderService = createReminderService(db);
const windowService = createWindowService(db, capacityService);

function getSystemSetting(key, defaultValue = null) {
  return getSysSetting(db, key, defaultValue);
}

function setSystemSetting(key, value) {
  return setSysSetting(db, key, value);
}

app.get('/api/health', (req, res) => {
  try {
    const itemsCount = db.prepare('SELECT COUNT(*) as cnt FROM items').get().cnt;
    const appointmentsCount = db.prepare('SELECT COUNT(*) as cnt FROM appointments').get().cnt;
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: 'connected',
      stats: {
        items: itemsCount,
        appointments: appointmentsCount
      }
    });
  } catch (e) {
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: e.message
    });
  }
});

const createReminder = reminderService.createReminder.bind(reminderService);
const generateReminderContent = reminderService.generateReminderContent.bind(reminderService);
const createScheduledReminders = reminderService.createScheduledReminders.bind(reminderService);
const cancelPendingReminders = reminderService.cancelPendingReminders.bind(reminderService);
const sendReminder = reminderService.sendReminder.bind(reminderService);

const getTodayStr = capacityService.getTodayStr.bind(capacityService);
const isValidDate = capacityService.isValidDate.bind(capacityService);
const isWorkday = capacityService.isWorkday.bind(capacityService);
const getAppointmentStartTime = capacityService.getAppointmentStartTime.bind(capacityService);
const getMaxAdvanceDate = capacityService.getMaxAdvanceDate.bind(capacityService);
const isDateWithinAdvanceWeeks = capacityService.isDateWithinAdvanceWeeks.bind(capacityService);
const isSameDayBookingAllowed = capacityService.isSameDayBookingAllowed.bind(capacityService);
const isSameDayReschedulingAllowed = capacityService.isSameDayReschedulingAllowed.bind(capacityService);
const getAppointmentDateTime = capacityService.getAppointmentDateTime.bind(capacityService);
const isCancellationAllowed = capacityService.isCancellationAllowed.bind(capacityService);
const isReschedulingAllowed = capacityService.isReschedulingAllowed.bind(capacityService);
const getMaxActiveAppointments = capacityService.getMaxActiveAppointments.bind(capacityService);
const countActiveAppointments = capacityService.countActiveAppointments.bind(capacityService);

const sseClients = new Map();
let sseClientIdCounter = 0;
const SSE_HEARTBEAT_INTERVAL = 15000;

function broadcastBoardEvent(eventType, eventData) {
  const payload = {
    type: eventType,
    timestamp: Date.now(),
    data: eventData || {}
  };
  const sseMessage = `event: board_update\ndata: ${JSON.stringify(payload)}\n\n`;

  for (const client of sseClients.values()) {
    try {
      client.res.write(sseMessage);
    } catch (e) {
    }
  }
}

app.get('/api/events/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const clientId = ++sseClientIdCounter;
  const client = {
    id: clientId,
    res: res,
    connectedAt: Date.now()
  };
  sseClients.set(clientId, client);

  const heartbeat = setInterval(() => {
    if (sseClients.has(clientId)) {
      try {
        res.write(`event: heartbeat\ndata: ${JSON.stringify({ timestamp: Date.now(), client_count: sseClients.size })}\n\n`);
      } catch (e) {
        clearInterval(heartbeat);
        sseClients.delete(clientId);
      }
    } else {
      clearInterval(heartbeat);
    }
  }, SSE_HEARTBEAT_INTERVAL);

  client.heartbeat = heartbeat;

  res.write(`event: connected\ndata: ${JSON.stringify({ client_id: clientId, timestamp: Date.now() })}\n\n`);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(clientId);
  });
});

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

const parseNullableInt = capacityService.parseNullableInt.bind(capacityService);
const parseNullableBool = capacityService.parseNullableBool.bind(capacityService);

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
  const { name, description, sort_order, is_required, require_confirmation } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: '材料名称不能为空' });
  }

  const item = db.prepare('SELECT id FROM items WHERE id = ?').get(id);
  if (!item) {
    return res.status(404).json({ error: '事项不存在' });
  }

  const order = sort_order !== undefined ? parseInt(sort_order) || 0 : 0;
  const isRequired = is_required ? 1 : 0;
  const requireConfirmation = require_confirmation ? 1 : 0;

  const result = db.prepare(
    'INSERT INTO item_materials (item_id, name, description, sort_order, is_required, require_confirmation) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, name.trim(), description || '', order, isRequired, requireConfirmation);

  res.json({
    id: result.lastInsertRowid,
    item_id: parseInt(id),
    name: name.trim(),
    description: description || '',
    sort_order: order,
    is_required: isRequired,
    require_confirmation: requireConfirmation
  });
});

app.put('/api/materials/:id', (req, res) => {
  const { id } = req.params;
  const { name, description, sort_order, is_required, require_confirmation } = req.body;

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
  const newIsRequired = is_required !== undefined ? (is_required ? 1 : 0) : material.is_required;
  const newRequireConfirmation = require_confirmation !== undefined ? (require_confirmation ? 1 : 0) : material.require_confirmation;

  db.prepare(
    'UPDATE item_materials SET name = ?, description = ?, sort_order = ?, is_required = ?, require_confirmation = ? WHERE id = ?'
  ).run(newName, newDesc, newOrder, newIsRequired, newRequireConfirmation, id);

  res.json({
    id: parseInt(id),
    item_id: material.item_id,
    name: newName,
    description: newDesc,
    sort_order: newOrder,
    is_required: newIsRequired,
    require_confirmation: newRequireConfirmation
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
    'INSERT INTO item_materials (item_id, name, description, sort_order, is_required, require_confirmation) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const updateStmt = db.prepare(
    'UPDATE item_materials SET name = ?, description = ?, sort_order = ?, is_required = ?, require_confirmation = ? WHERE id = ?'
  );
  const deleteStmt = db.prepare('DELETE FROM item_materials WHERE id = ?');

  const existingIds = new Set(
    db.prepare('SELECT id FROM item_materials WHERE item_id = ?').all(id).map(m => m.id)
  );

  const tx = db.transaction(() => {
    materials.forEach((mat, index) => {
      const isRequired = mat.is_required ? 1 : 0;
      const requireConfirmation = mat.require_confirmation ? 1 : 0;
      if (mat.id && existingIds.has(mat.id)) {
        updateStmt.run(
          mat.name?.trim() || '',
          mat.description || '',
          index,
          isRequired,
          requireConfirmation,
          mat.id
        );
        existingIds.delete(mat.id);
      } else {
        insertStmt.run(
          id,
          mat.name?.trim() || '',
          mat.description || '',
          index,
          isRequired,
          requireConfirmation
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

  const weekday = getWeekdayFromDate(date);

  let manualTimeSlots = db.prepare(`
    SELECT * FROM time_slot_capacities 
    WHERE item_id = ? AND date = ? AND source_type = 'manual'
    ORDER BY sort_order ASC, start_time ASC
  `).all(itemId, date);

  let timeSlotCaps = manualTimeSlots;
  let timeSlotSource = manualTimeSlots.length > 0 ? 'manual' : 'none';

  if (timeSlotCaps.length === 0) {
    const templateSlots = getWeeklyTimeSlotTemplates(itemId, weekday);
    if (templateSlots.length > 0) {
      let templateRecords = db.prepare(`
        SELECT * FROM time_slot_capacities 
        WHERE item_id = ? AND date = ? AND source_type = 'template'
        ORDER BY sort_order ASC, start_time ASC
      `).all(itemId, date);

      if (templateRecords.length > 0) {
        timeSlotCaps = templateRecords;
        timeSlotSource = 'template';
      } else {
        const insertStmt = db.prepare(`
          INSERT INTO time_slot_capacities 
          (item_id, date, start_time, end_time, max_count, current_count, sort_order, source_type)
          VALUES (?, ?, ?, ?, ?, 0, ?, 'template')
        `);

        const tx = db.transaction(() => {
          templateSlots.forEach((ts, index) => {
            insertStmt.run(itemId, date, ts.start_time, ts.end_time, ts.max_count, ts.sort_order !== undefined ? ts.sort_order : index);
          });
        });
        tx();

        timeSlotCaps = db.prepare(`
          SELECT * FROM time_slot_capacities 
          WHERE item_id = ? AND date = ? AND source_type = 'template'
          ORDER BY sort_order ASC, start_time ASC
        `).all(itemId, date);
        timeSlotSource = 'template';
      }
    }
  }

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
    let windowSource = 'manual';

    if (allItemWindows > 0) {
      useWindows = true;
      let hasAnyManual = false;
      let hasAnyTemplate = false;

      itemWindows.forEach(iw => {
        const effective = getEffectiveWindowSlot(itemId, iw.window_id, date, iw.default_capacity || 10);
        const ws = effective.slot;
        if (effective.source === 'manual') hasAnyManual = true;
        if (effective.source === 'template') hasAnyTemplate = true;

        const windowApts = db.prepare(
          `SELECT COUNT(*) as cnt FROM appointments 
           WHERE window_id = ? AND item_id = ? AND appointment_date = ? AND status NOT IN ('cancelled', 'no_show')`
        ).get(iw.window_id, itemId, date);

        const windowUsedCount = windowApts.cnt;
        const windowAvailable = Math.max(0, ws.max_count - windowUsedCount);

        windowTotalAvailable += windowAvailable;

        windowSlots.push({
          window_id: iw.window_id,
          window_name: iw.window_name,
          max_count: ws.max_count,
          current_count: windowUsedCount,
          available_count: windowAvailable,
          source_type: effective.source
        });
      });

      if (hasAnyManual) {
        windowSource = 'manual';
      } else if (hasAnyTemplate) {
        windowSource = 'template';
      } else {
        windowSource = 'template';
      }
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
      windows: windowSlots,
      slot_source: timeSlotSource,
      window_source: windowSource
    });
    return;
  }

  if (itemWindows.length === 0) {
    let slot = db.prepare(
      "SELECT * FROM daily_slots WHERE item_id = ? AND date = ? AND source_type = 'manual'"
    ).get(itemId, date);

    let dailySource = 'manual';

    if (!slot) {
      const weekday = getWeekdayFromDate(date);
      const dailyTemplate = getWeeklyDailyTemplate(itemId, weekday);

      if (dailyTemplate) {
        let templateSlot = db.prepare(
          "SELECT * FROM daily_slots WHERE item_id = ? AND date = ? AND source_type = 'template'"
        ).get(itemId, date);

        if (templateSlot) {
          slot = templateSlot;
          dailySource = 'template';
        } else {
          db.prepare(
            "INSERT INTO daily_slots (item_id, date, max_count, current_count, source_type) VALUES (?, ?, ?, 0, 'template')"
          ).run(itemId, date, dailyTemplate.max_count);
          slot = db.prepare(
            "SELECT * FROM daily_slots WHERE item_id = ? AND date = ? AND source_type = 'template'"
          ).get(itemId, date);
          dailySource = 'template';
        }
      }
    }

    if (!slot) {
      slot = db.prepare('SELECT * FROM daily_slots WHERE item_id = ? AND date = ?').get(itemId, date);
      if (slot) {
        dailySource = slot.source_type || 'template';
      }
    }

    if (!slot) {
      const defaultMax = item.default_max_count || 20;
      db.prepare(
        "INSERT INTO daily_slots (item_id, date, max_count, current_count, source_type) VALUES (?, ?, ?, 0, 'template')"
      ).run(itemId, date, defaultMax);
      slot = db.prepare('SELECT * FROM daily_slots WHERE item_id = ? AND date = ?').get(itemId, date);
      dailySource = 'template';
    }

    const timeSlots = generateTimeSlots(slot.max_count);
    const appointments = db.prepare(
      "SELECT time_slot FROM appointments WHERE item_id = ? AND appointment_date = ? AND status NOT IN ('cancelled', 'no_show')"
    ).all(itemId, date);

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
      windows: [],
      slot_source: dailySource
    });
    return;
  }

  let totalMax = 0;
  let totalCurrent = 0;
  const windowSlots = [];
  let windowSource = 'manual';
  let hasAnyManual = false;
  let hasAnyTemplate = false;

  itemWindows.forEach(iw => {
    const effective = getEffectiveWindowSlot(itemId, iw.window_id, date, iw.default_capacity || 10);
    const ws = effective.slot;
    if (effective.source === 'manual') hasAnyManual = true;
    if (effective.source === 'template') hasAnyTemplate = true;

    const windowApts = db.prepare(
      `SELECT time_slot FROM appointments 
       WHERE window_id = ? AND item_id = ? AND appointment_date = ? AND status NOT IN ('cancelled', 'no_show')`
    ).all(iw.window_id, itemId, date);

    const windowUsedCount = windowApts.length;
    const windowAvailable = Math.max(0, ws.max_count - windowUsedCount);

    totalMax += ws.max_count;
    totalCurrent += windowUsedCount;

    windowSlots.push({
      window_id: iw.window_id,
      window_name: iw.window_name,
      max_count: ws.max_count,
      current_count: windowUsedCount,
      available_count: windowAvailable,
      source_type: effective.source
    });
  });

  if (hasAnyManual) {
    windowSource = 'manual';
  } else if (hasAnyTemplate) {
    windowSource = 'template';
  } else {
    windowSource = 'template';
  }

  const totalAvailable = Math.max(0, totalMax - totalCurrent);
  const timeSlots = generateTimeSlots(totalMax);
  const allAppointments = db.prepare(
    "SELECT time_slot FROM appointments WHERE item_id = ? AND appointment_date = ? AND status NOT IN ('cancelled', 'no_show')"
  ).all(itemId, date);

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
    windows: windowSlots,
    window_source: windowSource,
    slot_source: windowSource
  });
});

const generateTimeSlots = capacityService.generateTimeSlots.bind(capacityService);

function validateAndCreateAppointment({
  item_id,
  user_name,
  phone,
  appointment_date,
  time_slot,
  source = 'user',
  operator_name = null,
  window_id = null,
  material_confirmations = null
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

  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(item_id);
  if (!item) {
    throw new Error('事项不存在');
  }

  capacityService.validateBookingPreconditions({ item, phone, dateStr: appointment_date });

  const materials = db.prepare(
    'SELECT * FROM item_materials WHERE item_id = ? ORDER BY sort_order ASC, id ASC'
  ).all(item_id);

  let confirmedMaterialMap = {};
  if (material_confirmations && Array.isArray(material_confirmations)) {
    material_confirmations.forEach(mc => {
      confirmedMaterialMap[mc.material_id] = mc.is_confirmed ? 1 : 0;
    });
  }

  if (source === 'user') {
    for (const mat of materials) {
      if (mat.is_required && mat.require_confirmation) {
        if (!confirmedMaterialMap[mat.id]) {
          throw new Error(`请确认必备材料：${mat.name}`);
        }
      }
    }
  }

  const { useTimeSlots, matchedSlot: matchedTimeSlot } = capacityService.validateTimeSlotAvailability(
    item_id,
    appointment_date,
    time_slot
  );

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
         WHERE window_id = ? AND item_id = ? AND appointment_date = ? AND status NOT IN ('cancelled', 'no_show')`
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
           WHERE window_id = ? AND item_id = ? AND appointment_date = ? AND status NOT IN ('cancelled', 'no_show')`
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

    reminderService.createAppointmentReminders(appointmentId, {
      item_name: itemName,
      window_name: windowName,
      appointment_date,
      time_slot,
      phone
    });

    const snapshotStmt = db.prepare(
      'INSERT INTO appointment_material_snapshots (appointment_id, material_id, material_name, material_description, is_required, require_confirmation, is_confirmed, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    materials.forEach((mat, index) => {
      const isConfirmed = confirmedMaterialMap[mat.id] ? 1 : 0;
      snapshotStmt.run(
        appointmentId,
        mat.id,
        mat.name,
        mat.description || '',
        mat.is_required,
        mat.require_confirmation,
        isConfirmed,
        index
      );
    });

    return { id: appointmentId, window_id: assignedWindowId, window_name: windowName, queue_number: queueNumber };
  });

  return tx();
}

app.post('/api/appointments', (req, res) => {
  const { item_id, user_name, phone, appointment_date, time_slot, material_confirmations } = req.body;

  try {
    const result = validateAndCreateAppointment({
      item_id,
      user_name,
      phone,
      appointment_date,
      time_slot,
      source: 'user',
      material_confirmations
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
  const { item_id, user_name, phone, appointment_date, time_slot, window_id, operator_name, material_confirmations } = req.body;

  try {
    const result = validateAndCreateAppointment({
      item_id,
      user_name,
      phone,
      appointment_date,
      time_slot,
      source: 'admin',
      operator_name: operator_name || '管理员',
      window_id: window_id ? Number(window_id) : null,
      material_confirmations
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

function validateBatchAppointmentItem(item, index, counters) {
  const result = {
    index: index + 1,
    item_name: item.item_name || '',
    user_name: item.user_name || '',
    phone: item.phone || '',
    appointment_date: item.appointment_date || '',
    time_slot: item.time_slot || '',
    window_name: item.window_name || '',
    status: 'ok',
    message: '',
    item_id: null,
    window_id: null
  };

  if (!item.item_name || !item.item_name.trim()) {
    result.status = 'error';
    result.message = '事项名称不能为空';
    return result;
  }

  const dbItem = db.prepare('SELECT * FROM items WHERE name = ?').get(item.item_name.trim());
  if (!dbItem) {
    result.status = 'error';
    result.message = '事项不存在';
    return result;
  }
  result.item_id = dbItem.id;

  if (!item.user_name || !item.user_name.trim()) {
    result.status = 'error';
    result.message = '姓名不能为空';
    return result;
  }

  if (!item.phone || !item.phone.trim()) {
    result.status = 'error';
    result.message = '手机号不能为空';
    return result;
  }

  const phoneRegex = /^1[3-9]\d{9}$/;
  if (!phoneRegex.test(item.phone.trim())) {
    result.status = 'error';
    result.message = '手机号格式错误';
    return result;
  }

  if (!item.appointment_date || !item.appointment_date.trim()) {
    result.status = 'error';
    result.message = '日期不能为空';
    return result;
  }

  if (!isValidDate(item.appointment_date.trim())) {
    result.status = 'error';
    result.message = '日期格式不正确，应为 YYYY-MM-DD';
    return result;
  }

  const dateStr = item.appointment_date.trim();
  const dateObj = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (dateObj < today) {
    result.status = 'error';
    result.message = '不能预约过去的日期';
    return result;
  }

  if (!isWorkday(dateStr)) {
    result.status = 'error';
    result.message = '节假日或周末不可预约';
    return result;
  }

  if (!item.time_slot || !item.time_slot.trim()) {
    result.status = 'error';
    result.message = '时段不能为空';
    return result;
  }

  const timeSlotStr = item.time_slot.trim();
  const timeSlotCaps = db.prepare(`
    SELECT * FROM time_slot_capacities 
    WHERE item_id = ? AND date = ? 
    ORDER BY sort_order ASC, start_time ASC
  `).all(dbItem.id, dateStr);

  const useTimeSlots = timeSlotCaps.length > 0;
  let matchedTimeSlot = null;

  const tsKey = `${dbItem.id}_${dateStr}_${timeSlotStr}`;
  const batchTsCount = counters ? (counters.timeSlots[tsKey] || 0) : 0;

  if (useTimeSlots) {
    for (const tsc of timeSlotCaps) {
      if (timeSlotStr === `${tsc.start_time}-${tsc.end_time}`) {
        matchedTimeSlot = tsc;
        break;
      }
    }
    if (!matchedTimeSlot) {
      result.status = 'error';
      result.message = '时段无效，请检查时段格式';
      return result;
    }
    const totalUsed = matchedTimeSlot.current_count + batchTsCount;
    if (totalUsed >= matchedTimeSlot.max_count) {
      result.status = 'error';
      result.message = '时段号源已满';
      return result;
    }
  } else {
    const slotCheck = db.prepare(
      `SELECT COUNT(*) as cnt FROM appointments 
       WHERE item_id = ? AND appointment_date = ? AND time_slot = ? AND status NOT IN ('cancelled', 'no_show')`
    ).get(dbItem.id, dateStr, timeSlotStr);

    const totalUsed = slotCheck.cnt + batchTsCount;
    if (totalUsed > 0) {
      result.status = 'error';
      result.message = '该时段已被预约';
      return result;
    }
  }

  let targetWindowId = null;
  const allItemWindows = db.prepare(`
    SELECT COUNT(*) as cnt
    FROM item_windows iw
    WHERE iw.item_id = ?
  `).get(dbItem.id).cnt;

  const dailyKey = `${dbItem.id}_${dateStr}`;
  const batchDailyCount = counters ? (counters.dailySlots[dailyKey] || 0) : 0;
  const activeKey = `${item.phone.trim()}_${dbItem.id}`;
  const batchActiveCount = counters ? (counters.activeAppointments[activeKey] || 0) : 0;

  if (item.window_name && item.window_name.trim() && item.window_name.trim() !== '自动分配') {
    const winName = item.window_name.trim();
    const window = db.prepare('SELECT * FROM windows WHERE name = ? AND status = ?').get(winName, 'active');
    if (!window) {
      result.status = 'error';
      result.message = '窗口不存在或不可用';
      return result;
    }

    if (allItemWindows > 0) {
      const itemWindow = db.prepare(`
        SELECT iw.*
        FROM item_windows iw
        WHERE iw.item_id = ? AND iw.window_id = ?
      `).get(dbItem.id, window.id);
      if (!itemWindow) {
        result.status = 'error';
        result.message = '该窗口不支持此事项';
        return result;
      }
    }

    if (allItemWindows > 0) {
      let ws = db.prepare(
        'SELECT * FROM window_slots WHERE window_id = ? AND item_id = ? AND date = ?'
      ).get(window.id, dbItem.id, dateStr);
      if (!ws) {
        const defaultCapacity = 10;
        ws = { max_count: defaultCapacity, current_count: 0 };
      }
      const windowUsed = db.prepare(
        `SELECT COUNT(*) as cnt FROM appointments 
         WHERE window_id = ? AND item_id = ? AND appointment_date = ? AND status NOT IN ('cancelled', 'no_show')`
      ).get(window.id, dbItem.id, dateStr).cnt;
      
      const wsKey = `${dbItem.id}_${dateStr}_${window.id}`;
      const batchWsCount = counters ? (counters.windowSlots[wsKey] || 0) : 0;
      const totalWindowUsed = windowUsed + batchWsCount;
      
      if (totalWindowUsed >= ws.max_count) {
        result.status = 'error';
        result.message = '窗口容量不足';
        return result;
      }
    }
    targetWindowId = window.id;
    result.window_id = window.id;
  } else if (allItemWindows > 0) {
    const itemWindows = db.prepare(`
      SELECT iw.*, w.name as window_name, w.status as window_status
      FROM item_windows iw
      LEFT JOIN windows w ON iw.window_id = w.id
      WHERE iw.item_id = ? AND w.status = 'active'
      ORDER BY w.sort_order ASC, w.id ASC
    `).all(dbItem.id);

    if (itemWindows.length === 0) {
      result.status = 'error';
      result.message = '该事项暂无可用办理窗口';
      return result;
    }

    let hasAvailable = false;
    let bestWindowId = null;
    let bestAvailable = -1;

    for (const iw of itemWindows) {
      let ws = db.prepare(
        'SELECT * FROM window_slots WHERE window_id = ? AND item_id = ? AND date = ?'
      ).get(iw.window_id, dbItem.id, dateStr);
      if (!ws) {
        const defaultCapacity = iw.default_capacity || 10;
        ws = { max_count: defaultCapacity, current_count: 0 };
      }
      const windowUsed = db.prepare(
        `SELECT COUNT(*) as cnt FROM appointments 
         WHERE window_id = ? AND item_id = ? AND appointment_date = ? AND status NOT IN ('cancelled', 'no_show')`
      ).get(iw.window_id, dbItem.id, dateStr).cnt;
      
      const wsKey = `${dbItem.id}_${dateStr}_${iw.window_id}`;
      const batchWsCount = counters ? (counters.windowSlots[wsKey] || 0) : 0;
      const totalWindowUsed = windowUsed + batchWsCount;
      const available = ws.max_count - totalWindowUsed;
      
      if (available > 0 && available > bestAvailable) {
        bestAvailable = available;
        bestWindowId = iw.window_id;
        hasAvailable = true;
      }
    }
    if (!hasAvailable) {
      result.status = 'error';
      result.message = '所有窗口的号源均已满';
      return result;
    }
    result.window_id = bestWindowId;
  } else if (!useTimeSlots) {
    let dailySlot = db.prepare('SELECT * FROM daily_slots WHERE item_id = ? AND date = ?').get(dbItem.id, dateStr);
    if (!dailySlot) {
      const defaultMax = dbItem.default_max_count || 20;
      dailySlot = { max_count: defaultMax, current_count: 0 };
    }
    const totalDailyUsed = dailySlot.current_count + batchDailyCount;
    if (totalDailyUsed >= dailySlot.max_count) {
      result.status = 'error';
      result.message = '该日期号源已满';
      return result;
    }
  }

  const maxActive = getMaxActiveAppointments(dbItem);
  const activeCount = countActiveAppointments(item.phone.trim(), dbItem.id);
  const totalActive = activeCount + batchActiveCount;
  if (totalActive >= maxActive) {
    result.status = 'error';
    result.message = `该手机号已有 ${totalActive} 个未完成的${dbItem.name}预约`;
    return result;
  }

  return result;
}

function createBatchCounters() {
  return {
    timeSlots: {},
    windowSlots: {},
    dailySlots: {},
    activeAppointments: {}
  };
}

function updateBatchCounters(counters, validatedItem, originalItem) {
  if (!counters || !validatedItem || validatedItem.status === 'error') return;

  const itemId = validatedItem.item_id;
  const dateStr = originalItem.appointment_date.trim();
  const timeSlotStr = originalItem.time_slot.trim();
  const phone = originalItem.phone.trim();

  const tsKey = `${itemId}_${dateStr}_${timeSlotStr}`;
  counters.timeSlots[tsKey] = (counters.timeSlots[tsKey] || 0) + 1;

  if (validatedItem.window_id) {
    const wsKey = `${itemId}_${dateStr}_${validatedItem.window_id}`;
    counters.windowSlots[wsKey] = (counters.windowSlots[wsKey] || 0) + 1;
  }

  const dailyKey = `${itemId}_${dateStr}`;
  counters.dailySlots[dailyKey] = (counters.dailySlots[dailyKey] || 0) + 1;

  const activeKey = `${phone}_${itemId}`;
  counters.activeAppointments[activeKey] = (counters.activeAppointments[activeKey] || 0) + 1;
}

app.post('/api/admin/appointments/batch/preview', (req, res) => {
  const { appointments } = req.body;
  if (!Array.isArray(appointments) || appointments.length === 0) {
    return res.status(400).json({ error: '预约数据不能为空' });
  }

  try {
    const results = [];
    const counters = createBatchCounters();

    appointments.forEach((apt, index) => {
      const validated = validateBatchAppointmentItem(apt, index, counters);
      results.push(validated);
      if (validated.status !== 'error') {
        updateBatchCounters(counters, validated, apt);
      }
    });

    const successCount = results.filter(r => r.status === 'ok').length;
    const warnCount = results.filter(r => r.status === 'warn').length;
    const errorCount = results.filter(r => r.status === 'error').length;

    res.json({
      success: true,
      total: results.length,
      valid_count: successCount + warnCount,
      success_count: successCount,
      warn_count: warnCount,
      error_count: errorCount,
      items: results
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '预览校验失败' });
  }
});

app.post('/api/admin/appointments/batch', (req, res) => {
  const { appointments } = req.body;
  if (!Array.isArray(appointments) || appointments.length === 0) {
    return res.status(400).json({ error: '预约数据不能为空' });
  }

  try {
    const results = [];
    const counters = createBatchCounters();

    appointments.forEach((apt, index) => {
      const validated = validateBatchAppointmentItem(apt, index, counters);
      results.push(validated);
      if (validated.status !== 'error') {
        updateBatchCounters(counters, validated, apt);
      }
    });

    const validItems = results.filter(r => r.status === 'ok' || r.status === 'warn');
    
    if (validItems.length === 0) {
      return res.status(400).json({ 
        error: '没有可导入的有效预约', 
        items: results 
      });
    }

    const importTx = db.transaction(() => {
      let imported = 0;
      const importResults = [];

      for (const validated of validItems) {
        const originalItem = appointments[validated.index - 1];
        try {
          const createResult = validateAndCreateAppointment({
            item_id: validated.item_id,
            user_name: originalItem.user_name.trim(),
            phone: originalItem.phone.trim(),
            appointment_date: originalItem.appointment_date.trim(),
            time_slot: originalItem.time_slot.trim(),
            source: 'admin_batch',
            operator_name: '管理员(批量导入)',
            window_id: validated.window_id
          });
          imported++;
          importResults.push({
            index: validated.index,
            success: true,
            id: createResult.id,
            queue_number: createResult.queue_number,
            window_name: createResult.window_name
          });
        } catch (e) {
          importResults.push({
            index: validated.index,
            success: false,
            error: e.message
          });
        }
      }

      return { imported, importResults };
    });

    const txResult = importTx();

    const finalItems = results.map(r => {
      const importResult = txResult.importResults.find(ir => ir.index === r.index);
      if (importResult) {
        if (importResult.success) {
          return { ...r, import_status: 'success', queue_number: importResult.queue_number, window_name: importResult.window_name };
        } else {
          return { ...r, status: 'error', message: importResult.error, import_status: 'failed' };
        }
      }
      return { ...r, import_status: r.status === 'error' ? 'skipped' : 'pending' };
    });

    res.json({
      success: true,
      imported: txResult.imported,
      total: appointments.length,
      items: finalItems
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '批量导入失败' });
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

  const materialSnapshots = db.prepare(
    'SELECT * FROM appointment_material_snapshots WHERE appointment_id = ? ORDER BY sort_order ASC, id ASC'
  ).all(id);

  appointment.material_snapshots = materialSnapshots;

  res.json(appointment);
});

app.get('/api/appointments/:id/material-snapshots', (req, res) => {
  const { id } = req.params;
  const { phone } = req.query;

  if (!phone) {
    return res.status(400).json({ error: '请提供手机号' });
  }

  const appointment = db.prepare('SELECT id, phone FROM appointments WHERE id = ?').get(id);
  if (!appointment) {
    return res.status(404).json({ error: '预约不存在' });
  }

  if (appointment.phone !== phone) {
    return res.status(403).json({ error: '手机号不匹配，无权查看该预约的材料' });
  }

  const snapshots = db.prepare(
    'SELECT * FROM appointment_material_snapshots WHERE appointment_id = ? ORDER BY sort_order ASC, id ASC'
  ).all(id);

  res.json(snapshots);
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

  cancelPendingReminders(id);

  res.json({ success: true, message: '预约已取消，号源已释放' });

  broadcastBoardEvent('cancelled', {
    appointment_id: id,
    item_id: appointment.item_id,
    appointment_date: appointment.appointment_date
  });
});

app.put('/api/appointments/:id/status', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const validStatuses = ['pending', 'arrived', 'calling', 'completed', 'cancelled', 'no_show'];
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
  } else if (status === 'no_show') {
    if (oldStatus !== 'pending' && oldStatus !== 'arrived') {
      return res.status(400).json({ error: '只有待办理或已到场状态的预约才能标记为爽约' });
    }
    db.prepare("UPDATE appointments SET status = 'no_show', no_show_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
  } else {
    db.prepare('UPDATE appointments SET status = ? WHERE id = ?').run(status, id);
  }

  const releaseStatuses = ['cancelled', 'no_show'];
  if (releaseStatuses.includes(status) && !releaseStatuses.includes(oldStatus)) {
    capacityService.adjustSlotCountsOnRelease(appointment);
  }

  const restoreStatuses = ['cancelled', 'no_show'];
  if (restoreStatuses.includes(oldStatus) && !restoreStatuses.includes(status)) {
    const restoreResult = capacityService.adjustSlotCountsOnRestore(appointment);
    if (!restoreResult.canRestore) {
      db.prepare('UPDATE appointments SET status = ? WHERE id = ?').run(oldStatus, id);
      return res.status(400).json({ error: '号源已满，无法恢复预约' });
    }
  }

  if (oldStatus !== status) {
    const item = db.prepare('SELECT name FROM items WHERE id = ?').get(appointment.item_id);
    const window = appointment.window_id ?
      db.prepare('SELECT name FROM windows WHERE id = ?').get(appointment.window_id) : null;
    reminderService.handleStatusChangeReminders(
      appointment.id,
      appointment.phone,
      oldStatus,
      status,
      {
        item_name: item ? item.name : '',
        window_name: window ? window.name : '',
        appointment_date: appointment.appointment_date,
        time_slot: appointment.time_slot,
        user_name: appointment.user_name,
        queue_number: appointment.queue_number
      }
    );
  }

  let noShowCount = null;
  let autoRestriction = null;
  let restrictionRemoved = false;
  if (status === 'no_show' && oldStatus !== 'no_show') {
    noShowCount = getNoShowCount(appointment.phone);
    autoRestriction = checkAndAddAutoRestriction(appointment.phone, noShowCount);
  } else if (oldStatus === 'no_show' && status !== 'no_show') {
    noShowCount = getNoShowCount(appointment.phone);
    const threshold = parseInt(getSystemSetting('no_show_threshold', '3'), 10) || 3;
    if (noShowCount < threshold) {
      const result = db.prepare(
        "DELETE FROM phone_restrictions WHERE phone = ? AND is_auto = 1 AND restriction_type = 'no_show'"
      ).run(appointment.phone);
      restrictionRemoved = result.changes > 0;
    }
  }

  res.json({ 
    success: true, 
    status,
    no_show_count: noShowCount,
    auto_restriction: autoRestriction,
    restriction_removed: restrictionRemoved
  });

  if (oldStatus !== status) {
    broadcastBoardEvent('status_change', {
      appointment_id: id,
      old_status: oldStatus,
      new_status: status,
      item_id: appointment.item_id,
      appointment_date: appointment.appointment_date
    });
  }
});

function getNoShowCount(phone) {
  const windowDays = parseInt(getSystemSetting('no_show_window_days', '30'), 10) || 30;
  
  const date = new Date();
  date.setDate(date.getDate() - windowDays);
  const startDate = date.toISOString().split('T')[0];

  const row = db.prepare(`
    SELECT COUNT(*) as count 
    FROM appointments 
    WHERE phone = ? AND status = 'no_show' AND no_show_at >= ?
  `).get(phone, startDate + ' 00:00:00');

  return row ? row.count : 0;
}

function checkAndAddAutoRestriction(phone, noShowCount) {
  const threshold = parseInt(getSystemSetting('no_show_threshold', '3'), 10) || 3;
  const restrictionDays = parseInt(getSystemSetting('no_show_restriction_days', '30'), 10) || 30;

  if (noShowCount < threshold) {
    return { added: false, reason: '未达到阈值' };
  }

  const existing = db.prepare('SELECT * FROM phone_restrictions WHERE phone = ?').get(phone);
  if (existing) {
    return { added: false, reason: '已在限制名单中', existing: true };
  }

  const endDate = new Date();
  endDate.setDate(endDate.getDate() + restrictionDays);
  const endDateStr = endDate.toISOString().split('T')[0];

  const reason = `近30天内爽约${noShowCount}次，自动限制预约${restrictionDays}天`;

  const result = db.prepare(`
    INSERT INTO phone_restrictions (phone, reason, end_date, is_auto, no_show_count, restriction_type)
    VALUES (?, ?, ?, 1, ?, 'no_show')
  `).run(phone, reason, endDateStr, noShowCount);

  return {
    added: true,
    id: result.lastInsertRowid,
    phone,
    reason,
    end_date: endDateStr,
    no_show_count: noShowCount
  };
}

app.post('/api/appointments/:id/no-show', (req, res) => {
  const { id } = req.params;

  const appointment = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  if (!appointment) {
    return res.status(404).json({ error: '预约不存在' });
  }

  const oldStatus = appointment.status;

  if (oldStatus === 'no_show') {
    return res.status(400).json({ error: '该预约已标记为爽约' });
  }

  if (oldStatus !== 'pending' && oldStatus !== 'arrived') {
    return res.status(400).json({ error: '只有待办理或已到场状态的预约才能标记为爽约' });
  }

  db.prepare("UPDATE appointments SET status = 'no_show', no_show_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);

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

  const item = db.prepare('SELECT name FROM items WHERE id = ?').get(appointment.item_id);
  const window = appointment.window_id ?
    db.prepare('SELECT name FROM windows WHERE id = ?').get(appointment.window_id) : null;
  const reminderContent = generateReminderContent('no_show', {
    item_name: item ? item.name : '',
    window_name: window ? window.name : '',
    appointment_date: appointment.appointment_date,
    time_slot: appointment.time_slot
  });
  createReminder(appointment.id, appointment.phone, 'no_show', reminderContent);

  cancelPendingReminders(appointment.id);

  const noShowCount = getNoShowCount(appointment.phone);
  const autoRestriction = checkAndAddAutoRestriction(appointment.phone, noShowCount);

  res.json({
    success: true,
    status: 'no_show',
    no_show_count: noShowCount,
    auto_restriction: autoRestriction
  });
});

app.put('/api/appointments/:id/no-show/revert', (req, res) => {
  const { id } = req.params;

  const appointment = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  if (!appointment) {
    return res.status(404).json({ error: '预约不存在' });
  }

  if (appointment.status !== 'no_show') {
    return res.status(400).json({ error: '该预约不是爽约状态' });
  }

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
    return res.status(400).json({ error: '号源已满，无法恢复预约' });
  }

  db.prepare("UPDATE appointments SET status = 'pending', no_show_at = NULL WHERE id = ?").run(id);

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

  const noShowCount = getNoShowCount(appointment.phone);

  const threshold = parseInt(getSystemSetting('no_show_threshold', '3'), 10) || 3;
  let restrictionRemoved = false;
  if (noShowCount < threshold) {
    const result = db.prepare(
      "DELETE FROM phone_restrictions WHERE phone = ? AND is_auto = 1 AND restriction_type = 'no_show'"
    ).run(appointment.phone);
    restrictionRemoved = result.changes > 0;
  }

  res.json({
    success: true,
    status: 'pending',
    no_show_count: noShowCount,
    restriction_removed: restrictionRemoved
  });
});

const parseSlotMaxCount = capacityService.parseSlotMaxCount.bind(capacityService);

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
       WHERE window_id = ? AND item_id = ? AND appointment_date = ? AND status NOT IN ('cancelled', 'no_show')`
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
          'UPDATE window_slots SET max_count = ?, source_type = ? WHERE window_id = ? AND item_id = ? AND date = ?'
        ).run(maxCount, 'manual', windowId, itemId, date);
      } else {
        db.prepare(
          'INSERT INTO window_slots (window_id, item_id, date, max_count, current_count, source_type) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(windowId, itemId, date, maxCount, usedCount, 'manual');
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
     WHERE window_id = ? AND item_id = ? AND appointment_date = ? AND status NOT IN ('cancelled', 'no_show')`
  ).get(windowId, itemId, date).cnt;

  if (existing) {
    if (maxCount < usedCount) {
      return res.status(400).json({ error: '号源数量不能小于已预约数量' });
    }
    db.prepare(
      'UPDATE window_slots SET max_count = ?, source_type = ? WHERE window_id = ? AND item_id = ? AND date = ?'
    ).run(maxCount, 'manual', windowId, itemId, date);
  } else {
    db.prepare(
      'INSERT INTO window_slots (window_id, item_id, date, max_count, current_count, source_type) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(windowId, itemId, date, maxCount, usedCount, 'manual');
  }

  res.json({ success: true, max_count: maxCount, source_type: 'manual' });
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
    db.prepare('UPDATE daily_slots SET max_count = ?, source_type = ? WHERE item_id = ? AND date = ?').run(max_count, 'manual', itemId, date);
  } else {
    db.prepare('INSERT INTO daily_slots (item_id, date, max_count, current_count, source_type) VALUES (?, ?, ?, 0, ?)').run(itemId, date, max_count, 'manual');
  }

  res.json({ success: true, max_count: parseInt(max_count), source_type: 'manual' });
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
      AND time_slot = ? AND status NOT IN ('cancelled', 'no_show')
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
      AND a.status NOT IN ('cancelled', 'no_show')
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
          SET max_count = ?, current_count = ?, sort_order = ?, source_type = ?
          WHERE id = ?
        `).run(maxCount, usedCount, index, 'manual', existing.id);
      } else {
        db.prepare(`
          INSERT INTO time_slot_capacities (item_id, date, start_time, end_time, max_count, current_count, sort_order, source_type)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(itemId, date, ts.start_time, ts.end_time, maxCount, usedCount, index, 'manual');
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

const getWeekdayFromDate = capacityService.getWeekdayFromDate.bind(capacityService);
const hasManualDailySlot = capacityService.hasManualDailySlot.bind(capacityService);
const hasManualTimeSlots = capacityService.hasManualTimeSlots.bind(capacityService);
const hasManualWindowSlots = capacityService.hasManualWindowSlots.bind(capacityService);
const getWeeklyDailyTemplate = capacityService.getWeeklyDailyTemplate.bind(capacityService);
const getWeeklyTimeSlotTemplates = capacityService.getWeeklyTimeSlotTemplates.bind(capacityService);
const getWeeklyWindowTemplates = capacityService.getWeeklyWindowTemplates.bind(capacityService);
const getActiveTimeSlotAppointmentCount = capacityService.getActiveTimeSlotAppointmentCount.bind(capacityService);
const getActiveWindowAppointmentCount = capacityService.getActiveWindowAppointmentCount.bind(capacityService);
const syncGeneratedDailySlots = capacityService.syncGeneratedDailySlots.bind(capacityService);
const clearGeneratedDailySlotsForWeekday = capacityService.clearGeneratedDailySlotsForWeekday.bind(capacityService);
const syncGeneratedTimeSlotTemplates = capacityService.syncGeneratedTimeSlotTemplates.bind(capacityService);
const syncGeneratedWindowTemplates = capacityService.syncGeneratedWindowTemplates.bind(capacityService);
const getEffectiveWindowSlot = capacityService.getEffectiveWindowSlot.bind(capacityService);

app.get('/api/items/:itemId/weekly-templates', (req, res) => {
  const { itemId } = req.params;

  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId);
  if (!item) {
    return res.status(404).json({ error: '事项不存在' });
  }

  const dailyTemplates = db.prepare(`
    SELECT * FROM weekly_daily_templates 
    WHERE item_id = ? 
    ORDER BY weekday ASC
  `).all(itemId);

  const timeSlotTemplates = db.prepare(`
    SELECT * FROM weekly_time_slot_templates 
    WHERE item_id = ? 
    ORDER BY weekday ASC, sort_order ASC, start_time ASC
  `).all(itemId);

  const windowTemplates = db.prepare(`
    SELECT wwt.*, w.name as window_name, w.status as window_status, w.sort_order
    FROM weekly_window_templates wwt
    LEFT JOIN windows w ON wwt.window_id = w.id
    WHERE wwt.item_id = ?
    ORDER BY wwt.weekday ASC, w.sort_order ASC, w.id ASC
  `).all(itemId);

  const timeSlotsByWeekday = {};
  timeSlotTemplates.forEach(ts => {
    if (!timeSlotsByWeekday[ts.weekday]) {
      timeSlotsByWeekday[ts.weekday] = [];
    }
    timeSlotsByWeekday[ts.weekday].push(ts);
  });

  const windowsByWeekday = {};
  windowTemplates.forEach(wt => {
    if (!windowsByWeekday[wt.weekday]) {
      windowsByWeekday[wt.weekday] = [];
    }
    windowsByWeekday[wt.weekday].push(wt);
  });

  const weekdayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const result = [];
  for (let i = 0; i < 7; i++) {
    const daily = dailyTemplates.find(d => d.weekday === i);
    result.push({
      weekday: i,
      weekday_name: weekdayNames[i],
      has_daily_template: !!daily,
      max_count: daily ? daily.max_count : null,
      has_time_slot_template: !!timeSlotsByWeekday[i] && timeSlotsByWeekday[i].length > 0,
      time_slots: timeSlotsByWeekday[i] || [],
      has_window_template: !!windowsByWeekday[i] && windowsByWeekday[i].length > 0,
      windows: windowsByWeekday[i] || []
    });
  }

  const allItemWindows = db.prepare(`
    SELECT iw.*, w.name as window_name, w.status as window_status, w.sort_order
    FROM item_windows iw
    LEFT JOIN windows w ON iw.window_id = w.id
    WHERE iw.item_id = ?
    ORDER BY w.sort_order ASC, w.id ASC
  `).all(itemId);

  res.json({
    item_id: parseInt(itemId),
    weekdays: result,
    item_windows: allItemWindows
  });
});

app.put('/api/items/:itemId/weekly-templates/daily', (req, res) => {
  const { itemId } = req.params;
  const { templates } = req.body;

  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId);
  if (!item) {
    return res.status(404).json({ error: '事项不存在' });
  }

  if (!Array.isArray(templates)) {
    return res.status(400).json({ error: '模板数据格式错误' });
  }

  for (const t of templates) {
    const weekday = parseInt(t.weekday);
    if (isNaN(weekday) || weekday < 0 || weekday > 6) {
      return res.status(400).json({ error: '星期值无效，应为0-6' });
    }
    const maxCount = parseInt(t.max_count);
    if (isNaN(maxCount) || maxCount < 0) {
      return res.status(400).json({ error: `周${weekday}的号源数量无效` });
    }
  }

  const tx = db.transaction(() => {
    for (const t of templates) {
      const weekday = parseInt(t.weekday);
      db.prepare('DELETE FROM weekly_daily_templates WHERE item_id = ? AND weekday = ?').run(itemId, weekday);
    }

    const insertStmt = db.prepare(`
      INSERT INTO weekly_daily_templates (item_id, weekday, max_count)
      VALUES (?, ?, ?)
    `);

    for (const t of templates) {
      insertStmt.run(itemId, parseInt(t.weekday), parseInt(t.max_count));
    }

    syncGeneratedDailySlots(itemId, templates);
  });

  try {
    tx();
  } catch (e) {
    return res.status(500).json({ error: '保存失败' });
  }

  const updated = db.prepare(`
    SELECT * FROM weekly_daily_templates 
    WHERE item_id = ? 
    ORDER BY weekday ASC
  `).all(itemId);

  res.json({ success: true, daily_templates: updated });
});

app.put('/api/items/:itemId/weekly-templates/time-slots/:weekday', (req, res) => {
  const { itemId, weekday } = req.params;
  const { time_slots } = req.body;

  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId);
  if (!item) {
    return res.status(404).json({ error: '事项不存在' });
  }

  const weekdayNum = parseInt(weekday);
  if (isNaN(weekdayNum) || weekdayNum < 0 || weekdayNum > 6) {
    return res.status(400).json({ error: '星期值无效' });
  }

  if (!Array.isArray(time_slots)) {
    return res.status(400).json({ error: '时段数据格式错误' });
  }

  if (time_slots.length === 0) {
    const tx = db.transaction(() => {
      db.prepare(
        'DELETE FROM weekly_time_slot_templates WHERE item_id = ? AND weekday = ?'
      ).run(itemId, weekdayNum);
      syncGeneratedTimeSlotTemplates(itemId, weekdayNum, []);
    });

    try {
      tx();
    } catch (e) {
      return res.status(500).json({ error: '保存失败' });
    }

    return res.json({ success: true, time_slots: [] });
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
    if (sortedSlots[i + 1].start_time < sortedSlots[i].end_time) {
      return res.status(400).json({
        error: `时段 ${sortedSlots[i].start_time}-${sortedSlots[i].end_time} 与 ${sortedSlots[i + 1].start_time}-${sortedSlots[i + 1].end_time} 存在重叠`
      });
    }
  }

  const tx = db.transaction(() => {
    db.prepare(
      'DELETE FROM weekly_time_slot_templates WHERE item_id = ? AND weekday = ?'
    ).run(itemId, weekdayNum);

    const insertStmt = db.prepare(`
      INSERT INTO weekly_time_slot_templates
      (item_id, weekday, start_time, end_time, max_count, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    sortedSlots.forEach((ts, index) => {
      insertStmt.run(itemId, weekdayNum, ts.start_time, ts.end_time, parseInt(ts.max_count), index);
    });

    syncGeneratedTimeSlotTemplates(itemId, weekdayNum, sortedSlots);
  });

  try {
    tx();
  } catch (e) {
    return res.status(500).json({ error: '保存失败' });
  }

  const updated = db.prepare(`
    SELECT * FROM weekly_time_slot_templates 
    WHERE item_id = ? AND weekday = ?
    ORDER BY sort_order ASC, start_time ASC
  `).all(itemId, weekdayNum);

  res.json({ success: true, time_slots: updated });
});

app.put('/api/items/:itemId/weekly-templates/windows', (req, res) => {
  const { itemId } = req.params;
  const { templates } = req.body;

  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId);
  if (!item) {
    return res.status(404).json({ error: '事项不存在' });
  }

  if (!Array.isArray(templates)) {
    return res.status(400).json({ error: '模板数据格式错误' });
  }

  for (const t of templates) {
    const weekday = parseInt(t.weekday);
    const windowId = parseInt(t.window_id);
    const maxCount = parseInt(t.max_count);

    if (isNaN(weekday) || weekday < 0 || weekday > 6) {
      return res.status(400).json({ error: '星期值无效' });
    }
    if (!windowId) {
      return res.status(400).json({ error: '窗口ID无效' });
    }
    if (isNaN(maxCount) || maxCount < 0) {
      return res.status(400).json({ error: '号源数量无效' });
    }

    const itemWindow = db.prepare(
      'SELECT * FROM item_windows WHERE item_id = ? AND window_id = ?'
    ).get(itemId, windowId);
    if (!itemWindow) {
      return res.status(400).json({ error: `窗口 ${windowId} 未配置此事项` });
    }
  }

  const weekdays = [...new Set(templates.map(t => parseInt(t.weekday)))];

  const tx = db.transaction(() => {
    for (const wd of weekdays) {
      db.prepare(
        'DELETE FROM weekly_window_templates WHERE item_id = ? AND weekday = ?'
      ).run(itemId, wd);
    }

    const insertStmt = db.prepare(`
      INSERT OR REPLACE INTO weekly_window_templates
      (item_id, window_id, weekday, max_count)
      VALUES (?, ?, ?, ?)
    `);

    for (const t of templates) {
      insertStmt.run(itemId, parseInt(t.window_id), parseInt(t.weekday), parseInt(t.max_count));
    }

    syncGeneratedWindowTemplates(itemId, weekdays);
  });

  try {
    tx();
  } catch (e) {
    return res.status(500).json({ error: '保存失败' });
  }

  const updated = db.prepare(`
    SELECT wwt.*, w.name as window_name, w.status as window_status, w.sort_order
    FROM weekly_window_templates wwt
    LEFT JOIN windows w ON wwt.window_id = w.id
    WHERE wwt.item_id = ?
    ORDER BY wwt.weekday ASC, w.sort_order ASC, w.id ASC
  `).all(itemId);

  res.json({ success: true, window_templates: updated });
});

app.delete('/api/items/:itemId/weekly-templates/daily/:weekday', (req, res) => {
  const { itemId, weekday } = req.params;

  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId);
  if (!item) {
    return res.status(404).json({ error: '事项不存在' });
  }

  const weekdayNum = parseInt(weekday);
  if (isNaN(weekdayNum) || weekdayNum < 0 || weekdayNum > 6) {
    return res.status(400).json({ error: '星期值无效' });
  }

  db.prepare(
    'DELETE FROM weekly_daily_templates WHERE item_id = ? AND weekday = ?'
  ).run(itemId, weekdayNum);

  clearGeneratedDailySlotsForWeekday(itemId, weekdayNum);

  res.json({ success: true });
});

app.delete('/api/items/:itemId/weekly-templates/time-slots/:weekday', (req, res) => {
  const { itemId, weekday } = req.params;

  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId);
  if (!item) {
    return res.status(404).json({ error: '事项不存在' });
  }

  const weekdayNum = parseInt(weekday);
  if (isNaN(weekdayNum) || weekdayNum < 0 || weekdayNum > 6) {
    return res.status(400).json({ error: '星期值无效' });
  }

  db.prepare(
    'DELETE FROM weekly_time_slot_templates WHERE item_id = ? AND weekday = ?'
  ).run(itemId, weekdayNum);

  syncGeneratedTimeSlotTemplates(itemId, weekdayNum, []);

  res.json({ success: true });
});

app.delete('/api/items/:itemId/weekly-templates/windows/:weekday', (req, res) => {
  const { itemId, weekday } = req.params;

  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId);
  if (!item) {
    return res.status(404).json({ error: '事项不存在' });
  }

  const weekdayNum = parseInt(weekday);
  if (isNaN(weekdayNum) || weekdayNum < 0 || weekdayNum > 6) {
    return res.status(400).json({ error: '星期值无效' });
  }

  db.prepare(
    'DELETE FROM weekly_window_templates WHERE item_id = ? AND weekday = ?'
  ).run(itemId, weekdayNum);

  syncGeneratedWindowTemplates(itemId, [weekdayNum]);

  res.json({ success: true });
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
    SELECT r.*, a.user_name, i.name as item_name, a.appointment_date, a.time_slot, a.status as appointment_status
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

  let reminder = db.prepare(sql).get(...params);

  if (appointment_id && reminder) {
    const appointment = db.prepare('SELECT status FROM appointments WHERE id = ?').get(appointment_id);
    if (appointment) {
      const priorityMap = {
        pending: ['on_day', 'before_day', 'rescheduled', 'created'],
        arrived: ['arrived', 'on_day', 'before_day', 'created'],
        calling: ['calling', 'arrived', 'on_day', 'before_day'],
        completed: ['completed', 'calling', 'arrived'],
        cancelled: ['cancelled'],
        no_show: ['no_show']
      };

      const priorities = priorityMap[appointment.status] || [];
      const sentStatuses = ['simulated', 'sent'];

      for (const type of priorities) {
        const prioritySql = `
          SELECT r.*, a.user_name, i.name as item_name, a.appointment_date, a.time_slot, a.status as appointment_status
          FROM appointment_reminders r
          LEFT JOIN appointments a ON r.appointment_id = a.id
          LEFT JOIN items i ON a.item_id = i.id
          WHERE r.appointment_id = ? AND r.type = ? AND r.send_status IN (?, ?)
          ORDER BY r.created_at DESC, r.id DESC LIMIT 1
        `;
        const priorityReminder = db.prepare(prioritySql).get(appointment_id, type, sentStatuses[0], sentStatuses[1]);
        if (priorityReminder) {
          reminder = priorityReminder;
          break;
        }
      }
    }
  }

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

app.post('/api/reminders/:id/send', (req, res) => {
  const { id } = req.params;

  try {
    sendReminder(id);
    const reminder = db.prepare(`
      SELECT r.*, a.user_name, i.name as item_name, a.appointment_date, a.time_slot
      FROM appointment_reminders r
      LEFT JOIN appointments a ON r.appointment_id = a.id
      LEFT JOIN items i ON a.item_id = i.id
      WHERE r.id = ?
    `).get(id);
    res.json({ success: true, message: '提醒发送成功', reminder });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
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

    broadcastBoardEvent('calling', {
      appointment_id: appointment.id,
      item_id: appointment.item_id,
      appointment_date: appointment.appointment_date
    });
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
      cancelPendingReminders(currentApt.id);
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

    broadcastBoardEvent('next', {
      item_id: currentApt.item_id,
      appointment_date: currentApt.appointment_date,
      has_next: result.has_next
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

    broadcastBoardEvent('calling', {
      appointment_id: nextApt.id,
      item_id: itemId,
      appointment_date: today
    });
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

function getDefaultDateRange() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 6);
  const fmt = (d) => {
    const y = d.getFullYear();
    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  return { start_date: fmt(start), end_date: fmt(end) };
}

app.get('/api/analytics/overview', (req, res) => {
  let { start_date, end_date, item_id } = req.query;

  if (!start_date || !end_date) {
    const defaultRange = getDefaultDateRange();
    start_date = start_date || defaultRange.start_date;
    end_date = end_date || defaultRange.end_date;
  }

  const aptWhere = ['appointment_date >= ?', 'appointment_date <= ?'];
  const aptParams = [start_date, end_date];
  if (item_id) {
    aptWhere.push('item_id = ?');
    aptParams.push(item_id);
  }
  const aptWhereSql = aptWhere.join(' AND ');

  const totalRow = db.prepare(`SELECT COUNT(*) as count FROM appointments WHERE ${aptWhereSql}`).get(...aptParams);
  const totalCount = totalRow.count;

  const statusCounts = db.prepare(`
    SELECT status, COUNT(*) as count
    FROM appointments
    WHERE ${aptWhereSql}
    GROUP BY status
  `).all(...aptParams);

  const statusMap = {};
  statusCounts.forEach(s => { statusMap[s.status] = s.count; });

  const completedCount = statusMap.completed || 0;
  const cancelledCount = statusMap.cancelled || 0;
  const noShowCount = statusMap.no_show || 0;
  const pendingCount = statusMap.pending || 0;
  const arrivedCount = statusMap.arrived || 0;
  const callingCount = statusMap.calling || 0;

  const completionRate = totalCount > 0 ? parseFloat(((completedCount / totalCount) * 100).toFixed(1)) : 0;
  const cancellationRate = totalCount > 0 ? parseFloat(((cancelledCount / totalCount) * 100).toFixed(1)) : 0;
  const noShowRate = totalCount > 0 ? parseFloat(((noShowCount / totalCount) * 100).toFixed(1)) : 0;

  const reviewWhere = ['DATE(created_at) >= ?', 'DATE(created_at) <= ?'];
  const reviewParams = [start_date, end_date];
  if (item_id) {
    reviewWhere.push('item_id = ?');
    reviewParams.push(item_id);
  }
  const reviewWhereSql = reviewWhere.join(' AND ');

  const reviewRow = db.prepare(`SELECT COUNT(*) as count FROM appointment_reviews WHERE ${reviewWhereSql}`).get(...reviewParams);
  const reviewCount = reviewRow.count;

  const avgRatingRow = db.prepare(`SELECT AVG(rating) as avg_rating FROM appointment_reviews WHERE ${reviewWhereSql}`).get(...reviewParams);
  const avgRating = avgRatingRow.avg_rating ? parseFloat(avgRatingRow.avg_rating.toFixed(1)) : 0;

  const rescheduleWhere = ['DATE(created_at) >= ?', 'DATE(created_at) <= ?'];
  const rescheduleParams = [start_date, end_date];
  if (item_id) {
    rescheduleWhere.push('item_id = ?');
    rescheduleParams.push(item_id);
  }
  const rescheduleWhereSql = rescheduleWhere.join(' AND ');
  const rescheduleRow = db.prepare(`SELECT COUNT(*) as count FROM appointment_reschedules WHERE ${rescheduleWhereSql}`).get(...rescheduleParams);
  const rescheduleCount = rescheduleRow.count;

  res.json({
    start_date,
    end_date,
    total_count: totalCount,
    completed_count: completedCount,
    cancelled_count: cancelledCount,
    no_show_count: noShowCount,
    pending_count: pendingCount,
    arrived_count: arrivedCount,
    calling_count: callingCount,
    completion_rate: completionRate,
    cancellation_rate: cancellationRate,
    no_show_rate: noShowRate,
    review_count: reviewCount,
    avg_rating: avgRating,
    reschedule_count: rescheduleCount
  });
});

app.get('/api/analytics/items', (req, res) => {
  let { start_date, end_date } = req.query;

  if (!start_date || !end_date) {
    const defaultRange = getDefaultDateRange();
    start_date = start_date || defaultRange.start_date;
    end_date = end_date || defaultRange.end_date;
  }

  const items = db.prepare(`
    SELECT
      i.id,
      i.name,
      COUNT(a.id) as total_count,
      SUM(CASE WHEN a.status = 'completed' THEN 1 ELSE 0 END) as completed_count,
      SUM(CASE WHEN a.status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_count,
      SUM(CASE WHEN a.status = 'no_show' THEN 1 ELSE 0 END) as no_show_count
    FROM items i
    LEFT JOIN appointments a ON i.id = a.item_id
      AND a.appointment_date >= ?
      AND a.appointment_date <= ?
    GROUP BY i.id, i.name
    ORDER BY total_count DESC, i.id ASC
  `).all(start_date, end_date);

  const result = items.map(item => {
    const total = item.total_count || 0;
    const completed = item.completed_count || 0;
    const cancelled = item.cancelled_count || 0;
    const noShow = item.no_show_count || 0;

    const reviewStats = db.prepare(`
      SELECT COUNT(*) as review_count, AVG(rating) as avg_rating
      FROM appointment_reviews
      WHERE item_id = ? AND DATE(created_at) >= ? AND DATE(created_at) <= ?
    `).get(item.id, start_date, end_date);

    const rescheduleCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM appointment_reschedules
      WHERE item_id = ? AND DATE(created_at) >= ? AND DATE(created_at) <= ?
    `).get(item.id, start_date, end_date).count;

    return {
      id: item.id,
      name: item.name,
      total_count: total,
      completed_count: completed,
      cancelled_count: cancelled,
      no_show_count: noShow,
      completion_rate: total > 0 ? parseFloat(((completed / total) * 100).toFixed(1)) : 0,
      cancellation_rate: total > 0 ? parseFloat(((cancelled / total) * 100).toFixed(1)) : 0,
      no_show_rate: total > 0 ? parseFloat(((noShow / total) * 100).toFixed(1)) : 0,
      review_count: reviewStats.review_count || 0,
      avg_rating: reviewStats.avg_rating ? parseFloat(reviewStats.avg_rating.toFixed(1)) : 0,
      reschedule_count: rescheduleCount || 0
    };
  });

  res.json({
    start_date,
    end_date,
    items: result
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
      'INSERT INTO phone_restrictions (phone, reason, end_date, is_auto, restriction_type) VALUES (?, ?, ?, 0, \'manual\')'
    ).run(phone, reason || '', end_date);

    res.json({
      id: result.lastInsertRowid,
      phone,
      reason: reason || '',
      end_date,
      is_auto: 0,
      restriction_type: 'manual',
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
    const updated = db.prepare('SELECT * FROM phone_restrictions WHERE id = ?').get(id);
    res.json({
      id: parseInt(id),
      phone: newPhone,
      reason: newReason,
      end_date: newEndDate,
      is_auto: updated.is_auto || 0,
      restriction_type: updated.restriction_type || 'manual',
      no_show_count: updated.no_show_count,
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

app.get('/api/system-settings', (req, res) => {
  const settings = db.prepare('SELECT * FROM system_settings').all();
  const result = {};
  for (const s of settings) {
    result[s.setting_key] = s.setting_value;
  }
  res.json(result);
});

app.put('/api/system-settings', (req, res) => {
  const settings = req.body;

  if (!settings || typeof settings !== 'object') {
    return res.status(400).json({ error: '设置数据无效' });
  }

  const validKeys = ['no_show_threshold', 'no_show_restriction_days', 'no_show_window_days'];

  for (const key of validKeys) {
    if (settings[key] !== undefined && settings[key] !== null) {
      const value = String(settings[key]);
      if (key.endsWith('_days') || key.endsWith('_threshold')) {
        const num = parseInt(value, 10);
        if (isNaN(num) || num <= 0) {
          return res.status(400).json({ error: `${key} 必须是正整数` });
        }
      }
      setSystemSetting(key, value);
    }
  }

  const updatedSettings = {};
  for (const key of validKeys) {
    updatedSettings[key] = getSystemSetting(key);
  }

  res.json(updatedSettings);
});

app.get('/api/appointments/no-show-stats', (req, res) => {
  const { phone } = req.query;

  if (!phone) {
    return res.status(400).json({ error: '请提供手机号' });
  }

  const count = getNoShowCount(phone);
  const threshold = parseInt(getSystemSetting('no_show_threshold', '3'), 10) || 3;
  const windowDays = parseInt(getSystemSetting('no_show_window_days', '30'), 10) || 30;

  const restriction = db.prepare(
    'SELECT * FROM phone_restrictions WHERE phone = ? ORDER BY created_at DESC LIMIT 1'
  ).get(phone);

  const todayStr = getTodayStr();

  res.json({
    phone,
    no_show_count: count,
    threshold,
    window_days: windowDays,
    is_restricted: restriction && restriction.end_date >= todayStr,
    restriction: restriction ? {
      ...restriction,
      is_active: restriction.end_date >= todayStr
    } : null
  });
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
       WHERE item_id = ? AND appointment_date = ? AND time_slot = ? AND status NOT IN ('cancelled', 'no_show')`
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
         WHERE window_id = ? AND item_id = ? AND appointment_date = ? AND status NOT IN ('cancelled', 'no_show')`
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
    const rescheduleContent = generateReminderContent('rescheduled', {
      item_name: itemName,
      window_name: windowName,
      appointment_date: new_date,
      time_slot: new_time_slot
    });
    createReminder(id, phone, 'rescheduled', rescheduleContent);

    cancelPendingReminders(id);
    createScheduledReminders(id, {
      item_name: itemName,
      window_name: windowName,
      appointment_date: new_date,
      time_slot: new_time_slot,
      phone
    });

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

    broadcastBoardEvent('rescheduled', {
      appointment_id: id,
      item_id: appointment.item_id,
      old_date: appointment.appointment_date,
      new_date: new_date
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
    WHERE window_id = ? AND appointment_date = ? AND status NOT IN ('cancelled', 'no_show')
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

  const waitingApts = db.prepare(`
    SELECT a.*, i.name as item_name
    FROM appointments a
    LEFT JOIN items i ON a.item_id = i.id
    WHERE a.window_id = ? AND a.appointment_date = ? AND a.status = ?
    ORDER BY a.queue_number ASC
  `).all(windowId, today, 'arrived');

  if (waitingApts.length === 0) {
    return res.json({ success: true, has_next: false, message: '暂无等待叫号的预约' });
  }

  let nextApt = null;
  for (const apt of waitingApts) {
    const itemCalling = db.prepare(
      'SELECT id FROM appointments WHERE item_id = ? AND appointment_date = ? AND status = ?'
    ).get(apt.item_id, today, 'calling');
    if (!itemCalling) {
      nextApt = apt;
      break;
    }
  }

  if (!nextApt) {
    return res.json({ 
      success: true, 
      has_next: false, 
      message: '等待队列中的预约所属事项均正在叫号，请稍后再试' 
    });
  }

  const tx = db.transaction(() => {
    const recheckWindow = db.prepare(
      'SELECT id FROM appointments WHERE window_id = ? AND appointment_date = ? AND status = ?'
    ).get(windowId, today, 'calling');
    if (recheckWindow) {
      throw new Error('该窗口已有正在叫号的预约');
    }

    const recheckItem = db.prepare(
      'SELECT id FROM appointments WHERE item_id = ? AND appointment_date = ? AND status = ?'
    ).get(nextApt.item_id, today, 'calling');
    if (recheckItem) {
      throw new Error('该事项已有正在叫号的预约');
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

    broadcastBoardEvent('calling', {
      appointment_id: nextApt.id,
      item_id: nextApt.item_id,
      window_id: windowId,
      appointment_date: today
    });
  } catch (e) {
    if (e.message === '该窗口已有正在叫号的预约' || e.message === '该事项已有正在叫号的预约') {
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

  cancelPendingReminders(currentApt.id);

  res.json({ success: true, message: '办理完成', completed_appointment: currentApt });

  broadcastBoardEvent('completed', {
    appointment_id: currentApt.id,
    item_id: currentApt.item_id,
    window_id: windowId,
    appointment_date: today
  });
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

    const waitingApts = db.prepare(`
      SELECT a.*, i.name as item_name
      FROM appointments a
      LEFT JOIN items i ON a.item_id = i.id
      WHERE a.window_id = ? AND a.appointment_date = ? AND a.status = ? AND a.id != ?
      ORDER BY a.queue_number ASC
    `).all(windowId, today, 'arrived', currentApt.id);

    let nextApt = null;
    for (const apt of waitingApts) {
      const itemCalling = db.prepare(
        'SELECT id FROM appointments WHERE item_id = ? AND appointment_date = ? AND status = ?'
      ).get(apt.item_id, today, 'calling');
      if (!itemCalling) {
        nextApt = apt;
        break;
      }
    }

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

    return {
      has_next: false,
      next: null,
      skipped: currentApt,
      blocked_by_item_calling: waitingApts.length > 0
    };
  });

  try {
    const result = tx();
    res.json({
      success: true,
      has_next: result.has_next,
      next_appointment: result.next,
      skipped_appointment: result.skipped,
      message: result.has_next
        ? '已跳过，叫下一位'
        : (result.blocked_by_item_calling ? '已跳过，暂无可叫下一位（其他事项正在叫号中）' : '已跳过，暂无下一位')
    });

    broadcastBoardEvent('skip', {
      window_id: windowId,
      item_id: currentApt.item_id,
      appointment_date: today,
      has_next: result.has_next
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

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`预约系统已启动: http://localhost:${PORT}`);
    console.log(`后台管理: http://localhost:${PORT}/admin`);
  });
}

module.exports = { app, db };
