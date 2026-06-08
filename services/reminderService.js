function createReminderService(db) {
  function createReminder(appointmentId, phone, type, content, options = {}) {
    const { scheduledTime = null, sendStatus = 'simulated' } = options;
    const stmt = db.prepare(
      'INSERT INTO appointment_reminders (appointment_id, phone, type, content, send_status, scheduled_time, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    const sentAt = sendStatus === 'simulated' || sendStatus === 'sent' ? new Date().toISOString() : null;
    const result = stmt.run(appointmentId, phone, type, content, sendStatus, scheduledTime, sentAt);
    return result.lastInsertRowid;
  }

  function generateReminderContent(type, appointment) {
    const windowText = appointment.window_name ? `，办理窗口：${appointment.window_name}` : '';
    const templates = {
      created: `【预约成功】您的${appointment.item_name || '业务'}预约已成功，预约日期：${appointment.appointment_date} ${appointment.time_slot}${windowText}，请准时前往办理。`,
      cancelled: `【预约取消】您的${appointment.item_name || '业务'}预约已取消，预约日期：${appointment.appointment_date} ${appointment.time_slot}。`,
      arrived: `【到场提醒】您的${appointment.item_name || '业务'}预约已签到，请在休息区等待叫号。`,
      calling: `【叫号提醒】请${appointment.user_name || ''}顾客前往${appointment.window_name || appointment.item_name || '业务'}窗口办理，您的号码是${appointment.queue_number || ''}号。`,
      completed: `【办理完成】您的${appointment.item_name || '业务'}已办理完成，感谢您的配合。`,
      no_show: `【爽约提醒】您的${appointment.item_name || '业务'}预约（${appointment.appointment_date} ${appointment.time_slot}）已被标记为爽约，请按时前往办理，多次爽约将被限制预约。`,
      before_day: `【预约提醒】明天您有${appointment.item_name || '业务'}预约，预约时间：${appointment.appointment_date} ${appointment.time_slot}${windowText}，请准时前往办理。`,
      on_day: `【预约提醒】今天您有${appointment.item_name || '业务'}预约，预约时间：${appointment.time_slot}${windowText}，请准时前往办理。`,
      rescheduled: `【预约改期】您的${appointment.item_name || '业务'}预约已改期，新预约日期：${appointment.appointment_date} ${appointment.time_slot}${windowText}，请准时前往办理。`
    };
    return templates[type] || '';
  }

  function getAppointmentStartTime(timeSlot) {
    if (!timeSlot) return '09:00';
    const parts = timeSlot.split('-');
    return parts[0] || '09:00';
  }

  function getTodayStr() {
    const today = new Date();
    return today.toISOString().split('T')[0];
  }

  function createScheduledReminders(appointmentId, appointment) {
    const aptDate = new Date(appointment.appointment_date + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const startTime = getAppointmentStartTime(appointment.time_slot);

    const beforeDayDate = new Date(aptDate);
    beforeDayDate.setDate(beforeDayDate.getDate() - 1);
    beforeDayDate.setHours(9, 0, 0, 0);

    const onDayDate = new Date(aptDate);
    const [hour, minute] = startTime.split(':').map(Number);
    onDayDate.setHours(hour - 1, minute || 0, 0, 0);

    const reminderIds = [];

    if (beforeDayDate > today) {
      const content = generateReminderContent('before_day', appointment);
      const id = createReminder(appointmentId, appointment.phone, 'before_day', content, {
        scheduledTime: beforeDayDate.toISOString(),
        sendStatus: 'pending'
      });
      reminderIds.push(id);
    }

    if (onDayDate > today) {
      const content = generateReminderContent('on_day', appointment);
      const id = createReminder(appointmentId, appointment.phone, 'on_day', content, {
        scheduledTime: onDayDate.toISOString(),
        sendStatus: 'pending'
      });
      reminderIds.push(id);
    }

    return reminderIds;
  }

  function cancelPendingReminders(appointmentId) {
    const stmt = db.prepare(`
      UPDATE appointment_reminders 
      SET send_status = 'cancelled' 
      WHERE appointment_id = ? AND send_status = 'pending'
    `);
    const result = stmt.run(appointmentId);
    return result.changes;
  }

  function sendReminder(reminderId) {
    const reminder = db.prepare('SELECT * FROM appointment_reminders WHERE id = ?').get(reminderId);
    if (!reminder) {
      throw new Error('提醒记录不存在');
    }
    if (reminder.send_status === 'simulated' || reminder.send_status === 'sent') {
      throw new Error('该提醒已发送');
    }

    const stmt = db.prepare(`
      UPDATE appointment_reminders 
      SET send_status = 'simulated', sent_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `);
    stmt.run(reminderId);
    return true;
  }

  function createStatusReminder(appointmentId, phone, status, appointmentInfo) {
    const content = generateReminderContent(status, appointmentInfo);
    return createReminder(appointmentId, phone, status, content);
  }

  function createAppointmentReminders(appointmentId, appointmentInfo) {
    const createdId = createReminder(
      appointmentId,
      appointmentInfo.phone,
      'created',
      generateReminderContent('created', appointmentInfo)
    );
    const scheduledIds = createScheduledReminders(appointmentId, appointmentInfo);
    return { createdId, scheduledIds };
  }

  function handleStatusChangeReminders(appointmentId, phone, oldStatus, newStatus, appointmentInfo) {
    const reminderTypes = ['arrived', 'calling', 'completed', 'cancelled', 'no_show'];
    if (reminderTypes.includes(newStatus) && oldStatus !== newStatus) {
      createStatusReminder(appointmentId, phone, newStatus, appointmentInfo);

      const cancelPendingStatuses = ['cancelled', 'no_show', 'completed'];
      if (cancelPendingStatuses.includes(newStatus)) {
        cancelPendingReminders(appointmentId);
      }
    }
  }

  return {
    createReminder,
    generateReminderContent,
    createScheduledReminders,
    cancelPendingReminders,
    sendReminder,
    createStatusReminder,
    createAppointmentReminders,
    handleStatusChangeReminders,
    getAppointmentStartTime,
    getTodayStr
  };
}

module.exports = createReminderService;
