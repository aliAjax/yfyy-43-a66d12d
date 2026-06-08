function createWindowService(db, capacityService) {
  function getItemWindows(itemId, options = {}) {
    const { activeOnly = true } = options;
    const whereConditions = ['iw.item_id = ?'];
    const params = [itemId];

    if (activeOnly) {
      whereConditions.push("w.status = 'active'");
    }

    return db.prepare(`
      SELECT iw.*, w.name as window_name, w.description as window_description, w.status as window_status, w.sort_order
      FROM item_windows iw
      LEFT JOIN windows w ON iw.window_id = w.id
      WHERE ${whereConditions.join(' AND ')}
      ORDER BY w.sort_order ASC, w.id ASC
    `).all(...params);
  }

  function hasItemWindows(itemId) {
    const count = db.prepare(`
      SELECT COUNT(*) as cnt
      FROM item_windows iw
      WHERE iw.item_id = ?
    `).get(itemId).cnt;
    return count > 0;
  }

  function getWindowSlot(windowId, itemId, date) {
    return db.prepare(
      'SELECT * FROM window_slots WHERE window_id = ? AND item_id = ? AND date = ?'
    ).get(windowId, itemId, date);
  }

  function ensureWindowSlot(windowId, itemId, date, defaultCapacity) {
    let ws = getWindowSlot(windowId, itemId, date);
    if (!ws) {
      db.prepare(
        'INSERT INTO window_slots (window_id, item_id, date, max_count, current_count) VALUES (?, ?, ?, ?, 0)'
      ).run(windowId, itemId, date, defaultCapacity);
      ws = getWindowSlot(windowId, itemId, date);
    }
    return ws;
  }

  function getWindowUsedCount(windowId, itemId, date) {
    return db.prepare(
      `SELECT COUNT(*) as cnt FROM appointments 
       WHERE window_id = ? AND item_id = ? AND appointment_date = ? AND status NOT IN ('cancelled', 'no_show')`
    ).get(windowId, itemId, date).cnt;
  }

  function validateSpecificWindow(itemId, windowId, date, defaultCapacity) {
    const itemWindow = db.prepare(`
      SELECT iw.*, w.name as window_name, w.status as window_status
      FROM item_windows iw
      LEFT JOIN windows w ON iw.window_id = w.id
      WHERE iw.item_id = ? AND iw.window_id = ? AND w.status = 'active'
    `).get(itemId, windowId);

    if (!itemWindow) {
      throw new Error('所选窗口不支持该事项或窗口不可用');
    }

    const capacity = defaultCapacity !== undefined ? defaultCapacity : (itemWindow.default_capacity || 10);
    const ws = ensureWindowSlot(windowId, itemId, date, capacity);
    const usedCount = getWindowUsedCount(windowId, itemId, date);

    if (usedCount >= ws.max_count) {
      throw new Error('该窗口号源已满，请选择其他窗口或日期');
    }

    return {
      window_id: windowId,
      window_name: itemWindow.window_name,
      max_count: ws.max_count,
      current_count: usedCount,
      available_count: ws.max_count - usedCount
    };
  }

  function allocateBestWindow(itemId, date) {
    const itemWindows = getItemWindows(itemId, { activeOnly: true });

    if (itemWindows.length === 0) {
      throw new Error('该事项暂无可用办理窗口');
    }

    let bestWindow = null;
    let bestAvailable = -1;

    for (const iw of itemWindows) {
      const effective = capacityService.getEffectiveWindowSlot(
        itemId,
        iw.window_id,
        date,
        iw.default_capacity || 10
      );
      const ws = effective.slot;
      const usedCount = getWindowUsedCount(iw.window_id, itemId, date);
      const available = ws.max_count - usedCount;

      if (available > 0 && available > bestAvailable) {
        bestAvailable = available;
        bestWindow = iw;
      }
    }

    if (!bestWindow) {
      throw new Error('所有窗口的号源均已满，请选择其他日期');
    }

    return {
      window_id: bestWindow.window_id,
      window_name: bestWindow.window_name,
      available_count: bestAvailable
    };
  }

  function allocateWindow(itemId, date, options = {}) {
    const { window_id = null, default_capacity = null } = options;

    if (!hasItemWindows(itemId)) {
      return null;
    }

    if (window_id) {
      return validateSpecificWindow(itemId, window_id, date, default_capacity);
    }

    return allocateBestWindow(itemId, date);
  }

  function getWindowSlotsForDate(itemId, date) {
    const itemWindows = getItemWindows(itemId, { activeOnly: true });

    if (itemWindows.length === 0) {
      return [];
    }

    const windowSlots = [];
    let hasAnyManual = false;
    let hasAnyTemplate = false;

    for (const iw of itemWindows) {
      const effective = capacityService.getEffectiveWindowSlot(
        itemId,
        iw.window_id,
        date,
        iw.default_capacity || 10
      );
      const ws = effective.slot;
      if (effective.source === 'manual') hasAnyManual = true;
      if (effective.source === 'template') hasAnyTemplate = true;

      const usedCount = getWindowUsedCount(iw.window_id, itemId, date);
      const available = Math.max(0, ws.max_count - usedCount);

      windowSlots.push({
        window_id: iw.window_id,
        window_name: iw.window_name,
        max_count: ws.max_count,
        current_count: usedCount,
        available_count: available,
        source_type: effective.source
      });
    }

    let sourceType = 'template';
    if (hasAnyManual) {
      sourceType = 'manual';
    } else if (hasAnyTemplate) {
      sourceType = 'template';
    }

    return { slots: windowSlots, source_type: sourceType };
  }

  function getTotalWindowCapacity(itemId, date) {
    const result = getWindowSlotsForDate(itemId, date);
    if (!result.slots || result.slots.length === 0) {
      return { total_max: 0, total_used: 0, total_available: 0, source_type: 'none' };
    }

    let totalMax = 0;
    let totalUsed = 0;
    let totalAvailable = 0;

    for (const slot of result.slots) {
      totalMax += slot.max_count;
      totalUsed += slot.current_count;
      totalAvailable += slot.available_count;
    }

    return {
      total_max: totalMax,
      total_used: totalUsed,
      total_available: totalAvailable,
      source_type: result.source_type,
      slots: result.slots
    };
  }

  function setWindowSlotMaxCount(windowId, itemId, date, maxCount) {
    const existing = db.prepare(
      'SELECT * FROM window_slots WHERE window_id = ? AND item_id = ? AND date = ?'
    ).get(windowId, itemId, date);

    const usedCount = getWindowUsedCount(windowId, itemId, date);

    if (maxCount < usedCount) {
      throw new Error('号源数量不能小于已预约数量');
    }

    if (existing) {
      db.prepare(
        'UPDATE window_slots SET max_count = ?, source_type = ? WHERE window_id = ? AND item_id = ? AND date = ?'
      ).run(maxCount, 'manual', windowId, itemId, date);
    } else {
      db.prepare(
        'INSERT INTO window_slots (window_id, item_id, date, max_count, current_count, source_type) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(windowId, itemId, date, maxCount, usedCount, 'manual');
    }

    return { max_count: maxCount, source_type: 'manual', used_count: usedCount };
  }

  function batchSetWindowSlotMaxCounts(itemId, date, windows) {
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId);
    if (!item) {
      throw new Error('事项不存在');
    }

    const seenWindowIds = new Set();
    const updates = [];

    for (const entry of windows) {
      const windowId = parseInt(entry.window_id, 10);
      const maxCount = capacityService.parseSlotMaxCount(entry.max_count);

      if (!windowId || seenWindowIds.has(windowId)) {
        throw new Error('窗口号源数据无效');
      }
      seenWindowIds.add(windowId);

      if (isNaN(maxCount) || maxCount < 0) {
        throw new Error('号源数量不能小于0');
      }

      const window = db.prepare('SELECT * FROM windows WHERE id = ?').get(windowId);
      if (!window) {
        throw new Error(`窗口不存在：${windowId}`);
      }

      const itemWindow = db.prepare(
        'SELECT * FROM item_windows WHERE item_id = ? AND window_id = ?'
      ).get(itemId, windowId);
      if (!itemWindow) {
        throw new Error(`窗口"${window.name}"未配置此事项`);
      }

      const existing = db.prepare(
        'SELECT * FROM window_slots WHERE window_id = ? AND item_id = ? AND date = ?'
      ).get(windowId, itemId, date);

      const usedCount = getWindowUsedCount(windowId, itemId, date);

      if (maxCount < usedCount) {
        throw new Error(`窗口"${window.name}"号源数量不能小于已预约数量`);
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

    return updated;
  }

  return {
    getItemWindows,
    hasItemWindows,
    getWindowSlot,
    ensureWindowSlot,
    getWindowUsedCount,
    validateSpecificWindow,
    allocateBestWindow,
    allocateWindow,
    getWindowSlotsForDate,
    getTotalWindowCapacity,
    setWindowSlotMaxCount,
    batchSetWindowSlotMaxCounts
  };
}

module.exports = createWindowService;
