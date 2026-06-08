function getActiveTimeSlotAppointmentCount(db, itemId, date, startTime, endTime) {
  return db.prepare(`
    SELECT COUNT(*) as cnt FROM appointments
    WHERE item_id = ? AND appointment_date = ?
      AND time_slot = ? AND status NOT IN ('cancelled', 'no_show')
  `).get(itemId, date, `${startTime}-${endTime}`).cnt;
}

function getTimeSlotCapacity(db, itemId, date, timeSlot) {
  const timeSlotCaps = db.prepare(`
    SELECT * FROM time_slot_capacities
    WHERE item_id = ? AND date = ?
    ORDER BY sort_order ASC, start_time ASC
  `).all(itemId, date);

  if (timeSlotCaps.length === 0) {
    return { use_time_slots: false, matched_time_slot: null, time_slots: [] };
  }

  const matchedTimeSlot = timeSlotCaps.find(ts => timeSlot === `${ts.start_time}-${ts.end_time}`) || null;
  return { use_time_slots: true, matched_time_slot: matchedTimeSlot, time_slots: timeSlotCaps };
}

function validateTimeSlotCapacity(db, { itemId, date, timeSlot }) {
  const result = getTimeSlotCapacity(db, itemId, date, timeSlot);

  if (result.use_time_slots) {
    if (!result.matched_time_slot) {
      throw new Error('所选时段无效，请重新选择');
    }
    if (result.matched_time_slot.current_count >= result.matched_time_slot.max_count) {
      throw new Error('该时段号源已满，请选择其他时段');
    }
    return result;
  }

  const slotCheck = db.prepare(
    `SELECT COUNT(*) as cnt FROM appointments
     WHERE item_id = ? AND appointment_date = ? AND time_slot = ? AND status NOT IN ('cancelled', 'no_show')`
  ).get(itemId, date, timeSlot);

  if (slotCheck.cnt > 0) {
    throw new Error('该时段已被预约，请选择其他时段');
  }

  return result;
}

function ensureDailySlot(db, { itemId, date, defaultMax }) {
  let dailySlot = db.prepare('SELECT * FROM daily_slots WHERE item_id = ? AND date = ?').get(itemId, date);
  if (!dailySlot) {
    db.prepare('INSERT INTO daily_slots (item_id, date, max_count, current_count) VALUES (?, ?, ?, 0)').run(itemId, date, defaultMax);
    dailySlot = db.prepare('SELECT * FROM daily_slots WHERE item_id = ? AND date = ?').get(itemId, date);
  }
  return dailySlot;
}

function validateDailyCapacity(db, { itemId, date, defaultMax }) {
  const dailySlot = ensureDailySlot(db, { itemId, date, defaultMax });
  if (dailySlot.current_count >= dailySlot.max_count) {
    throw new Error('该日期号源已满，请选择其他日期');
  }
  return dailySlot;
}

function incrementAppointmentCapacity(db, { itemId, date, windowId, useTimeSlots, matchedTimeSlot }) {
  if (useTimeSlots && matchedTimeSlot) {
    db.prepare(
      'UPDATE time_slot_capacities SET current_count = current_count + 1 WHERE id = ?'
    ).run(matchedTimeSlot.id);
  }

  if (windowId) {
    db.prepare(
      'UPDATE window_slots SET current_count = current_count + 1 WHERE window_id = ? AND item_id = ? AND date = ?'
    ).run(windowId, itemId, date);
  } else if (!useTimeSlots) {
    db.prepare('UPDATE daily_slots SET current_count = current_count + 1 WHERE item_id = ? AND date = ?').run(itemId, date);
  }
}

function releaseAppointmentCapacity(db, appointment) {
  const timeSlotCaps = db.prepare(`
    SELECT * FROM time_slot_capacities
    WHERE item_id = ? AND date = ?
  `).all(appointment.item_id, appointment.appointment_date);

  const hasTimeSlots = timeSlotCaps.length > 0;
  const matchedTimeSlot = timeSlotCaps.find(ts => appointment.time_slot === `${ts.start_time}-${ts.end_time}`);

  if (hasTimeSlots && matchedTimeSlot) {
    db.prepare(
      'UPDATE time_slot_capacities SET current_count = current_count - 1 WHERE id = ?'
    ).run(matchedTimeSlot.id);
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

  return { has_time_slots: hasTimeSlots, matched_time_slot: matchedTimeSlot || null };
}

module.exports = {
  getActiveTimeSlotAppointmentCount,
  validateTimeSlotCapacity,
  validateDailyCapacity,
  incrementAppointmentCapacity,
  releaseAppointmentCapacity
};
