const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');

function nextWorkday(offset = 1) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  while (date.getDay() === 0 || date.getDay() === 6) {
    date.setDate(date.getDate() + 1);
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function clearServerModule() {
  delete require.cache[require.resolve('../server')];
}

async function withTestApp(fn) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'appointment-flow-'));
  const dbPath = path.join(tempDir, 'appointment.sqlite');
  const previousDbPath = process.env.APPOINTMENT_DB_PATH;
  process.env.APPOINTMENT_DB_PATH = dbPath;
  clearServerModule();

  const server = require('../server');
  const agent = request(server.app);

  try {
    await fn({ agent, db: server.db });
  } finally {
    server.db.close();
    clearServerModule();
    if (previousDbPath === undefined) {
      delete process.env.APPOINTMENT_DB_PATH;
    } else {
      process.env.APPOINTMENT_DB_PATH = previousDbPath;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function prepareBookableItem(agent, db, date, slot = '09:00-10:00') {
  const itemRes = await agent
    .post('/api/items')
    .send({
      name: `集成测试事项-${Date.now()}`,
      description: '用于预约创建和改期集成测试',
      default_max_count: 2,
      advance_weeks: 8,
      allow_same_day: 1,
      max_active_appointments: 3
    })
    .expect(200);

  const itemId = itemRes.body.id;

  const windowRow = db.prepare('SELECT id FROM windows WHERE status = ? ORDER BY id ASC LIMIT 1').get('active');
  assert.ok(windowRow, 'default active window should exist');

  await agent
    .put(`/api/items/${itemId}/windows`)
    .send({ windows: [{ window_id: windowRow.id, default_capacity: 2 }] })
    .expect(200);

  await agent
    .put(`/api/slots/${itemId}/${date}/windows/max`)
    .send({ windows: [{ window_id: windowRow.id, max_count: 2 }] })
    .expect(200);

  const [startTime, endTime] = slot.split('-');
  await agent
    .put(`/api/slots/${itemId}/${date}/time-slots`)
    .send({ time_slots: [{ start_time: startTime, end_time: endTime, max_count: 2 }] })
    .expect(200);

  return { itemId, windowId: windowRow.id, slot };
}

test('群众端创建预约会生成材料快照并占用窗口和时段容量', async () => {
  await withTestApp(async ({ agent, db }) => {
    const date = nextWorkday(3);
    const { itemId, windowId, slot } = await prepareBookableItem(agent, db, date);

    const requiredMaterial = await agent
      .post(`/api/items/${itemId}/materials`)
      .send({
        name: '身份证原件',
        description: '现场核验',
        sort_order: 1,
        is_required: 1,
        require_confirmation: 1
      })
      .expect(200);

    await agent
      .post(`/api/items/${itemId}/materials`)
      .send({
        name: '申请表',
        description: '可现场填写',
        sort_order: 2,
        is_required: 0,
        require_confirmation: 0
      })
      .expect(200);

    const createRes = await agent
      .post('/api/appointments')
      .send({
        item_id: itemId,
        user_name: '张三',
        phone: '13800000001',
        appointment_date: date,
        time_slot: slot,
        material_confirmations: [
          { material_id: requiredMaterial.body.id, is_confirmed: true }
        ]
      })
      .expect(200);

    const appointmentId = createRes.body.id;
    assert.equal(createRes.body.window_id, windowId);

    const snapshots = await agent
      .get(`/api/appointments/${appointmentId}/material-snapshots`)
      .query({ phone: '13800000001' })
      .expect(200);

    assert.equal(snapshots.body.length, 2);
    assert.deepEqual(
      snapshots.body.map(snapshot => ({
        name: snapshot.material_name,
        required: snapshot.is_required,
        confirmation: snapshot.require_confirmation,
        confirmed: snapshot.is_confirmed
      })),
      [
        { name: '身份证原件', required: 1, confirmation: 1, confirmed: 1 },
        { name: '申请表', required: 0, confirmation: 0, confirmed: 0 }
      ]
    );

    const slotRow = db
      .prepare('SELECT current_count FROM time_slot_capacities WHERE item_id = ? AND date = ? AND start_time = ? AND end_time = ?')
      .get(itemId, date, '09:00', '10:00');
    assert.equal(slotRow.current_count, 1);

    const windowSlot = db
      .prepare('SELECT current_count FROM window_slots WHERE item_id = ? AND window_id = ? AND date = ?')
      .get(itemId, windowId, date);
    assert.equal(windowSlot.current_count, 1);
  });
});

test('群众端改期会释放旧号源并占用新号源', async () => {
  await withTestApp(async ({ agent, db }) => {
    const oldDate = nextWorkday(4);
    const newDate = nextWorkday(6);
    const oldSlot = '09:00-10:00';
    const newSlot = '10:00-11:00';
    const { itemId, windowId } = await prepareBookableItem(agent, db, oldDate, oldSlot);

    await agent
      .put(`/api/slots/${itemId}/${newDate}/windows/max`)
      .send({ windows: [{ window_id: windowId, max_count: 2 }] })
      .expect(200);

    await agent
      .put(`/api/slots/${itemId}/${newDate}/time-slots`)
      .send({ time_slots: [{ start_time: '10:00', end_time: '11:00', max_count: 2 }] })
      .expect(200);

    const createRes = await agent
      .post('/api/appointments')
      .send({
        item_id: itemId,
        user_name: '李四',
        phone: '13800000002',
        appointment_date: oldDate,
        time_slot: oldSlot
      })
      .expect(200);

    const appointmentId = createRes.body.id;

    await agent
      .post(`/api/appointments/${appointmentId}/reschedule`)
      .send({
        phone: '13800000002',
        new_date: newDate,
        new_time_slot: newSlot,
        reason: '时间调整'
      })
      .expect(200);

    const oldTimeSlot = db
      .prepare('SELECT current_count FROM time_slot_capacities WHERE item_id = ? AND date = ? AND start_time = ? AND end_time = ?')
      .get(itemId, oldDate, '09:00', '10:00');
    assert.equal(oldTimeSlot.current_count, 0);

    const newTimeSlot = db
      .prepare('SELECT current_count FROM time_slot_capacities WHERE item_id = ? AND date = ? AND start_time = ? AND end_time = ?')
      .get(itemId, newDate, '10:00', '11:00');
    assert.equal(newTimeSlot.current_count, 1);

    const oldWindowSlot = db
      .prepare('SELECT current_count FROM window_slots WHERE item_id = ? AND window_id = ? AND date = ?')
      .get(itemId, windowId, oldDate);
    assert.equal(oldWindowSlot.current_count, 0);

    const newWindowSlot = db
      .prepare('SELECT current_count FROM window_slots WHERE item_id = ? AND window_id = ? AND date = ?')
      .get(itemId, windowId, newDate);
    assert.equal(newWindowSlot.current_count, 1);

    const updatedAppointment = await agent
      .get('/api/appointments/query')
      .query({ id: appointmentId, phone: '13800000002' })
      .expect(200);

    assert.equal(updatedAppointment.body.appointment_date, newDate);
    assert.equal(updatedAppointment.body.time_slot, newSlot);
    assert.equal(updatedAppointment.body.window_id, windowId);

    const history = await agent
      .get(`/api/appointments/${appointmentId}/reschedules`)
      .query({ phone: '13800000002' })
      .expect(200);

    assert.equal(history.body.length, 1);
    assert.equal(history.body[0].old_date, oldDate);
    assert.equal(history.body[0].new_date, newDate);
    assert.equal(history.body[0].old_time_slot, oldSlot);
    assert.equal(history.body[0].new_time_slot, newSlot);
  });
});
