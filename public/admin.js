const state = {
    currentTab: 'dashboard',
    items: [],
    appointments: [],
    holidays: [],
    reminders: [],
    reminderPage: 1,
    reminderTotal: 0,
    reminderPageSize: 20,
    editingItemId: null,
    editingMaterials: [],
    slotModalData: null,
    confirmCallback: null
};

const API_BASE = '/api';

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.remove();
    }, 3000);
}

function showConfirm(title, message, callback) {
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message;
    state.confirmCallback = callback;
    document.getElementById('confirmModal').classList.add('show');
}

function formatDate(date) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getStatusText(status) {
    const map = {
        pending: '待办理',
        arrived: '已到场',
        completed: '已办理',
        cancelled: '已取消'
    };
    return map[status] || status;
}

function getStatusClass(status) {
    return `status-${status}`;
}

function getReminderTypeText(type) {
    const map = {
        created: '预约创建',
        cancelled: '预约取消',
        arrived: '已到场',
        completed: '办理完成'
    };
    return map[type] || type;
}

function getReminderTypeClass(type) {
    const map = {
        created: 'status-pending',
        cancelled: 'status-cancelled',
        arrived: 'status-arrived',
        completed: 'status-completed'
    };
    return map[type] || '';
}

function getSendStatusText(status) {
    const map = {
        sent: '已发送',
        failed: '发送失败',
        pending: '待发送',
        simulated: '模拟发送'
    };
    return map[status] || status;
}

function getSendStatusClass(status) {
    const map = {
        sent: 'status-completed',
        failed: 'status-cancelled',
        pending: 'status-pending',
        simulated: 'status-arrived'
    };
    return map[status] || '';
}

function initNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const tab = item.dataset.tab;
            switchTab(tab);
        });
    });
}

function switchTab(tab) {
    state.currentTab = tab;

    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.tab === tab);
    });

    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(`tab-${tab}`).classList.add('active');

    const titles = {
        dashboard: '数据概览',
        appointments: '预约管理',
        items: '事项管理',
        holidays: '节假日管理',
        reminders: '提醒记录'
    };
    document.getElementById('pageTitle').textContent = titles[tab];

    if (tab === 'dashboard') {
        loadDashboard();
    } else if (tab === 'appointments') {
        loadAppointments();
    } else if (tab === 'items') {
        loadItems();
    } else if (tab === 'holidays') {
        loadHolidays();
    } else if (tab === 'reminders') {
        loadReminders();
    }
}

async function loadDashboard() {
    try {
        const res = await fetch(`${API_BASE}/stats`);
        const data = await res.json();

        document.getElementById('statTotal').textContent = data.total_today;
        document.getElementById('statPending').textContent = data.pending_today;
        document.getElementById('statCompleted').textContent = data.completed_today;
        document.getElementById('statArrived').textContent = data.arrived_today;

        loadTodayAppointments();
    } catch (e) {
        showToast('加载数据失败', 'error');
    }
}

async function loadTodayAppointments() {
    const today = formatDate(new Date());
    try {
        const res = await fetch(`${API_BASE}/appointments?date=${today}`);
        const appointments = await res.json();
        renderTodayAppointments(appointments);
    } catch (e) {
        document.getElementById('todayAppointments').innerHTML = '<tr><td colspan="6" class="loading">加载失败</td></tr>';
    }
}

