require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');

const DEFAULT_DB_PATH = 'appointment.db';

function getDbPath(customPath) {
  if (customPath) return customPath;
  if (process.env.DB_PATH) return process.env.DB_PATH;
  return DEFAULT_DB_PATH;
}

function createTables(db) {
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
      scheduled_time DATETIME,
      sent_at DATETIME,
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

    CREATE TABLE IF NOT EXISTS system_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      setting_key TEXT NOT NULL UNIQUE,
      setting_value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS appointment_material_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      appointment_id INTEGER NOT NULL,
      material_id INTEGER,
      material_name TEXT NOT NULL,
      material_description TEXT,
      is_required INTEGER NOT NULL DEFAULT 0,
      require_confirmation INTEGER NOT NULL DEFAULT 0,
      is_confirmed INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS weekly_daily_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      weekday INTEGER NOT NULL,
      max_count INTEGER NOT NULL DEFAULT 20,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
      UNIQUE(item_id, weekday)
    );

    CREATE TABLE IF NOT EXISTS weekly_time_slot_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      weekday INTEGER NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      max_count INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS weekly_window_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      window_id INTEGER NOT NULL,
      weekday INTEGER NOT NULL,
      max_count INTEGER NOT NULL DEFAULT 10,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
      FOREIGN KEY (window_id) REFERENCES windows(id) ON DELETE CASCADE,
      UNIQUE(item_id, window_id, weekday)
    );
  `);
}

function createIndexes(db) {
  db.exec(`
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
    CREATE INDEX IF NOT EXISTS idx_reschedules_appointment ON appointment_reschedules(appointment_id);
    CREATE INDEX IF NOT EXISTS idx_reschedules_item ON appointment_reschedules(item_id);
    CREATE INDEX IF NOT EXISTS idx_reschedules_created ON appointment_reschedules(created_at);
    CREATE INDEX IF NOT EXISTS idx_time_slots_item_date ON time_slot_capacities(item_id, date);
    CREATE INDEX IF NOT EXISTS idx_settings_key ON system_settings(setting_key);
    CREATE INDEX IF NOT EXISTS idx_snapshots_appointment ON appointment_material_snapshots(appointment_id);
    CREATE INDEX IF NOT EXISTS idx_weekly_ts_item_weekday ON weekly_time_slot_templates(item_id, weekday);
    CREATE INDEX IF NOT EXISTS idx_weekly_windows_item_weekday ON weekly_window_templates(item_id, weekday);
    CREATE INDEX IF NOT EXISTS idx_reminders_scheduled ON appointment_reminders(scheduled_time);
    CREATE INDEX IF NOT EXISTS idx_reminders_status ON appointment_reminders(send_status);
  `);
}

function columnExists(db, table, column) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  return columns.some(c => c.name === column);
}

function runMigrations(db) {
  if (!columnExists(db, 'items', 'default_max_count')) {
    db.exec('ALTER TABLE items ADD COLUMN default_max_count INTEGER NOT NULL DEFAULT 20');
  }

  if (!columnExists(db, 'appointments', 'queue_number')) {
    db.exec('ALTER TABLE appointments ADD COLUMN queue_number INTEGER');
  }
  if (!columnExists(db, 'appointments', 'called_at')) {
    db.exec('ALTER TABLE appointments ADD COLUMN called_at DATETIME');
  }
  if (!columnExists(db, 'appointments', 'window_id')) {
    db.exec('ALTER TABLE appointments ADD COLUMN window_id INTEGER');
  }
  if (!columnExists(db, 'appointments', 'source')) {
    db.exec("ALTER TABLE appointments ADD COLUMN source TEXT NOT NULL DEFAULT 'user'");
  }
  if (!columnExists(db, 'appointments', 'operator_name')) {
    db.exec('ALTER TABLE appointments ADD COLUMN operator_name TEXT');
  }
  if (!columnExists(db, 'appointments', 'no_show_at')) {
    db.exec('ALTER TABLE appointments ADD COLUMN no_show_at DATETIME');
  }

  if (!columnExists(db, 'items', 'advance_weeks')) {
    db.exec('ALTER TABLE items ADD COLUMN advance_weeks INTEGER');
  }
  if (!columnExists(db, 'items', 'allow_same_day')) {
    db.exec('ALTER TABLE items ADD COLUMN allow_same_day INTEGER');
  }
  if (!columnExists(db, 'items', 'cancel_deadline_hours')) {
    db.exec('ALTER TABLE items ADD COLUMN cancel_deadline_hours INTEGER');
  }
  if (!columnExists(db, 'items', 'reschedule_deadline_hours')) {
    db.exec('ALTER TABLE items ADD COLUMN reschedule_deadline_hours INTEGER');
  }
  if (!columnExists(db, 'items', 'max_active_appointments')) {
    db.exec('ALTER TABLE items ADD COLUMN max_active_appointments INTEGER');
  }

  if (!columnExists(db, 'phone_restrictions', 'is_auto')) {
    db.exec("ALTER TABLE phone_restrictions ADD COLUMN is_auto INTEGER NOT NULL DEFAULT 0");
  }
  if (!columnExists(db, 'phone_restrictions', 'no_show_count')) {
    db.exec('ALTER TABLE phone_restrictions ADD COLUMN no_show_count INTEGER');
  }
  if (!columnExists(db, 'phone_restrictions', 'restriction_type')) {
    db.exec("ALTER TABLE phone_restrictions ADD COLUMN restriction_type TEXT NOT NULL DEFAULT 'manual'");
  }

  if (!columnExists(db, 'item_materials', 'is_required')) {
    db.exec('ALTER TABLE item_materials ADD COLUMN is_required INTEGER NOT NULL DEFAULT 0');
  }
  if (!columnExists(db, 'item_materials', 'require_confirmation')) {
    db.exec('ALTER TABLE item_materials ADD COLUMN require_confirmation INTEGER NOT NULL DEFAULT 0');
  }

  if (!columnExists(db, 'daily_slots', 'source_type')) {
    db.exec("ALTER TABLE daily_slots ADD COLUMN source_type TEXT NOT NULL DEFAULT 'manual'");
  }

  if (!columnExists(db, 'time_slot_capacities', 'source_type')) {
    db.exec("ALTER TABLE time_slot_capacities ADD COLUMN source_type TEXT NOT NULL DEFAULT 'manual'");
  }

  if (!columnExists(db, 'window_slots', 'source_type')) {
    db.exec("ALTER TABLE window_slots ADD COLUMN source_type TEXT NOT NULL DEFAULT 'manual'");
  }

  if (!columnExists(db, 'appointment_reminders', 'scheduled_time')) {
    db.exec('ALTER TABLE appointment_reminders ADD COLUMN scheduled_time DATETIME');
  }
  if (!columnExists(db, 'appointment_reminders', 'sent_at')) {
    db.exec('ALTER TABLE appointment_reminders ADD COLUMN sent_at DATETIME');
  }
}

function initSystemSettings(db) {
  const getSetting = db.prepare('SELECT setting_value FROM system_settings WHERE setting_key = ?');
  const setSetting = db.prepare(`
    INSERT INTO system_settings (setting_key, setting_value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(setting_key) DO UPDATE SET
      setting_value = excluded.setting_value,
      updated_at = CURRENT_TIMESTAMP
  `);

  const settings = [
    { key: 'no_show_threshold', value: '3' },
    { key: 'no_show_restriction_days', value: '30' },
    { key: 'no_show_window_days', value: '30' }
  ];

  for (const s of settings) {
    const existing = getSetting.get(s.key);
    if (!existing) {
      setSetting.run(s.key, s.value);
    }
  }
}

function initDefaultData(db) {
  const itemCount = db.prepare('SELECT COUNT(*) as cnt FROM items').get().cnt;
  if (itemCount === 0) {
    const insertItem = db.prepare('INSERT INTO items (name, description, default_max_count) VALUES (?, ?, ?)');
    insertItem.run('身份证办理', '首次申领、换领、补领居民身份证', 30);
    insertItem.run('社保业务', '社保查询、缴费、转移等业务', 25);
    insertItem.run('居住证办理', '居住证申领、签注、变更', 20);
    insertItem.run('民政业务', '低保、特困、临时救助等申请', 15);
  }

  const windowCount = db.prepare('SELECT COUNT(*) as cnt FROM windows').get().cnt;
  if (windowCount === 0) {
    const insertWindow = db.prepare('INSERT INTO windows (name, description, status, sort_order) VALUES (?, ?, ?, ?)');
    insertWindow.run('1号窗口', '综合业务窗口', 'active', 1);
    insertWindow.run('2号窗口', '综合业务窗口', 'active', 2);
    insertWindow.run('3号窗口', '社保专窗', 'active', 3);
    insertWindow.run('4号窗口', '户政专窗', 'active', 4);
    insertWindow.run('5号窗口', '民政专窗', 'active', 5);
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
  }

  const holidayCount = db.prepare('SELECT COUNT(*) as cnt FROM holidays').get().cnt;
  if (holidayCount === 0) {
    const insertHoliday = db.prepare('INSERT INTO holidays (date, name) VALUES (?, ?)');
    const year = new Date().getFullYear();
    insertHoliday.run(`${year}-10-01`, '国庆节');
    insertHoliday.run(`${year}-05-01`, '劳动节');
    insertHoliday.run(`${year}-01-01`, '元旦');
  }
}

function initDatabase(options = {}) {
  const dbPath = getDbPath(options.dbPath);
  const db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  createTables(db);
  createIndexes(db);
  runMigrations(db);
  initSystemSettings(db);

  if (options.seed !== false) {
    initDefaultData(db);
  }

  if (options.resetReminders !== false) {
    db.prepare("UPDATE appointment_reminders SET send_status = 'simulated' WHERE send_status = 'sent'").run();
  }

  return db;
}

function getSystemSetting(db, key, defaultValue = null) {
  const row = db.prepare('SELECT setting_value FROM system_settings WHERE setting_key = ?').get(key);
  return row ? row.setting_value : defaultValue;
}

function setSystemSetting(db, key, value) {
  db.prepare(`
    INSERT INTO system_settings (setting_key, setting_value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(setting_key) DO UPDATE SET
      setting_value = excluded.setting_value,
      updated_at = CURRENT_TIMESTAMP
  `).run(key, value);
}

module.exports = {
  initDatabase,
  getSystemSetting,
  setSystemSetting,
  getDbPath,
  DEFAULT_DB_PATH
};
