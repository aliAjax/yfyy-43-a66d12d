function getActiveWindowAppointmentCount(db, itemId, windowId, date) {
  return db.prepare(`
    SELECT COUNT(*) as cnt FROM appointments
    WHERE window_id = ? AND item_id = ? AND appointment_date = ?
      AND status NOT IN ('cancelled', 'no_show')
  `).get(windowId, itemId, date).cnt;
}

function getEffectiveWindowSlot(db, { itemId, windowId, date, defaultCapacity, weekday }) {
  let ws = db.prepare(
    "SELECT * FROM window_slots WHERE window_id = ? AND item_id = ? AND date = ? AND source_type = 'manual'"
  ).get(windowId, itemId, date);

  if (ws) {
    return { slot: ws, source: 'manual' };
  }

  const windowTemplate = db.prepare(
    'SELECT * FROM weekly_window_templates WHERE item_id = ? AND window_id = ? AND weekday = ?'
  ).get(itemId, windowId, weekday);

  if (windowTemplate) {
    let templateWs = db.prepare(
      "SELECT * FROM window_slots WHERE window_id = ? AND item_id = ? AND date = ? AND source_type = 'template'"
    ).get(windowId, itemId, date);

    if (templateWs) {
      return { slot: templateWs, source: 'template' };
    }

    db.prepare(
      "INSERT INTO window_slots (window_id, item_id, date, max_count, current_count, source_type) VALUES (?, ?, ?, ?, 0, 'template')"
    ).run(windowId, itemId, date, windowTemplate.max_count);

    templateWs = db.prepare(
      "SELECT * FROM window_slots WHERE window_id = ? AND item_id = ? AND date = ? AND source_type = 'template'"
    ).get(windowId, itemId, date);

    return { slot: templateWs, source: 'template' };
  }

  let defaultWs = db.prepare(
    'SELECT * FROM window_slots WHERE window_id = ? AND item_id = ? AND date = ?'
  ).get(windowId, itemId, date);

  if (!defaultWs) {
    db.prepare(
      "INSERT INTO window_slots (window_id, item_id, date, max_count, current_count, source_type) VALUES (?, ?, ?, ?, 0, 'template')"
    ).run(windowId, itemId, date, defaultCapacity);
    defaultWs = db.prepare(
      'SELECT * FROM window_slots WHERE window_id = ? AND item_id = ? AND date = ?'
    ).get(windowId, itemId, date);
  }

  return { slot: defaultWs, source: defaultWs.source_type || 'template' };
}

function getActiveItemWindows(db, itemId) {
  return db.prepare(`
    SELECT iw.*, w.name as window_name, w.status as window_status
    FROM item_windows iw
    LEFT JOIN windows w ON iw.window_id = w.id
    WHERE iw.item_id = ? AND w.status = 'active'
    ORDER BY w.sort_order ASC, w.id ASC
  `).all(itemId);
}

function ensureWindowSlot(db, { itemId, windowId, date, defaultCapacity }) {
  let slot = db.prepare(
    'SELECT * FROM window_slots WHERE window_id = ? AND item_id = ? AND date = ?'
  ).get(windowId, itemId, date);

  if (!slot) {
    db.prepare(
      'INSERT INTO window_slots (window_id, item_id, date, max_count, current_count) VALUES (?, ?, ?, ?, 0)'
    ).run(windowId, itemId, date, defaultCapacity);
    slot = db.prepare(
      'SELECT * FROM window_slots WHERE window_id = ? AND item_id = ? AND date = ?'
    ).get(windowId, itemId, date);
  }

  return slot;
}

function getWindowAvailability(db, { itemId, windowId, date, defaultCapacity }) {
  const slot = ensureWindowSlot(db, { itemId, windowId, date, defaultCapacity });
  const usedCount = getActiveWindowAppointmentCount(db, itemId, windowId, date);
  return {
    slot,
    used_count: usedCount,
    available_count: slot.max_count - usedCount
  };
}

function allocateWindow(db, { itemId, date, requestedWindowId = null }) {
  const totalWindows = db.prepare(`
    SELECT COUNT(*) as cnt
    FROM item_windows iw
    WHERE iw.item_id = ?
  `).get(itemId).cnt;

  if (totalWindows <= 0) {
    return { has_windows: false, window_id: null };
  }

  if (requestedWindowId) {
    const itemWindow = db.prepare(`
      SELECT iw.*, w.name as window_name, w.status as window_status
      FROM item_windows iw
      LEFT JOIN windows w ON iw.window_id = w.id
      WHERE iw.item_id = ? AND iw.window_id = ? AND w.status = 'active'
    `).get(itemId, requestedWindowId);

    if (!itemWindow) {
      throw new Error('所选窗口不支持该事项或窗口不可用');
    }

    const availability = getWindowAvailability(db, {
      itemId,
      windowId: requestedWindowId,
      date,
      defaultCapacity: itemWindow.default_capacity || 10
    });

    if (availability.used_count >= availability.slot.max_count) {
      throw new Error('该窗口号源已满，请选择其他窗口或日期');
    }

    return { has_windows: true, window_id: requestedWindowId };
  }

  const itemWindows = getActiveItemWindows(db, itemId);
  if (itemWindows.length === 0) {
    throw new Error('该事项暂无可用办理窗口');
  }

  let bestWindow = null;
  let bestAvailable = -1;

  for (const itemWindow of itemWindows) {
    const availability = getWindowAvailability(db, {
      itemId,
      windowId: itemWindow.window_id,
      date,
      defaultCapacity: itemWindow.default_capacity || 10
    });

    if (availability.available_count > 0 && availability.available_count > bestAvailable) {
      bestAvailable = availability.available_count;
      bestWindow = itemWindow;
    }
  }

  if (!bestWindow) {
    throw new Error('所有窗口的号源均已满，请选择其他日期');
  }

  return { has_windows: true, window_id: bestWindow.window_id };
}

module.exports = {
  allocateWindow,
  getActiveWindowAppointmentCount,
  getEffectiveWindowSlot,
  getWindowAvailability
};