function renderTodayAppointments(appointments) {
    const tbody = document.getElementById('todayAppointments');

    if (appointments.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="empty-state">
                    <div class="empty-icon">📅</div>
                    <p>今日暂无预约</p>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = appointments.map(apt => `
        <tr>
            <td>${apt.time_slot}</td>
            <td>${apt.item_name}</td>
            <td>${apt.user_name}</td>
            <td>${apt.phone}</td>
            <td><span class="status-badge ${getStatusClass(apt.status)}">${getStatusText(apt.status)}</span></td>
            <td>
                <div class="action-buttons">
                    ${apt.status === 'pending' ? `<button class="btn btn-sm btn-primary" onclick="markArrived(${apt.id})">已到场</button>` : ''}
                    ${apt.status === 'arrived' ? `<button class="btn btn-sm btn-primary" onclick="markCompleted(${apt.id})">已办理</button>` : ''}
                    ${apt.status !== 'cancelled' && apt.status !== 'completed' ? `<button class="btn btn-sm btn-secondary" onclick="markCancelled(${apt.id})">取消</button>` : ''}
                </div>
            </td>
        </tr>
    `).join('');
}

async function loadAppointments() {
    await loadItemSelect();
    await searchAppointments();
}

async function loadItemSelect() {
    try {
        const res = await fetch(`${API_BASE}/items`);
        state.items = await res.json();

        const select = document.getElementById('filterItem');
        select.innerHTML = '<option value="">全部事项</option>' +
            state.items.map(item => `<option value="${item.id}">${item.name}</option>`).join('');
    } catch (e) {
        console.error('加载事项失败', e);
    }
}

async function searchAppointments() {
    const date = document.getElementById('filterDate').value;
    const itemId = document.getElementById('filterItem').value;
    const status = document.getElementById('filterStatus').value;
    const phone = document.getElementById('filterPhone').value.trim();

    let url = `${API_BASE}/appointments?`;
    const params = [];
    if (date) params.push(`date=${date}`);
    if (itemId) params.push(`item_id=${itemId}`);
    if (status) params.push(`status=${status}`);
    if (phone) params.push(`phone=${phone}`);
    url += params.join('&');

    try {
        const res = await fetch(url);
        state.appointments = await res.json();
        renderAppointments(state.appointments);
    } catch (e) {
        document.getElementById('appointmentList').innerHTML = '<tr><td colspan="8" class="loading">加载失败</td></tr>';
    }
}

function renderAppointments(appointments) {
    const tbody = document.getElementById('appointmentList');

    if (appointments.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="empty-state">
                    <div class="empty-icon">🔍</div>
                    <p>暂无符合条件的预约记录</p>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = appointments.map(apt => `
        <tr>
            <td>${apt.appointment_date}</td>
            <td>${apt.time_slot}</td>
            <td>${apt.item_name}</td>
            <td>${apt.user_name}</td>
            <td>${apt.phone}</td>
            <td><span class="status-badge ${getStatusClass(apt.status)}">${getStatusText(apt.status)}</span></td>
            <td>${apt.created_at ? apt.created_at.substring(0, 16) : '-'}</td>
            <td>
                <div class="action-buttons">
                    ${apt.status === 'pending' ? `<button class="btn btn-sm btn-primary" onclick="markArrived(${apt.id})">已到场</button>` : ''}
                    ${apt.status === 'arrived' ? `<button class="btn btn-sm btn-primary" onclick="markCompleted(${apt.id})">已办理</button>` : ''}
                    ${apt.status === 'pending' || apt.status === 'arrived' ? `<button class="btn btn-sm btn-secondary" onclick="markCancelled(${apt.id})">取消</button>` : ''}
                    ${apt.status === 'cancelled' ? `<button class="btn btn-sm btn-secondary" onclick="markPending(${apt.id})">恢复</button>` : ''}
                </div>
            </td>
        </tr>
    `).join('');
}

async function updateStatus(id, status) {
    try {
        const res = await fetch(`${API_BASE}/appointments/${id}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
        });

        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || '操作失败');
        }

        showToast('操作成功', 'success');
        
        if (state.currentTab === 'dashboard') {
            loadDashboard();
        } else if (state.currentTab === 'appointments') {
            searchAppointments();
        }
    } catch (e) {
        showToast(e.message, 'error');
    }
}

function markArrived(id) {
    showConfirm('确认到场', '确定将此预约标记为已到场？', () => {
        updateStatus(id, 'arrived');
    });
}

function markCompleted(id) {
    showConfirm('确认办理完成', '确定将此预约标记为已办理？', () => {
        updateStatus(id, 'completed');
    });
}

function markCancelled(id) {
    showConfirm('确认取消', '确定取消此预约？取消后号源将释放。', () => {
        updateStatus(id, 'cancelled');
    });
}

function markPending(id) {
    showConfirm('确认恢复', '确定恢复此预约？', () => {
        updateStatus(id, 'pending');
    });
}

async function loadItems() {
    try {
        const res = await fetch(`${API_BASE}/items`);
        state.items = await res.json();
        renderItems();
    } catch (e) {
        document.getElementById('itemList').innerHTML = '<tr><td colspan="5" class="loading">加载失败</td></tr>';
    }
}

function renderItems() {
    const tbody = document.getElementById('itemList');

    if (state.items.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="empty-state">
                    <div class="empty-icon">📋</div>
                    <p>暂无事项，请点击右上角新增</p>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = state.items.map((item, index) => `
        <tr>
            <td>${index + 1}</td>
            <td><strong>${item.name}</strong></td>
            <td>${item.description || '-'}</td>
            <td><span class="status-badge status-pending">${item.default_max_count || 20} 个</span></td>
            <td>${item.created_at ? item.created_at.substring(0, 10) : '-'}</td>
            <td>
                <div class="action-buttons">
                    <button class="btn btn-link btn-slot-setting" data-item-id="${item.id}">号源设置</button>
                    <button class="btn btn-link" onclick="editItem(${item.id})">编辑</button>
                    <button class="btn btn-link danger" onclick="deleteItem(${item.id})">删除</button>
                </div>
            </td>
        </tr>
    `).join('');

    tbody.querySelectorAll('.btn-slot-setting').forEach(button => {
        button.addEventListener('click', () => {
            const itemId = parseInt(button.dataset.itemId, 10);
            const item = state.items.find(i => i.id === itemId);
            if (item) {
                openSlotModal(item.id, item.name);
            }
        });
    });
}

function openAddItemModal() {
    state.editingItemId = null;
    state.editingMaterials = [];
    document.getElementById('itemModalTitle').textContent = '新增事项';
    document.getElementById('itemName').value = '';
    document.getElementById('itemDesc').value = '';
    document.getElementById('itemMaxCount').value = 20;
    renderMaterialsList();
    document.getElementById('itemModal').classList.add('show');
}

async function editItem(id) {
    const item = state.items.find(i => i.id === id);
    if (!item) return;

    state.editingItemId = id;
    document.getElementById('itemModalTitle').textContent = '编辑事项';
    document.getElementById('itemName').value = item.name;
    document.getElementById('itemDesc').value = item.description || '';
    document.getElementById('itemMaxCount').value = item.default_max_count || 20;

    try {
        const res = await fetch(`${API_BASE}/items/${id}/materials`);
        state.editingMaterials = await res.json();
    } catch (e) {
        state.editingMaterials = [];
        console.error('加载材料清单失败', e);
    }

    renderMaterialsList();
    document.getElementById('itemModal').classList.add('show');
}

async function saveItem() {
    const name = document.getElementById('itemName').value.trim();
    const description = document.getElementById('itemDesc').value.trim();
    const defaultMaxCount = document.getElementById('itemMaxCount').value;

    if (!name) {
        showToast('请输入事项名称', 'error');
        return;
    }

    const validMaterials = state.editingMaterials.filter(m => m.name && m.name.trim());
    if (validMaterials.length !== state.editingMaterials.length) {
        showToast('请填写所有材料名称或删除空行', 'error');
        return;
    }

    try {
        let res;
        let itemData;
        if (state.editingItemId) {
            res = await fetch(`${API_BASE}/items/${state.editingItemId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, description, default_max_count: defaultMaxCount })
            });
        } else {
            res = await fetch(`${API_BASE}/items`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, description, default_max_count: defaultMaxCount })
            });
        }

        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || '保存失败');
        }
        itemData = data;

        if (state.editingMaterials.length > 0 || state.editingItemId) {
            const itemId = state.editingItemId || itemData.id;
            const matRes = await fetch(`${API_BASE}/items/${itemId}/materials/batch`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ materials: state.editingMaterials })
            });
            const matData = await matRes.json();
            if (!matRes.ok) {
                throw new Error(matData.error || '材料清单保存失败');
            }
        }

        showToast('保存成功', 'success');
        document.getElementById('itemModal').classList.remove('show');
        loadItems();
    } catch (e) {
        showToast(e.message, 'error');
    }
}

