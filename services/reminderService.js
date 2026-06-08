function getSqliteDateTime(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function toDateAt(dateStr, hour = 9, minute = 0) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

function generateReminderContent(type, appointment) {
  const windowText = appointment.window_name ? `，办理窗口：${appointment.window_name}` : '';
  const templates = {
    created: `【预约成功】您的${appointment.item_name || '业务'}预约已成功，预约日期：${appointment.appointment_date} ${appointment.time_slot}${windowText}，请准时前往办理。`,
    cancelled: `【预约取消】您的${appointment.item_name || '业务'}预约已取消，预约日期：${appointment.appointment_date} ${appointment.time_slot}。`,
    day_before: `【预约提醒】您预约的${appointment.item_name || '业务'}将于明天 ${appointment.appointment_date} ${appointment.time_slot}${windowText}办理，请提前准备材料。`,
    same_day: `【预约提醒】您预约的${appointment.item_name || '业务'}将在今天 ${appointment.appointment_date} ${appointment.time_slot}${windowText}办理，请按时前往。`,
    rescheduled: `【预约改期】您的${appointment.item_name || '业务'}预约已改期，新预约日期：${appointment.appointment_date} ${appointment.time_slot}${windowText}，请准时前往办理。`,
    arrived: `【到场提醒】您的${appointment.item_name || '业务'}预约已签到，请在休息区等待叫号。`,
    calling: `【叫号提醒】请${appointment.user_name || ''}顾客前往${appointment.window_name || appointment.item_name || '业务'}窗口办理，您的号码是${appointment.queue_number || ''}号。`,
    completed: `【办理完成】您的${appointment.item_name || '业务'}已办理完成，感谢您的配合。`,
    no_show: `【爽约提醒】您的${appointment.item_name || '业务'}预约（${appointment.appointment_date} ${appointment.time_slot}）已被标记为爽约，请按时前往办理，多次爽约将被限制预约。`
  };
  return templates[type] || '';
}

function createReminder(db, appointmentId, phone, type, content, options = {}) {
  const sendStatus = options.send_status || 'simulated';
  const scheduledFor = options.scheduled_for || null;
  const sentAt = options.sent_at || null;
  const failReason = options.fail_reason || null;
  const stmt = db.prepare(
    `INSERT INTO appointment_reminders
     (appointment_id, phone, type, content, send_status, scheduled_for, sent_at, fail_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const result = stmt.run(appointmentId, phone, type, content, sendStatus, scheduledFor, sentAt, failReason);
  return result.lastInsertRowid;
}

function cancelPendingReminderPlans(db, appointmentId) {
  return db.prepare(`
    DELETE FROM appointment_reminders
    WHERE appointment_id = ?
      AND send_status = 'pending'
      AND type IN ('day_before', 'same_day')
  `).run(appointmentId).changes;
}

function createPreAppointmentReminderPlans(db, appointment) {
  cancelPendingReminderPlans(db, appointment.id);

  const item = appointment.item_name
    ? { name: appointment.item_name }
    : db.prepare('SELECT name FROM items WHERE id = ?').get(appointment.item_id);
  const window = appointment.window_name
    ? { name: appointment.window_name }
    : (appointment.window_id ? db.prepare('SELECT name FROM windows WHERE id = ?').get(appointment.window_id) : null);
  const base = {
    item_name: item ? item.name : '',
    window_name: window ? window.name : '',
    appointment_date: appointment.appointment_date,
    time_slot: appointment.time_slot
  };

  const appointmentDay = toDateAt(appointment.appointment_date, 9, 0);
  const plans = [
    { type: 'day_before', scheduled_for: getSqliteDateTime(addDays(appointmentDay, -1)) },
    { type: 'same_day', scheduled_for: getSqliteDateTime(appointmentDay) }
  ];

  return plans.map(plan => createReminder(
    db,
    appointment.id,
    appointment.phone,
    plan.type,
    generateReminderContent(plan.type, base),
    { send_status: 'pending', scheduled_for: plan.scheduled_for }
  ));
}

function sendReminderNow(db, reminderId) {
  const reminder = db.prepare('SELECT * FROM appointment_reminders WHERE id = ?').get(reminderId);
  if (!reminder) {
    return { error: '提醒记录不存在', statusCode: 404 };
  }
  if (!['pending', 'failed'].includes(reminder.send_status)) {
    return { error: '只有待发送或发送失败的提醒可以触发发送', statusCode: 400 };
  }

  db.prepare(`
    UPDATE appointment_reminders
    SET send_status = 'simulated',
        sent_at = CURRENT_TIMESTAMP,
        fail_reason = NULL
    WHERE id = ?
  `).run(reminderId);

  return {
    reminder: db.prepare('SELECT * FROM appointment_reminders WHERE id = ?').get(reminderId)
  };
}

module.exports = {
  createReminder,
  generateReminderContent,
  cancelPendingReminderPlans,
  createPreAppointmentReminderPlans,
  sendReminderNow
};
