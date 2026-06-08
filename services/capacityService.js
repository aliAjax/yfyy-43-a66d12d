function createCapacityService(db) {
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

  function getWeekdayFromDate(dateStr) {
    const date = new Date(dateStr);
    return date.getDay();
  }

  function hasManualDailySlot(itemId, date) {
    const slot = db.prepare(
      "SELECT id FROM daily_slots WHERE item_id = ? AND date = ? AND source_type = 'manual'"
    ).get(itemId, date);
    return !!slot;
  }

  function hasManualTimeSlots(itemId, date) {
    const count = db.prepare(
      "SELECT COUNT(*) as cnt FROM time_slot_capacities WHERE item_id = ? AND date = ? AND source_type = 'manual'"
    ).get(itemId, date).cnt;
    return count > 0;
  }

  function hasManualWindowSlots(itemId, date) {
    const count = db.prepare(
      "SELECT COUNT(*) as cnt FROM window_slots WHERE item_id = ? AND date = ? AND source_type = 'manual'"
    ).get(itemId, date).cnt;
    return count > 0;
  }

  function getWeeklyDailyTemplate(itemId, weekday) {
    return db.prepare(
      'SELECT * FROM weekly_daily_templates WHERE item_id = ? AND weekday = ?'
    ).get(itemId, weekday);
  }

  function getWeeklyTimeSlotTemplates(itemId, weekday) {
    return db.prepare(`
      SELECT * FROM weekly_time_slot_templates 
      WHERE item_id = ? AND weekday = ? 
      ORDER BY sort_order ASC, start_time ASC
    `).all(itemId, weekday);
  }

  function getWeeklyWindowTemplates(itemId, weekday) {
    return db.prepare(`
      SELECT wwt.*, w.name as window_name, w.status as window_status, w.sort_order
      FROM weekly_window_templates wwt
      LEFT JOIN windows w ON wwt.window_id = w.id
      WHERE wwt.item_id = ? AND wwt.weekday = ?
      ORDER BY w.sort_order ASC, w.id ASC
    `).all(itemId, weekday);
  }

  function getActiveTimeSlotAppointmentCount(itemId, date, startTime, endTime) {
    return db.prepare(`
      SELECT COUNT(*) as cnt FROM appointments
      WHERE item_id = ? AND appointment_date = ?
        AND time_slot = ? AND status NOT IN ('cancelled', 'no_show')
    `).get(itemId, date, `${startTime}-${endTime}`).cnt;
  }

  function getActiveWindowAppointmentCount(itemId, windowId, date) {
    return db.prepare(`
      SELECT COUNT(*) as cnt FROM appointments
      WHERE window_id = ? AND item_id = ? AND appointment_date = ?
        AND status NOT IN ('cancelled', 'no_show')
    `).get(windowId, itemId, date).cnt;
  }

  function syncGeneratedDailySlots(itemId, templates) {
    const todayStr = getTodayStr();
    const templateList = Array.isArray(templates) ? templates : [];

    for (const t of templateList) {
      const weekday = parseInt(t.weekday);
      const maxCount = parseInt(t.max_count);
      db.prepare(`
        UPDATE daily_slots
        SET max_count = CASE WHEN current_count > ? THEN current_count ELSE ? END
        WHERE item_id = ? AND source_type = 'template' AND date >= ?
          AND cast(strftime('%w', date) as integer) = ?
      `).run(maxCount, maxCount, itemId, todayStr, weekday);
    }
  }

  function clearGeneratedDailySlotsForWeekday(itemId, weekday) {
    const todayStr = getTodayStr();
    db.prepare(`
      DELETE FROM daily_slots
      WHERE item_id = ? AND source_type = 'template' AND date >= ? AND current_count = 0
        AND cast(strftime('%w', date) as integer) = ?
    `).run(itemId, todayStr, weekday);
    db.prepare(`
      UPDATE daily_slots
      SET max_count = current_count
      WHERE item_id = ? AND source_type = 'template' AND date >= ? AND current_count > 0
        AND cast(strftime('%w', date) as integer) = ?
    `).run(itemId, todayStr, weekday);
  }

  function syncGeneratedTimeSlotTemplates(itemId, weekday, templateSlots) {
    const todayStr = getTodayStr();
    const templateList = Array.isArray(templateSlots) ? templateSlots : [];
    const templateMap = new Map(templateList.map((ts, index) => [
      `${ts.start_time}-${ts.end_time}`,
      {
        start_time: ts.start_time,
        end_time: ts.end_time,
        max_count: parseInt(ts.max_count),
        sort_order: ts.sort_order !== undefined ? parseInt(ts.sort_order) : index
      }
    ]));

    const existingSlots = db.prepare(`
      SELECT * FROM time_slot_capacities
      WHERE item_id = ? AND source_type = 'template' AND date >= ?
        AND cast(strftime('%w', date) as integer) = ?
      ORDER BY date ASC, sort_order ASC, start_time ASC
    `).all(itemId, todayStr, weekday);

    const existingByDate = new Map();
    for (const slot of existingSlots) {
      if (!existingByDate.has(slot.date)) {
        existingByDate.set(slot.date, []);
      }
      existingByDate.get(slot.date).push(slot);
    }

    for (const [date, slots] of existingByDate.entries()) {
      const seenKeys = new Set();

      for (const existing of slots) {
        const key = `${existing.start_time}-${existing.end_time}`;
        const activeCount = getActiveTimeSlotAppointmentCount(itemId, date, existing.start_time, existing.end_time);
        const template = templateMap.get(key);

        if (template) {
          seenKeys.add(key);
          const maxCount = Math.max(template.max_count, activeCount);
          db.prepare(`
            UPDATE time_slot_capacities
            SET max_count = ?, current_count = ?, sort_order = ?, source_type = 'template'
            WHERE id = ?
          `).run(maxCount, activeCount, template.sort_order, existing.id);
        } else if (activeCount > 0) {
          db.prepare(`
            UPDATE time_slot_capacities
            SET max_count = ?, current_count = ?, source_type = 'template'
            WHERE id = ?
          `).run(activeCount, activeCount, existing.id);
        } else {
          db.prepare('DELETE FROM time_slot_capacities WHERE id = ?').run(existing.id);
        }
      }

      for (const [key, template] of templateMap.entries()) {
        if (seenKeys.has(key)) continue;
        db.prepare(`
          INSERT INTO time_slot_capacities
          (item_id, date, start_time, end_time, max_count, current_count, sort_order, source_type)
          VALUES (?, ?, ?, ?, ?, 0, ?, 'template')
        `).run(itemId, date, template.start_time, template.end_time, template.max_count, template.sort_order);
      }
    }
  }

  function syncGeneratedWindowTemplates(itemId, weekdays) {
    const todayStr = getTodayStr();
    const weekdayList = [...new Set((weekdays || []).map(w => parseInt(w)).filter(w => !isNaN(w) && w >= 0 && w <= 6))];
    if (weekdayList.length === 0) return;

    const templateRows = db.prepare(`
      SELECT * FROM weekly_window_templates
      WHERE item_id = ? AND weekday IN (${weekdayList.map(() => '?').join(',')})
    `).all(itemId, ...weekdayList);
    const templateMap = new Map(templateRows.map(t => [`${t.weekday}:${t.window_id}`, t]));

    const existingSlots = db.prepare(`
      SELECT * FROM window_slots
      WHERE item_id = ? AND source_type = 'template' AND date >= ?
        AND cast(strftime('%w', date) as integer) IN (${weekdayList.map(() => '?').join(',')})
      ORDER BY date ASC, window_id ASC
    `).all(itemId, todayStr, ...weekdayList);

    const existingByDate = new Map();
    for (const slot of existingSlots) {
      if (!existingByDate.has(slot.date)) {
        existingByDate.set(slot.date, []);
      }
      existingByDate.get(slot.date).push(slot);
    }

    for (const [date, slots] of existingByDate.entries()) {
      const weekday = getWeekdayFromDate(date);
      const seenWindowIds = new Set();

      for (const existing of slots) {
        seenWindowIds.add(existing.window_id);
        const template = templateMap.get(`${weekday}:${existing.window_id}`);
        const activeCount = getActiveWindowAppointmentCount(itemId, existing.window_id, date);

        if (template) {
          const maxCount = Math.max(template.max_count, activeCount);
          db.prepare(`
            UPDATE window_slots
            SET max_count = ?, current_count = ?, source_type = 'template'
            WHERE id = ?
          `).run(maxCount, activeCount, existing.id);
        } else if (activeCount > 0) {
          db.prepare(`
            UPDATE window_slots
            SET max_count = ?, current_count = ?, source_type = 'template'
            WHERE id = ?
          `).run(activeCount, activeCount, existing.id);
        } else {
          db.prepare('DELETE FROM window_slots WHERE id = ?').run(existing.id);
        }
      }

      for (const template of templateRows.filter(t => t.weekday === weekday)) {
        if (seenWindowIds.has(template.window_id)) continue;
        const activeCount = getActiveWindowAppointmentCount(itemId, template.window_id, date);
        db.prepare(`
          INSERT INTO window_slots (window_id, item_id, date, max_count, current_count, source_type)
          VALUES (?, ?, ?, ?, ?, 'template')
        `).run(template.window_id, itemId, date, Math.max(template.max_count, activeCount), activeCount);
      }
    }
  }

  function getEffectiveWindowSlot(itemId, windowId, date, defaultCapacity) {
    const weekday = getWeekdayFromDate(date);

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

  function parseSlotMaxCount(value) {
    const parsed = parseInt(value, 10);
    return Number.isInteger(parsed) ? parsed : NaN;
  }

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

  function adjustSlotCountsOnRelease(appointment) {
    const { item_id, appointment_date, time_slot, window_id } = appointment;

    const timeSlotCap = db.prepare(`
      SELECT * FROM time_slot_capacities 
      WHERE item_id = ? AND date = ?
    `).all(item_id, appointment_date);

    const hasTimeSlots = timeSlotCap.length > 0;

    if (hasTimeSlots) {
      const matched = timeSlotCap.find(ts => 
        time_slot === `${ts.start_time}-${ts.end_time}`
      );
      if (matched) {
        db.prepare(
          'UPDATE time_slot_capacities SET current_count = current_count - 1 WHERE id = ?'
        ).run(matched.id);
      }
    }

    if (window_id) {
      db.prepare(
        'UPDATE window_slots SET current_count = current_count - 1 WHERE window_id = ? AND item_id = ? AND date = ?'
      ).run(window_id, item_id, appointment_date);
    } else if (!hasTimeSlots) {
      db.prepare(
        'UPDATE daily_slots SET current_count = current_count - 1 WHERE item_id = ? AND date = ?'
      ).run(item_id, appointment_date);
    }

    return { hasTimeSlots };
  }

  function adjustSlotCountsOnRestore(appointment) {
    const { item_id, appointment_date, time_slot, window_id } = appointment;

    const timeSlotCap = db.prepare(`
      SELECT * FROM time_slot_capacities 
      WHERE item_id = ? AND date = ?
    `).all(item_id, appointment_date);

    const hasTimeSlots = timeSlotCap.length > 0;
    let canRestore = true;

    if (hasTimeSlots) {
      const matched = timeSlotCap.find(ts => 
        time_slot === `${ts.start_time}-${ts.end_time}`
      );
      if (matched) {
        if (matched.current_count >= matched.max_count) {
          canRestore = false;
        }
      }
    }

    if (window_id) {
      const slot = db.prepare(
        'SELECT * FROM window_slots WHERE window_id = ? AND item_id = ? AND date = ?'
      ).get(window_id, item_id, appointment_date);
      if (slot && slot.current_count >= slot.max_count) {
        canRestore = false;
      }
    } else if (!hasTimeSlots) {
      const slot = db.prepare('SELECT * FROM daily_slots WHERE item_id = ? AND date = ?').get(item_id, appointment_date);
      if (slot && slot.current_count >= slot.max_count) {
        canRestore = false;
      }
    }

    if (!canRestore) {
      return { canRestore: false };
    }

    if (hasTimeSlots) {
      const matched = timeSlotCap.find(ts => 
        time_slot === `${ts.start_time}-${ts.end_time}`
      );
      if (matched) {
        db.prepare(
          'UPDATE time_slot_capacities SET current_count = current_count + 1 WHERE id = ?'
        ).run(matched.id);
      }
    }

    if (window_id) {
      db.prepare(
        'UPDATE window_slots SET current_count = current_count + 1 WHERE window_id = ? AND item_id = ? AND date = ?'
      ).run(window_id, item_id, appointment_date);
    } else if (!hasTimeSlots) {
      db.prepare(
        'UPDATE daily_slots SET current_count = current_count + 1 WHERE item_id = ? AND date = ?'
      ).run(item_id, appointment_date);
    }

    return { canRestore: true };
  }

  function validateBookingPreconditions({ item, phone, dateStr }) {
    const dateObj = new Date(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (dateObj < today) {
      throw new Error('不能预约过去的日期');
    }

    const isToday = dateObj.getTime() === today.getTime();
    if (isToday && !isSameDayBookingAllowed(item)) {
      throw new Error('该事项不支持当天预约');
    }

    if (!isDateWithinAdvanceWeeks(dateStr, item)) {
      const maxDate = getMaxAdvanceDate(item);
      const maxDateStr = maxDate.toISOString().split('T')[0];
      throw new Error(`超出可预约范围，最远可预约至 ${maxDateStr}`);
    }

    if (!isWorkday(dateStr)) {
      throw new Error('该日期不可预约');
    }

    const maxActive = getMaxActiveAppointments(item);
    const activeCount = countActiveAppointments(phone, item.id);
    if (activeCount >= maxActive) {
      throw new Error(`该手机号已有 ${activeCount} 个未完成的${item.name}预约，最多可同时有 ${maxActive} 个未完成预约，请先完成或取消后再预约`);
    }

    return { isToday, maxActive, activeCount };
  }

  function getTimeSlotsForDate(itemId, date) {
    return db.prepare(`
      SELECT * FROM time_slot_capacities 
      WHERE item_id = ? AND date = ? 
      ORDER BY sort_order ASC, start_time ASC
    `).all(itemId, date);
  }

  function validateTimeSlotAvailability(itemId, date, timeSlot) {
    const timeSlotCaps = getTimeSlotsForDate(itemId, date);
    const useTimeSlots = timeSlotCaps.length > 0;

    if (!useTimeSlots) {
      const slotCheck = db.prepare(
        `SELECT COUNT(*) as cnt FROM appointments 
         WHERE item_id = ? AND appointment_date = ? AND time_slot = ? AND status NOT IN ('cancelled', 'no_show')`
      ).get(itemId, date, timeSlot);

      if (slotCheck.cnt > 0) {
        throw new Error('该时段已被预约，请选择其他时段');
      }

      return { useTimeSlots: false, matchedSlot: null };
    }

    let matchedTimeSlot = null;
    for (const tsc of timeSlotCaps) {
      if (timeSlot === `${tsc.start_time}-${tsc.end_time}`) {
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

    return { useTimeSlots: true, matchedSlot: matchedTimeSlot };
  }

  function validateDailyCapacity(item, date) {
    let dailySlot = db.prepare('SELECT * FROM daily_slots WHERE item_id = ? AND date = ?').get(item.id, date);
    if (!dailySlot) {
      const defaultMax = item.default_max_count || 20;
      db.prepare('INSERT INTO daily_slots (item_id, date, max_count, current_count) VALUES (?, ?, ?, 0)').run(item.id, date, defaultMax);
      dailySlot = db.prepare('SELECT * FROM daily_slots WHERE item_id = ? AND date = ?').get(item.id, date);
    }

    if (dailySlot.current_count >= dailySlot.max_count) {
      throw new Error('该日期号源已满，请选择其他日期');
    }

    return dailySlot;
  }

  function incrementTimeSlotCount(slotId) {
    db.prepare(
      'UPDATE time_slot_capacities SET current_count = current_count + 1 WHERE id = ?'
    ).run(slotId);
  }

  function decrementTimeSlotCount(slotId) {
    db.prepare(
      'UPDATE time_slot_capacities SET current_count = current_count - 1 WHERE id = ?'
    ).run(slotId);
  }

  function incrementWindowSlotCount(windowId, itemId, date) {
    db.prepare(
      'UPDATE window_slots SET current_count = current_count + 1 WHERE window_id = ? AND item_id = ? AND date = ?'
    ).run(windowId, itemId, date);
  }

  function decrementWindowSlotCount(windowId, itemId, date) {
    db.prepare(
      'UPDATE window_slots SET current_count = current_count - 1 WHERE window_id = ? AND item_id = ? AND date = ?'
    ).run(windowId, itemId, date);
  }

  function incrementDailySlotCount(itemId, date) {
    db.prepare('UPDATE daily_slots SET current_count = current_count + 1 WHERE item_id = ? AND date = ?').run(itemId, date);
  }

  function decrementDailySlotCount(itemId, date) {
    db.prepare('UPDATE daily_slots SET current_count = current_count - 1 WHERE item_id = ? AND date = ?').run(itemId, date);
  }

  return {
    getTodayStr,
    isValidDate,
    isWorkday,
    getAppointmentStartTime,
    getMaxAdvanceDate,
    isDateWithinAdvanceWeeks,
    isSameDayBookingAllowed,
    isSameDayReschedulingAllowed,
    getAppointmentDateTime,
    isCancellationAllowed,
    isReschedulingAllowed,
    getMaxActiveAppointments,
    countActiveAppointments,
    generateTimeSlots,
    getWeekdayFromDate,
    hasManualDailySlot,
    hasManualTimeSlots,
    hasManualWindowSlots,
    getWeeklyDailyTemplate,
    getWeeklyTimeSlotTemplates,
    getWeeklyWindowTemplates,
    getActiveTimeSlotAppointmentCount,
    getActiveWindowAppointmentCount,
    syncGeneratedDailySlots,
    clearGeneratedDailySlotsForWeekday,
    syncGeneratedTimeSlotTemplates,
    syncGeneratedWindowTemplates,
    getEffectiveWindowSlot,
    parseSlotMaxCount,
    parseNullableInt,
    parseNullableBool,
    adjustSlotCountsOnRelease,
    adjustSlotCountsOnRestore,
    validateBookingPreconditions,
    getTimeSlotsForDate,
    validateTimeSlotAvailability,
    validateDailyCapacity,
    incrementTimeSlotCount,
    decrementTimeSlotCount,
    incrementWindowSlotCount,
    decrementWindowSlotCount,
    incrementDailySlotCount,
    decrementDailySlotCount
  };
}

module.exports = createCapacityService;