function renderMaterialsList() {
    const container = document.getElementById('materialsList');

    if (state.editingMaterials.length === 0) {
        container.innerHTML = `
            <div class="empty-state-sm">
                <span>暂无材料，点击上方按钮添加</span>
            </div>
        `;
        return;
    }

    container.innerHTML = state.editingMaterials.map((mat, index) => `
        <div class="material-item" data-index="${index}">
            <div class="material-sort">
                <button type="button" class="sort-btn" onclick="moveMaterial(${index}, -1)" ${index === 0 ? 'disabled' : ''}>↑</button>
                <button type="button" class="sort-btn" onclick="moveMaterial(${index}, 1)" ${index === state.editingMaterials.length - 1 ? 'disabled' : ''}>↓</button>
            </div>
            <div class="material-fields">
                <input type="text" class="material-name" placeholder="材料名称" value="${escapeHtml(mat.name || '')}" data-field="name">
                <input type="text" class="material-desc" placeholder="材料说明（选填）" value="${escapeHtml(mat.description || '')}" data-field="description">
            </div>
            <button type="button" class="material-delete" onclick="removeMaterial(${index})">×</button>
        </div>
    `).join('');

    container.querySelectorAll('.material-item').forEach(item => {
        const index = parseInt(item.dataset.index);
        item.querySelectorAll('input').forEach(input => {
            input.addEventListener('input', (e) => {
                const field = e.target.dataset.field;
                state.editingMaterials[index][field] = e.target.value;
            });
        });
    });
}

