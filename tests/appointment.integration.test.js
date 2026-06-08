const path = require('path');
const fs = require('fs');
const os = require('os');
const request = require('supertest');

let app;
let db;
let testDbPath;

function getFutureDate(daysFromNow) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  while (date.getDay() === 0 || date.getDay() === 6) {
    date.setDate(date.getDate() + 1);
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

beforeAll(() => {
  testDbPath = path.join(os.tmpdir(), `test-appointment-${Date.now()}.db`);
  process.env.DB_PATH = testDbPath;
  jest.resetModules();
  const server = require('../server');
  app = server.app;
  db = server.db;
});

afterAll(() => {
  if (db) {
    db.close();
  }
  if (testDbPath && fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }
});

describe('预约创建流程集成测试', () => {
  let testItem;
  let testMaterial1;
  let testMaterial2;
  let testWindow;
  const testDate1 = getFutureDate(3);
  const testDate2 = getFutureDate(5);
  const userPhone = '13800138000';
  const userName = '测试用户';

  beforeAll(async () => {
    const itemResult = db.prepare(
      'INSERT INTO items (name, description, default_max_count, allow_same_day) VALUES (?, ?, ?, ?)'
    ).run('测试事项A', '测试事项描述', 10, 1);
    testItem = { id: itemResult.lastInsertRowid };

    const mat1Result = db.prepare(
      'INSERT INTO item_materials (item_id, name, description, is_required, require_confirmation, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(testItem.id, '身份证', '需携带本人身份证原件', 1, 1, 1);
    testMaterial1 = { id: mat1Result.lastInsertRowid };

    const mat2Result = db.prepare(
      'INSERT INTO item_materials (item_id, name, description, is_required, require_confirmation, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(testItem.id, '申请表', '填写完整的申请表', 0, 0, 2);
    testMaterial2 = { id: mat2Result.lastInsertRowid };

    const windowResult = db.prepare(
      "INSERT INTO windows (name, description, status, sort_order) VALUES (?, ?, 'active', ?)"
    ).run('1号窗口', '综合业务窗口', 1);
    testWindow = { id: windowResult.lastInsertRowid };

    db.prepare(
      'INSERT INTO item_windows (item_id, window_id, default_capacity) VALUES (?, ?, ?)'
    ).run(testItem.id, testWindow.id, 5);

    db.prepare(
      `INSERT INTO time_slot_capacities (item_id, date, start_time, end_time, max_count, current_count, sort_order, source_type)
       VALUES (?, ?, '09:00', '10:00', 3, 0, 1, 'manual')`
    ).run(testItem.id, testDate1);

    db.prepare(
      `INSERT INTO time_slot_capacities (item_id, date, start_time, end_time, max_count, current_count, sort_order, source_type)
       VALUES (?, ?, '10:00', '11:00', 3, 0, 2, 'manual')`
    ).run(testItem.id, testDate1);

    db.prepare(
      `INSERT INTO time_slot_capacities (item_id, date, start_time, end_time, max_count, current_count, sort_order, source_type)
       VALUES (?, ?, '09:00', '10:00', 3, 0, 1, 'manual')`
    ).run(testItem.id, testDate2);
  });

  test('群众端成功创建预约 - 基础预约创建', async () => {
    const response = await request(app)
      .post('/api/appointments')
      .send({
        item_id: testItem.id,
        user_name: userName,
        phone: userPhone,
        appointment_date: testDate1,
        time_slot: '09:00-10:00',
        material_confirmations: [
          { material_id: testMaterial1.id, is_confirmed: true },
          { material_id: testMaterial2.id, is_confirmed: false }
        ]
      });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('id');
    expect(response.body.user_name).toBe(userName);
    expect(response.body.phone).toBe(userPhone);
    expect(response.body.appointment_date).toBe(testDate1);
    expect(response.body.time_slot).toBe('09:00-10:00');
    expect(response.body.status).toBe('pending');
    expect(response.body).toHaveProperty('window_id');
  });

  test('材料快照生成 - 创建预约后材料快照正确保存', async () => {
    const createResponse = await request(app)
      .post('/api/appointments')
      .send({
        item_id: testItem.id,
        user_name: '快照测试用户',
        phone: '13900139000',
        appointment_date: testDate1,
        time_slot: '10:00-11:00',
        material_confirmations: [
          { material_id: testMaterial1.id, is_confirmed: true },
          { material_id: testMaterial2.id, is_confirmed: false }
        ]
      });

    const appointmentId = createResponse.body.id;

    const response = await request(app)
      .get(`/api/appointments/${appointmentId}/material-snapshots`)
      .query({ phone: '13900139000' });

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBe(2);

    const snapshot1 = response.body.find(s => s.material_id === testMaterial1.id);
    expect(snapshot1).toBeDefined();
    expect(snapshot1.material_name).toBe('身份证');
    expect(snapshot1.is_required).toBe(1);
    expect(snapshot1.require_confirmation).toBe(1);
    expect(snapshot1.is_confirmed).toBe(1);

    const snapshot2 = response.body.find(s => s.material_id === testMaterial2.id);
    expect(snapshot2).toBeDefined();
    expect(snapshot2.material_name).toBe('申请表');
    expect(snapshot2.is_required).toBe(0);
    expect(snapshot2.require_confirmation).toBe(0);
    expect(snapshot2.is_confirmed).toBe(0);
  });

  test('时段容量占用 - 创建预约后分时段容量正确增加', async () => {
    const beforeSlot = db.prepare(
      'SELECT * FROM time_slot_capacities WHERE item_id = ? AND date = ? AND start_time = ? AND end_time = ?'
    ).get(testItem.id, testDate2, '09:00', '10:00');
    const beforeCount = beforeSlot.current_count;

    await request(app)
      .post('/api/appointments')
      .send({
        item_id: testItem.id,
        user_name: '容量测试用户',
        phone: '13700137000',
        appointment_date: testDate2,
        time_slot: '09:00-10:00',
        material_confirmations: [
          { material_id: testMaterial1.id, is_confirmed: true }
        ]
      });

    const afterSlot = db.prepare(
      'SELECT * FROM time_slot_capacities WHERE item_id = ? AND date = ? AND start_time = ? AND end_time = ?'
    ).get(testItem.id, testDate2, '09:00', '10:00');

    expect(afterSlot.current_count).toBe(beforeCount + 1);
  });

  test('窗口容量占用 - 创建预约后窗口号源正确占用', async () => {
    const beforeWindowSlot = db.prepare(
      'SELECT * FROM window_slots WHERE window_id = ? AND item_id = ? AND date = ?'
    ).get(testWindow.id, testItem.id, testDate2);
    const beforeWindowCount = beforeWindowSlot ? beforeWindowSlot.current_count : 0;

    const createResponse = await request(app)
      .post('/api/appointments')
      .send({
        item_id: testItem.id,
        user_name: '窗口测试用户',
        phone: '13600136000',
        appointment_date: testDate2,
        time_slot: '09:00-10:00',
        material_confirmations: [
          { material_id: testMaterial1.id, is_confirmed: true }
        ]
      });

    expect(createResponse.body.window_id).toBeDefined();

    const afterWindowSlot = db.prepare(
      'SELECT * FROM window_slots WHERE window_id = ? AND item_id = ? AND date = ?'
    ).get(createResponse.body.window_id, testItem.id, testDate2);

    expect(afterWindowSlot).toBeDefined();
    expect(afterWindowSlot.current_count).toBe(beforeWindowCount + 1);
  });

  test('未确认必备材料时拒绝创建预约', async () => {
    const response = await request(app)
      .post('/api/appointments')
      .send({
        item_id: testItem.id,
        user_name: '测试用户2',
        phone: '13500135000',
        appointment_date: testDate1,
        time_slot: '09:00-10:00',
        material_confirmations: []
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('请确认必备材料');
  });

  test('时段号源已满时拒绝创建预约', async () => {
    const testDateFull = getFutureDate(10);
    db.prepare(
      `INSERT INTO time_slot_capacities (item_id, date, start_time, end_time, max_count, current_count, sort_order, source_type)
       VALUES (?, ?, '14:00', '15:00', 1, 1, 1, 'manual')`
    ).run(testItem.id, testDateFull);

    const response = await request(app)
      .post('/api/appointments')
      .send({
        item_id: testItem.id,
        user_name: '满额测试用户',
        phone: '13400134000',
        appointment_date: testDateFull,
        time_slot: '14:00-15:00',
        material_confirmations: [
          { material_id: testMaterial1.id, is_confirmed: true }
        ]
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('号源已满');
  });
});

describe('预约改期流程集成测试', () => {
  let testItem;
  let testMaterial;
  let testWindow1;
  let testWindow2;
  const oldDate = getFutureDate(7);
  const newDate = getFutureDate(10);
  const userPhone = '13811112222';
  const userName = '改期测试用户';

  beforeAll(async () => {
    const itemResult = db.prepare(
      'INSERT INTO items (name, description, default_max_count, allow_same_day) VALUES (?, ?, ?, ?)'
    ).run('改期测试事项', '用于改期测试的事项', 10, 1);
    testItem = { id: itemResult.lastInsertRowid };

    const matResult = db.prepare(
      'INSERT INTO item_materials (item_id, name, description, is_required, require_confirmation, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(testItem.id, '改期材料', '测试改期用材料', 1, 1, 1);
    testMaterial = { id: matResult.lastInsertRowid };

    const w1Result = db.prepare(
      "INSERT INTO windows (name, description, status, sort_order) VALUES (?, ?, 'active', ?)"
    ).run('改期窗口1', '改期测试窗口1', 1);
    testWindow1 = { id: w1Result.lastInsertRowid };

    const w2Result = db.prepare(
      "INSERT INTO windows (name, description, status, sort_order) VALUES (?, ?, 'active', ?)"
    ).run('改期窗口2', '改期测试窗口2', 2);
    testWindow2 = { id: w2Result.lastInsertRowid };

    db.prepare(
      'INSERT INTO item_windows (item_id, window_id, default_capacity) VALUES (?, ?, ?)'
    ).run(testItem.id, testWindow1.id, 5);
    db.prepare(
      'INSERT INTO item_windows (item_id, window_id, default_capacity) VALUES (?, ?, ?)'
    ).run(testItem.id, testWindow2.id, 5);

    db.prepare(
      `INSERT INTO time_slot_capacities (item_id, date, start_time, end_time, max_count, current_count, sort_order, source_type)
       VALUES (?, ?, '09:00', '10:00', 5, 0, 1, 'manual')`
    ).run(testItem.id, oldDate);
    db.prepare(
      `INSERT INTO time_slot_capacities (item_id, date, start_time, end_time, max_count, current_count, sort_order, source_type)
       VALUES (?, ?, '14:00', '15:00', 5, 0, 2, 'manual')`
    ).run(testItem.id, oldDate);

    db.prepare(
      `INSERT INTO time_slot_capacities (item_id, date, start_time, end_time, max_count, current_count, sort_order, source_type)
       VALUES (?, ?, '10:00', '11:00', 5, 0, 1, 'manual')`
    ).run(testItem.id, newDate);
    db.prepare(
      `INSERT INTO time_slot_capacities (item_id, date, start_time, end_time, max_count, current_count, sort_order, source_type)
       VALUES (?, ?, '15:00', '16:00', 5, 0, 2, 'manual')`
    ).run(testItem.id, newDate);
  });

  test('成功改期 - 旧号源释放，新号源占用', async () => {
    const createResponse = await request(app)
      .post('/api/appointments')
      .send({
        item_id: testItem.id,
        user_name: userName,
        phone: userPhone,
        appointment_date: oldDate,
        time_slot: '09:00-10:00',
        material_confirmations: [
          { material_id: testMaterial.id, is_confirmed: true }
        ]
      });

    const appointmentId = createResponse.body.id;
    const oldWindowId = createResponse.body.window_id;

    const oldTimeSlotBefore = db.prepare(
      'SELECT current_count FROM time_slot_capacities WHERE item_id = ? AND date = ? AND start_time = ? AND end_time = ?'
    ).get(testItem.id, oldDate, '09:00', '10:00');
    const oldWindowSlotBefore = db.prepare(
      'SELECT current_count FROM window_slots WHERE window_id = ? AND item_id = ? AND date = ?'
    ).get(oldWindowId, testItem.id, oldDate);

    const newTimeSlotBefore = db.prepare(
      'SELECT current_count FROM time_slot_capacities WHERE item_id = ? AND date = ? AND start_time = ? AND end_time = ?'
    ).get(testItem.id, newDate, '10:00', '11:00');

    const rescheduleResponse = await request(app)
      .post(`/api/appointments/${appointmentId}/reschedule`)
      .send({
        phone: userPhone,
        new_date: newDate,
        new_time_slot: '10:00-11:00',
        reason: '个人时间调整'
      });

    expect(rescheduleResponse.status).toBe(200);
    expect(rescheduleResponse.body.success).toBe(true);
    expect(rescheduleResponse.body.message).toBe('改期成功');
    expect(rescheduleResponse.body.appointment.appointment_date).toBe(newDate);
    expect(rescheduleResponse.body.appointment.time_slot).toBe('10:00-11:00');

    const oldTimeSlotAfter = db.prepare(
      'SELECT current_count FROM time_slot_capacities WHERE item_id = ? AND date = ? AND start_time = ? AND end_time = ?'
    ).get(testItem.id, oldDate, '09:00', '10:00');
    expect(oldTimeSlotAfter.current_count).toBe(oldTimeSlotBefore.current_count - 1);

    const oldWindowSlotAfter = db.prepare(
      'SELECT current_count FROM window_slots WHERE window_id = ? AND item_id = ? AND date = ?'
    ).get(oldWindowId, testItem.id, oldDate);
    expect(oldWindowSlotAfter.current_count).toBe(oldWindowSlotBefore.current_count - 1);

    const newTimeSlotAfter = db.prepare(
      'SELECT current_count FROM time_slot_capacities WHERE item_id = ? AND date = ? AND start_time = ? AND end_time = ?'
    ).get(testItem.id, newDate, '10:00', '11:00');
    expect(newTimeSlotAfter.current_count).toBe(newTimeSlotBefore.current_count + 1);

    const newWindowId = rescheduleResponse.body.appointment.window_id;
    expect(newWindowId).toBeDefined();
    const newWindowSlotAfter = db.prepare(
      'SELECT current_count FROM window_slots WHERE window_id = ? AND item_id = ? AND date = ?'
    ).get(newWindowId, testItem.id, newDate);
    expect(newWindowSlotAfter.current_count).toBeGreaterThanOrEqual(1);
  });

  test('改期记录生成 - 改期后正确记录改期历史', async () => {
    const createResponse = await request(app)
      .post('/api/appointments')
      .send({
        item_id: testItem.id,
        user_name: '改期记录用户',
        phone: '13822223333',
        appointment_date: oldDate,
        time_slot: '14:00-15:00',
        material_confirmations: [
          { material_id: testMaterial.id, is_confirmed: true }
        ]
      });

    const appointmentId = createResponse.body.id;

    await request(app)
      .post(`/api/appointments/${appointmentId}/reschedule`)
      .send({
        phone: '13822223333',
        new_date: newDate,
        new_time_slot: '15:00-16:00',
        reason: '测试改期记录'
      });

    const response = await request(app)
      .get(`/api/appointments/${appointmentId}/reschedules`)
      .query({ phone: '13822223333' });

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBeGreaterThanOrEqual(1);

    const rescheduleRecord = response.body[0];
    expect(rescheduleRecord.appointment_id).toBe(appointmentId);
    expect(rescheduleRecord.old_date).toBe(oldDate);
    expect(rescheduleRecord.old_time_slot).toBe('14:00-15:00');
    expect(rescheduleRecord.new_date).toBe(newDate);
    expect(rescheduleRecord.new_time_slot).toBe('15:00-16:00');
    expect(rescheduleRecord.operator_type).toBe('user');
    expect(rescheduleRecord.reason).toBe('测试改期记录');
  });

  test('手机号不匹配时拒绝改期', async () => {
    const createResponse = await request(app)
      .post('/api/appointments')
      .send({
        item_id: testItem.id,
        user_name: '权限测试用户',
        phone: '13833334444',
        appointment_date: oldDate,
        time_slot: '09:00-10:00',
        material_confirmations: [
          { material_id: testMaterial.id, is_confirmed: true }
        ]
      });

    const appointmentId = createResponse.body.id;

    const response = await request(app)
      .post(`/api/appointments/${appointmentId}/reschedule`)
      .send({
        phone: '13900001111',
        new_date: newDate,
        new_time_slot: '10:00-11:00'
      });

    expect(response.status).toBe(403);
    expect(response.body.error).toContain('手机号不匹配');
  });

  test('新时段号源已满时拒绝改期', async () => {
    const fullDate = getFutureDate(15);
    db.prepare(
      `INSERT INTO time_slot_capacities (item_id, date, start_time, end_time, max_count, current_count, sort_order, source_type)
       VALUES (?, ?, '09:00', '10:00', 1, 1, 1, 'manual')`
    ).run(testItem.id, fullDate);

    const createResponse = await request(app)
      .post('/api/appointments')
      .send({
        item_id: testItem.id,
        user_name: '满额改期用户',
        phone: '13844445555',
        appointment_date: oldDate,
        time_slot: '14:00-15:00',
        material_confirmations: [
          { material_id: testMaterial.id, is_confirmed: true }
        ]
      });

    const appointmentId = createResponse.body.id;

    const response = await request(app)
      .post(`/api/appointments/${appointmentId}/reschedule`)
      .send({
        phone: '13844445555',
        new_date: fullDate,
        new_time_slot: '09:00-10:00'
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('号源已满');
  });

  test('同时段同日期无需改期', async () => {
    const createResponse = await request(app)
      .post('/api/appointments')
      .send({
        item_id: testItem.id,
        user_name: '同时段用户',
        phone: '13855556666',
        appointment_date: oldDate,
        time_slot: '09:00-10:00',
        material_confirmations: [
          { material_id: testMaterial.id, is_confirmed: true }
        ]
      });

    const appointmentId = createResponse.body.id;

    const response = await request(app)
      .post(`/api/appointments/${appointmentId}/reschedule`)
      .send({
        phone: '13855556666',
        new_date: oldDate,
        new_time_slot: '09:00-10:00'
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('无需改期');
  });
});