function addMaterial() {
    state.editingMaterials.push({ name: '', description: '' });
    renderMaterialsList();
}

function removeMaterial(index) {
    state.editingMaterials.splice(index, 1);
    renderMaterialsList();
}

function moveMaterial(index, direction) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= state.editingMaterials.length) return;
    const temp = state.editingMaterials[index];
    state.editingMaterials[index] = state.editingMaterials[newIndex];
    state.editingMaterials[newIndex] = temp;
    renderMaterialsList();
}

function deleteItem(id) {
    const item = state.items.find(i => i.id === id);
    showConfirm('确认删除', `确定删除事项"${item.name}"吗？相关预约记录也将被删除。`, async () => {
        try {
            const res = await fetch(`${API_BASE}/items/${id}`, {
                method: 'DELETE'
            });

            if (!res.ok) {
                throw new Error('删除失败');
            }

            showToast('删除成功', 'success');
            loadItems();
        } catch (e) {
            showToast(e.message, 'error');
        }
    });
}

async function loadHolidays() {
    try {
        const res = await fetch(`${API_BASE}/holidays`);
        state.holidays = await res.json();
        renderHolidays();
    } catch (e) {
        document.getElementById('holidayList').innerHTML = '<tr><td colspan="4" class="loading">加载失败</td></tr>';
    }
}

function renderHolidays() {
    const tbody = document.getElementById('holidayList');

    if (state.holidays.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" class="empty-state">
                    <div class="empty-icon">🎉</div>
                    <p>暂无节假日设置</p>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = state.holidays.map((holiday, index) => `
        <tr>
            <td>${index + 1}</td>
            <td>${holiday.date}</td>
            <td>${holiday.name || '-'}</td>
            <td>
                <button class="btn btn-link danger" onclick="deleteHoliday(${holiday.id})">删除</button>
            </td>
        </tr>
    `).join('');
}

function openAddHolidayModal() {
    document.getElementById('holidayDate').value = '';
    document.getElementById('holidayName').value = '';
    document.getElementById('holidayModal').classList.add('show');
}

async function saveHoliday() {
    const date = document.getElementById('holidayDate').value;
    const name = document.getElementById('holidayName').value.trim();

    if (!date) {
        showToast('请选择日期', 'error');
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/holidays`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date, name })
        });

        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || '保存失败');
        }

        showToast('保存成功', 'success');
        document.getElementById('holidayModal').classList.remove('show');
        loadHolidays();
    } catch (e) {
        showToast(e.message, 'error');
    }
}

function deleteHoliday(id) {
    showConfirm('确认删除', '确定删除此节假日吗？', async () => {
        try {
            const res = await fetch(`${API_BASE}/holidays/${id}`, {
                method: 'DELETE'
            });

            if (!res.ok) {
                throw new Error('删除失败');
            }

            showToast('删除成功', 'success');
            loadHolidays();
        } catch (e) {
            showToast(e.message, 'error');
        }
    });
}

let batchHolidayData = [];

function openBatchImportHolidayModal() {
    document.getElementById('batchHolidayInput').value = '';
    document.getElementById('batchHolidayPreview').style.display = 'none';
    document.getElementById('btnConfirmBatchHoliday').disabled = true;
    batchHolidayData = [];
    document.getElementById('batchImportHolidayModal').classList.add('show');
}

function isValidDate(dateStr) {
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    if (!regex.test(dateStr)) return false;
    const date = new Date(dateStr);
    return date instanceof Date && !isNaN(date) && dateStr === formatDate(date);
}

function parseBatchHolidayInput() {
    const text = document.getElementById('batchHolidayInput').value.trim();
    if (!text) {
        showToast('请输入节假日数据', 'error');
        return [];
    }

    const lines = text.split('\n').filter(line => line.trim());
    const results = [];
    const seenDates = new Set();
    const existingDates = new Set(state.holidays.map(h => h.date));

    lines.forEach((line, index) => {
        const trimmedLine = line.trim();
        const parts = trimmedLine.split(',');
        const date = parts[0]?.trim();
        const name = parts.slice(1).join(',').trim();

        const item = {
            line: index + 1,
            date: date || '',
            name: name || '',
            status: 'ok',
            message: ''
        };

        if (!date) {
            item.status = 'error';
            item.message = '日期不能为空';
        } else if (!isValidDate(date)) {
            item.status = 'error';
            item.message = '日期格式不正确，应为 YYYY-MM-DD';
        } else if (seenDates.has(date)) {
            item.status = 'warn';
            item.message = '输入内容中存在重复日期';
        } else if (existingDates.has(date)) {
            item.status = 'warn';
            item.message = '该日期已存在于节假日列表中';
        }

        if (item.status === 'ok') {
            seenDates.add(date);
        }

        results.push(item);
    });

    return results;
}

function previewBatchHoliday() {
    batchHolidayData = parseBatchHolidayInput();
    if (batchHolidayData.length === 0) return;

    const successCount = batchHolidayData.filter(i => i.status === 'ok').length;
    const errorCount = batchHolidayData.filter(i => i.status === 'error').length;
    const warnCount = batchHolidayData.filter(i => i.status === 'warn').length;

    const summaryEl = document.getElementById('batchHolidaySummary');
    summaryEl.innerHTML = `
        共 ${batchHolidayData.length} 条记录，
        <span class="success-count">正常 ${successCount} 条</span>，
        <span class="warn-count">警告 ${warnCount} 条</span>，
        <span class="error-count">错误 ${errorCount} 条</span>
    `;

    const tbody = document.getElementById('batchHolidayPreviewList');
    tbody.innerHTML = batchHolidayData.map(item => {
        let statusClass = '';
        let statusText = '';
        if (item.status === 'ok') {
            statusClass = 'status-ok';
            statusText = '✓ 可导入';
        } else if (item.status === 'warn') {
            statusClass = 'status-warn';
            statusText = `⚠ ${item.message}`;
        } else {
            statusClass = 'status-error';
            statusText = `✗ ${item.message}`;
        }
        return `
            <tr>
                <td>${item.line}</td>
                <td>${escapeHtml(item.date)}</td>
                <td>${escapeHtml(item.name) || '-'}</td>
                <td class="${statusClass}">${statusText}</td>
            </tr>
        `;
    }).join('');

    document.getElementById('batchHolidayPreview').style.display = 'block';
    document.getElementById('btnConfirmBatchHoliday').disabled = errorCount > 0;
}

async function confirmBatchHoliday() {
    const validItems = batchHolidayData.filter(i => i.status === 'ok' || i.status === 'warn');
    if (validItems.length === 0) {
        showToast('没有可导入的记录', 'error');
        return;
    }

    const importData = validItems.map(i => ({ date: i.date, name: i.name }));

    try {
        const res = await fetch(`${API_BASE}/holidays/batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ holidays: importData })
        });

        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || '批量导入失败');
        }

        showToast(`成功导入 ${data.imported} 条节假日`, 'success');
        document.getElementById('batchImportHolidayModal').classList.remove('show');
        loadHolidays();
    } catch (e) {
        showToast(e.message, 'error');
    }
}

async function loadReminders() {
    await searchReminders();
}

async function searchReminders() {
    const phone = document.getElementById('filterReminderPhone').value.trim();
    const date = document.getElementById('filterReminderDate').value;
    const type = document.getElementById('filterReminderType').value;
    const sendStatus = document.getElementById('filterReminderStatus').value;

    let url = `${API_BASE}/reminders?page=${state.reminderPage}&page_size=${state.reminderPageSize}`;
    if (phone) url += `&phone=${encodeURIComponent(phone)}`;
    if (date) url += `&date=${date}`;
    if (type) url += `&type=${type}`;
    if (sendStatus) url += `&send_status=${sendStatus}`;

    try {
        const res = await fetch(url);
        const data = await res.json();
        state.reminders = data.list;
        state.reminderTotal = data.total;
        state.reminderPage = data.page;
        renderReminders();
        renderReminderPagination(data.total_pages);
    } catch (e) {
        document.getElementById('reminderList').innerHTML = '<tr><td colspan="8" class="loading">加载失败</td></tr>';
    }
}

function renderReminders() {
    const tbody = document.getElementById('reminderList');

    if (state.reminders.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="empty-state">
                    <div class="empty-icon">📱</div>
                    <p>暂无提醒记录</p>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = state.reminders.map(reminder => `
        <tr>
            <td>${reminder.id}</td>
            <td>${reminder.phone}</td>
            <td>${reminder.item_name || '-'}</td>
            <td>${reminder.appointment_date || '-'}</td>
            <td><span class="status-badge ${getReminderTypeClass(reminder.type)}">${getReminderTypeText(reminder.type)}</span></td>
            <td><span class="status-badge ${getSendStatusClass(reminder.send_status)}">${getSendStatusText(reminder.send_status)}</span></td>
            <td style="max-width:300px;white-space:normal;">${escapeHtml(reminder.content)}</td>
            <td>${reminder.created_at ? reminder.created_at.substring(0, 19) : '-'}</td>
        </tr>
    `).join('');
}

function renderReminderPagination(totalPages) {
    const container = document.getElementById('reminderPagination');

    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    let html = '<div class="pagination-info">共 ' + state.reminderTotal + ' 条记录</div>';
    html += '<div class="pagination-buttons">';

    if (state.reminderPage > 1) {
        html += `<button class="btn btn-sm btn-secondary" onclick="goToReminderPage(${state.reminderPage - 1})">上一页</button>`;
    }

    const startPage = Math.max(1, state.reminderPage - 2);
    const endPage = Math.min(totalPages, state.reminderPage + 2);

    for (let i = startPage; i <= endPage; i++) {
        const active = i === state.reminderPage ? 'active' : '';
        html += `<button class="btn btn-sm ${active ? 'btn-primary' : 'btn-secondary'}" onclick="goToReminderPage(${i})">${i}</button>`;
    }

    if (state.reminderPage < totalPages) {
        html += `<button class="btn btn-sm btn-secondary" onclick="goToReminderPage(${state.reminderPage + 1})">下一页</button>`;
    }

    html += '</div>';
    container.innerHTML = html;
}

function goToReminderPage(page) {
    state.reminderPage = page;
    searchReminders();
}

function resetReminderFilters() {
    document.getElementById('filterReminderPhone').value = '';
    document.getElementById('filterReminderDate').value = '';
    document.getElementById('filterReminderType').value = '';
    document.getElementById('filterReminderStatus').value = '';
    state.reminderPage = 1;
    searchReminders();
}

function openSlotModal(itemId, itemName) {
    const today = formatDate(new Date());
    state.slotModalData = { itemId, itemName, date: today };

    document.getElementById('slotInfo').innerHTML = `
        <p><strong>事项：</strong>${escapeHtml(itemName)}</p>
        <p><strong>日期：</strong><input type="date" id="slotDate" value="${today}" style="width:auto;padding:4px 8px;border:1px solid #d9d9d9;border-radius:4px;font-size:13px;"></p>
        <p><strong>当前号源：</strong><span id="slotCurrentCount">-</span> / <span id="slotCurrentMax">-</span></p>
    `;

    document.getElementById('slotMaxCount').value = '';
    document.getElementById('slotModal').classList.add('show');

    loadSlotInfo(itemId, today);

    document.getElementById('slotDate').addEventListener('change', (e) => {
        state.slotModalData.date = e.target.value;
        loadSlotInfo(itemId, e.target.value);
    });
}

async function loadSlotInfo(itemId, date) {
    try {
        const res = await fetch(`${API_BASE}/slots/${itemId}/${date}`);
        const data = await res.json();

        if (data.available !== undefined) {
            document.getElementById('slotCurrentCount').textContent = data.current_count || 0;
            document.getElementById('slotCurrentMax').textContent = data.max_count || 0;
            document.getElementById('slotMaxCount').value = data.max_count || 20;
        } else {
            document.getElementById('slotCurrentCount').textContent = '-';
            document.getElementById('slotCurrentMax').textContent = '不可预约';
        }
    } catch (e) {
        console.error('加载号源信息失败', e);
    }
}

async function saveSlot() {
    const { itemId, date } = state.slotModalData;
    const maxCount = document.getElementById('slotMaxCount').value;

    if (!maxCount || maxCount < 1) {
        showToast('请输入有效的号源数量', 'error');
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/slots/${itemId}/${date}/max`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ max_count: parseInt(maxCount) })
        });

        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || '保存失败');
        }

        showToast('保存成功', 'success');
        document.getElementById('slotModal').classList.remove('show');
        
        if (state.currentTab === 'items') {
            loadItems();
        }
    } catch (e) {
        showToast(e.message, 'error');
    }
}

function initModals() {
    document.getElementById('btnAddItem').addEventListener('click', openAddItemModal);
    document.getElementById('btnCancelItem').addEventListener('click', () => {
        document.getElementById('itemModal').classList.remove('show');
    });
    document.getElementById('btnSaveItem').addEventListener('click', saveItem);
    document.getElementById('btnAddMaterial').addEventListener('click', addMaterial);

    document.getElementById('btnAddHoliday').addEventListener('click', openAddHolidayModal);
    document.getElementById('btnCancelHoliday').addEventListener('click', () => {
        document.getElementById('holidayModal').classList.remove('show');
    });
    document.getElementById('btnSaveHoliday').addEventListener('click', saveHoliday);

    document.getElementById('btnBatchImportHoliday').addEventListener('click', openBatchImportHolidayModal);
    document.getElementById('btnCancelBatchHoliday').addEventListener('click', () => {
        document.getElementById('batchImportHolidayModal').classList.remove('show');
    });
    document.getElementById('btnPreviewBatchHoliday').addEventListener('click', previewBatchHoliday);
    document.getElementById('btnConfirmBatchHoliday').addEventListener('click', confirmBatchHoliday);

    document.getElementById('btnCancelSlot').addEventListener('click', () => {
        document.getElementById('slotModal').classList.remove('show');
    });
    document.getElementById('btnSaveSlot').addEventListener('click', saveSlot);

    document.getElementById('btnConfirmCancel').addEventListener('click', () => {
        document.getElementById('confirmModal').classList.remove('show');
    });
    document.getElementById('btnConfirmOk').addEventListener('click', () => {
        document.getElementById('confirmModal').classList.remove('show');
        if (state.confirmCallback) {
            state.confirmCallback();
            state.confirmCallback = null;
        }
    });

    document.getElementById('btnSearch').addEventListener('click', searchAppointments);
    document.getElementById('btnReset').addEventListener('click', () => {
        document.getElementById('filterDate').value = '';
        document.getElementById('filterItem').value = '';
        document.getElementById('filterStatus').value = '';
        document.getElementById('filterPhone').value = '';
        searchAppointments();
    });

    document.getElementById('btnSearchReminder').addEventListener('click', () => {
        state.reminderPage = 1;
        searchReminders();
    });
    document.getElementById('btnResetReminder').addEventListener('click', resetReminderFilters);

    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('show');
            }
        });
    });
}

function initTodayDate() {
    const today = new Date();
    const options = { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' };
    document.getElementById('todayDate').textContent = today.toLocaleDateString('zh-CN', options);
}

function init() {
    initTodayDate();
    initNavigation();
    initModals();
    loadDashboard();
}

window.markArrived = markArrived;
window.markCompleted = markCompleted;
window.markCancelled = markCancelled;
window.markPending = markPending;
window.editItem = editItem;
window.deleteItem = deleteItem;
window.deleteHoliday = deleteHoliday;
window.openSlotModal = openSlotModal;
window.addMaterial = addMaterial;
window.removeMaterial = removeMaterial;
window.moveMaterial = moveMaterial;
window.goToReminderPage = goToReminderPage;

document.addEventListener('DOMContentLoaded', init);
