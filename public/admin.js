const state = {
    currentTab: 'dashboard',
    items: [],
    appointments: [],
    holidays: [],
    reminders: [],
    reminderPage: 1,
    reminderTotal: 0,
    reminderPageSize: 20,
    reviews: [],
    reviewPage: 1,
    reviewTotal: 0,
    reviewPageSize: 20,
    restrictions: [],
    restrictionPage: 1,
    restrictionTotal: 0,
    restrictionPageSize: 20,
    editingRestrictionId: null,
    reschedules: [],
    reschedulePage: 1,
    rescheduleTotal: 0,
    reschedulePageSize: 20,
    editingItemId: null,
    editingMaterials: [],
    windows: [],
    editingWindowId: null,
    editingItemWindows: [],
    slotModalData: null,
    editingTimeSlots: [],
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
        calling: '叫号中',
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
        reminders: '提醒记录',
        reviews: '评价管理',
        reschedules: '改期记录',
        restrictions: '手机号限制',
        windows: '窗口管理'
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
    } else if (tab === 'reviews') {
        loadReviews();
    } else if (tab === 'reschedules') {
        loadReschedules();
    } else if (tab === 'restrictions') {
        loadRestrictions();
    } else if (tab === 'windows') {
        loadWindows();
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
        document.getElementById('statReview').textContent = data.review_today || 0;
        document.getElementById('statAvgRating').textContent = data.avg_rating_today || '0.0';

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
        document.getElementById('todayAppointments').innerHTML = '<tr><td colspan="8" class="loading">加载失败</td></tr>';
    }
}

function renderTodayAppointments(appointments) {
    const tbody = document.getElementById('todayAppointments');

    if (appointments.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="empty-state">
                    <div class="empty-icon">📅</div>
                    <p>今日暂无预约</p>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = appointments.map(apt => `
        <tr>
            <td>${apt.queue_number || '-'}</td>
            <td>${apt.time_slot}</td>
            <td>${apt.item_name}</td>
            <td>${apt.window_name || '-'}</td>
            <td>${apt.user_name}</td>
            <td>${apt.phone}</td>
            <td><span class="status-badge ${getStatusClass(apt.status)}">${getStatusText(apt.status)}</span></td>
            <td>
                <div class="action-buttons">
                    ${apt.status === 'pending' ? `<button class="btn btn-sm btn-primary" onclick="markArrived(${apt.id})">已到场</button>` : ''}
                    ${apt.status === 'arrived' ? `<button class="btn btn-sm btn-primary" onclick="callNumber(${apt.id})">叫号</button>` : ''}
                    ${apt.status === 'calling' ? `<button class="btn btn-sm btn-success" onclick="markCompleted(${apt.id})">完成</button>` : ''}
                    ${apt.status === 'calling' ? `<button class="btn btn-sm btn-secondary" onclick="nextNumber(${apt.id})">下一号</button>` : ''}
                    ${apt.status !== 'cancelled' && apt.status !== 'completed' && apt.status !== 'calling' ? `<button class="btn btn-sm btn-secondary" onclick="markCancelled(${apt.id})">取消</button>` : ''}
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
        document.getElementById('appointmentList').innerHTML = '<tr><td colspan="10" class="loading">加载失败</td></tr>';
    }
}

function renderAppointments(appointments) {
    const tbody = document.getElementById('appointmentList');

    if (appointments.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="10" class="empty-state">
                    <div class="empty-icon">🔍</div>
                    <p>暂无符合条件的预约记录</p>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = appointments.map(apt => `
        <tr>
            <td>${apt.id}</td>
            <td>${apt.appointment_date}</td>
            <td>${apt.time_slot}</td>
            <td>${apt.item_name}</td>
            <td>${apt.window_name || '-'}</td>
            <td>${apt.user_name}</td>
            <td>${apt.phone}</td>
            <td><span class="status-badge ${getStatusClass(apt.status)}">${getStatusText(apt.status)}</span></td>
            <td>${apt.created_at ? apt.created_at.substring(0, 16) : '-'}</td>
            <td>
                <div class="action-buttons">
                    ${apt.status === 'pending' ? `<button class="btn btn-sm btn-primary" onclick="markArrived(${apt.id})">已到场</button>` : ''}
                    ${apt.status === 'arrived' ? `<button class="btn btn-sm btn-primary" onclick="callNumber(${apt.id})">叫号</button>` : ''}
                    ${apt.status === 'calling' ? `<button class="btn btn-sm btn-success" onclick="markCompleted(${apt.id})">完成</button>` : ''}
                    ${apt.status === 'calling' ? `<button class="btn btn-sm btn-secondary" onclick="nextNumber(${apt.id})">下一号</button>` : ''}
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

async function callNumber(id) {
    try {
        const res = await fetch(`${API_BASE}/appointments/${id}/call`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || '叫号失败');
        }

        showToast('叫号成功', 'success');
        refreshCurrentView();
    } catch (e) {
        showToast(e.message, 'error');
    }
}

async function nextNumber(id) {
    showConfirm('下一号', '确定完成当前叫号并叫下一位？', async () => {
        try {
            const res = await fetch(`${API_BASE}/appointments/${id}/next`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ skip_current: false })
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || '操作失败');
            }

            showToast(data.message, 'success');
            refreshCurrentView();
        } catch (e) {
            showToast(e.message, 'error');
        }
    });
}

function refreshCurrentView() {
    if (state.currentTab === 'dashboard') {
        loadDashboard();
    } else if (state.currentTab === 'appointments') {
        searchAppointments();
    }
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
    state.editingItemWindows = [];
    document.getElementById('itemModalTitle').textContent = '新增事项';
    document.getElementById('itemName').value = '';
    document.getElementById('itemDesc').value = '';
    document.getElementById('itemMaxCount').value = 20;
    renderMaterialsList();
    renderWindowConfigList();
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

    try {
        const winRes = await fetch(`${API_BASE}/items/${id}/windows`);
        state.editingItemWindows = await winRes.json();
    } catch (e) {
        state.editingItemWindows = [];
        console.error('加载窗口配置失败', e);
    }

    if (state.windows.length === 0) {
        try {
            const allWinRes = await fetch(`${API_BASE}/windows`);
            state.windows = await allWinRes.json();
        } catch (e) {
            console.error('加载窗口列表失败', e);
        }
    }

    renderMaterialsList();
    renderWindowConfigList();
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

        const itemId = state.editingItemId || itemData.id;
        const winRes = await fetch(`${API_BASE}/items/${itemId}/windows`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ windows: state.editingItemWindows })
        });
        if (!winRes.ok) {
            const winData = await winRes.json();
            throw new Error(winData.error || '窗口配置保存失败');
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

function renderWindowConfigList() {
    const container = document.getElementById('windowConfigList');

    if (state.windows.length === 0) {
        container.innerHTML = `
            <div class="empty-state-sm">
                <span>暂无可用窗口，请先在窗口管理中添加</span>
            </div>
        `;
        return;
    }

    const activeWindows = state.windows.filter(w => w.status === 'active');
    if (activeWindows.length === 0) {
        container.innerHTML = `
            <div class="empty-state-sm">
                <span>暂无启用的窗口</span>
            </div>
        `;
        return;
    }

    container.innerHTML = activeWindows.map(win => {
        const itemWin = state.editingItemWindows.find(iw => iw.window_id === win.id);
        const isChecked = !!itemWin;
        const maxCount = itemWin ? (itemWin.default_capacity || '') : '';
        return `
            <div class="window-config-item" data-window-id="${win.id}">
                <label class="window-config-checkbox">
                    <input type="checkbox" ${isChecked ? 'checked' : ''} data-window-id="${win.id}">
                    <span class="window-name">${escapeHtml(win.name)}</span>
                </label>
                <div class="window-config-input">
                    <span>默认容量：</span>
                    <input type="number" class="window-max-count" value="${maxCount}" placeholder="20" min="1" data-window-id="${win.id}" ${!isChecked ? 'disabled' : ''}>
                </div>
            </div>
        `;
    }).join('');

    container.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const windowId = parseInt(e.target.dataset.windowId, 10);
            const isChecked = e.target.checked;
            const inputEl = container.querySelector(`.window-max-count[data-window-id="${windowId}"]`);

            if (isChecked) {
                const existing = state.editingItemWindows.find(iw => iw.window_id === windowId);
                if (!existing) {
                    state.editingItemWindows.push({ window_id: windowId, default_capacity: 20 });
                }
                inputEl.disabled = false;
                if (!inputEl.value) {
                    inputEl.value = 20;
                }
            } else {
                state.editingItemWindows = state.editingItemWindows.filter(iw => iw.window_id !== windowId);
                inputEl.disabled = true;
            }
        });
    });

    container.querySelectorAll('.window-max-count').forEach(input => {
        input.addEventListener('input', (e) => {
            const windowId = parseInt(e.target.dataset.windowId, 10);
            const itemWin = state.editingItemWindows.find(iw => iw.window_id === windowId);
            if (itemWin) {
                itemWin.default_capacity = parseInt(e.target.value, 10) || 0;
            }
        });
    });
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

async function loadReviews() {
    await loadReviewItemSelect();
    await searchReviews();
}

async function loadReviewItemSelect() {
    try {
        if (state.items.length === 0) {
            const res = await fetch(`${API_BASE}/items`);
            state.items = await res.json();
        }

        const select = document.getElementById('filterReviewItem');
        select.innerHTML = '<option value="">全部事项</option>' +
            state.items.map(item => `<option value="${item.id}">${item.name}</option>`).join('');
    } catch (e) {
        console.error('加载事项失败', e);
    }
}

async function searchReviews() {
    const date = document.getElementById('filterReviewDate').value;
    const itemId = document.getElementById('filterReviewItem').value;
    const rating = document.getElementById('filterReviewRating').value;
    const phone = document.getElementById('filterReviewPhone').value.trim();

    let url = `${API_BASE}/reviews?page=${state.reviewPage}&page_size=${state.reviewPageSize}`;
    if (date) url += `&date=${date}`;
    if (itemId) url += `&item_id=${itemId}`;
    if (rating) url += `&rating=${rating}`;
    if (phone) url += `&phone=${encodeURIComponent(phone)}`;

    try {
        const res = await fetch(url);
        const data = await res.json();
        state.reviews = data.list;
        state.reviewTotal = data.total;
        state.reviewPage = data.page;
        renderReviews();
        renderReviewPagination(data.total_pages);
    } catch (e) {
        document.getElementById('reviewList').innerHTML = '<tr><td colspan="9" class="loading">加载失败</td></tr>';
    }
}

function getRatingStars(rating) {
    return '★'.repeat(rating) + '☆'.repeat(5 - rating);
}

function getRatingClass(rating) {
    if (rating >= 4) return 'rating-high';
    if (rating >= 3) return 'rating-medium';
    return 'rating-low';
}

function renderReviews() {
    const tbody = document.getElementById('reviewList');

    if (state.reviews.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" class="empty-state">
                    <div class="empty-icon">⭐</div>
                    <p>暂无评价记录</p>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = state.reviews.map(review => `
        <tr>
            <td>${review.id}</td>
            <td>${review.appointment_id}</td>
            <td>${review.item_name || '-'}</td>
            <td>${review.user_name}</td>
            <td>${review.phone}</td>
            <td><span class="review-stars-inline ${getRatingClass(review.rating)}">${getRatingStars(review.rating)} ${review.rating}分</span></td>
            <td style="max-width:250px;white-space:normal;">${escapeHtml(review.feedback) || '<span style="color:#999;">无</span>'}</td>
            <td>${review.appointment_date || '-'}</td>
            <td>${review.created_at ? review.created_at.substring(0, 19) : '-'}</td>
        </tr>
    `).join('');
}

function renderReviewPagination(totalPages) {
    const container = document.getElementById('reviewPagination');

    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    let html = '<div class="pagination-info">共 ' + state.reviewTotal + ' 条记录</div>';
    html += '<div class="pagination-buttons">';

    if (state.reviewPage > 1) {
        html += `<button class="btn btn-sm btn-secondary" onclick="goToReviewPage(${state.reviewPage - 1})">上一页</button>`;
    }

    const startPage = Math.max(1, state.reviewPage - 2);
    const endPage = Math.min(totalPages, state.reviewPage + 2);

    for (let i = startPage; i <= endPage; i++) {
        const active = i === state.reviewPage ? 'active' : '';
        html += `<button class="btn btn-sm ${active ? 'btn-primary' : 'btn-secondary'}" onclick="goToReviewPage(${i})">${i}</button>`;
    }

    if (state.reviewPage < totalPages) {
        html += `<button class="btn btn-sm btn-secondary" onclick="goToReviewPage(${state.reviewPage + 1})">下一页</button>`;
    }

    html += '</div>';
    container.innerHTML = html;
}

function goToReviewPage(page) {
    state.reviewPage = page;
    searchReviews();
}

function resetReviewFilters() {
    document.getElementById('filterReviewDate').value = '';
    document.getElementById('filterReviewItem').value = '';
    document.getElementById('filterReviewRating').value = '';
    document.getElementById('filterReviewPhone').value = '';
    state.reviewPage = 1;
    searchReviews();
}

async function loadReschedules() {
    await loadRescheduleItemSelect();
    await searchReschedules();
}

async function loadRescheduleItemSelect() {
    try {
        if (state.items.length === 0) {
            const res = await fetch(`${API_BASE}/items`);
            state.items = await res.json();
        }

        const select = document.getElementById('filterRescheduleItem');
        select.innerHTML = '<option value="">全部事项</option>' +
            state.items.map(item => `<option value="${item.id}">${item.name}</option>`).join('');
    } catch (e) {
        console.error('加载事项失败', e);
    }
}

async function searchReschedules() {
    const date = document.getElementById('filterRescheduleDate').value;
    const itemId = document.getElementById('filterRescheduleItem').value;
    const phone = document.getElementById('filterReschedulePhone').value.trim();

    let url = `${API_BASE}/reschedules?page=${state.reschedulePage}&page_size=${state.reschedulePageSize}`;
    if (date) url += `&date=${date}`;
    if (itemId) url += `&item_id=${itemId}`;
    if (phone) url += `&phone=${encodeURIComponent(phone)}`;

    try {
        const res = await fetch(url);
        const data = await res.json();
        state.reschedules = data.list;
        state.rescheduleTotal = data.total;
        state.reschedulePage = data.page;
        renderReschedules();
        renderReschedulePagination(data.total_pages);
    } catch (e) {
        document.getElementById('rescheduleList').innerHTML = '<tr><td colspan="10" class="loading">加载失败</td></tr>';
    }
}

function renderReschedules() {
    const tbody = document.getElementById('rescheduleList');

    if (state.reschedules.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="10" class="empty-state">
                    <div class="empty-icon">🔄</div>
                    <p>暂无改期记录</p>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = state.reschedules.map(r => `
        <tr>
            <td>${r.id}</td>
            <td>${r.appointment_id}</td>
            <td>${r.item_name || '-'}</td>
            <td>${r.user_name || '-'}</td>
            <td>${r.phone || '-'}</td>
            <td>
                <div style="font-size:12px;line-height:1.5;">
                    <div>${r.old_date}</div>
                    <div style="color:#666;">${r.old_time_slot}</div>
                    ${r.old_window_name ? `<div style="color:#999;font-size:11px;">${r.old_window_name}</div>` : ''}
                </div>
            </td>
            <td>
                <div style="font-size:12px;line-height:1.5;color:#2d8a4e;">
                    <div>${r.new_date}</div>
                    <div style="color:#2d8a4e;">${r.new_time_slot}</div>
                    ${r.new_window_name ? `<div style="color:#999;font-size:11px;">${r.new_window_name}</div>` : ''}
                </div>
            </td>
            <td style="max-width:150px;white-space:normal;">${escapeHtml(r.reason) || '<span style="color:#999;">无</span>'}</td>
            <td>${r.operator_type === 'admin' ? '管理员' : '群众'}<br><span style="color:#999;font-size:11px;">${r.operator_name || '-'}</span></td>
            <td>${r.created_at ? r.created_at.substring(0, 19) : '-'}</td>
        </tr>
    `).join('');
}

function renderReschedulePagination(totalPages) {
    const container = document.getElementById('reschedulePagination');

    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    let html = '<div class="pagination-info">共 ' + state.rescheduleTotal + ' 条记录</div>';
    html += '<div class="pagination-buttons">';

    if (state.reschedulePage > 1) {
        html += `<button class="btn btn-sm btn-secondary" onclick="goToReschedulePage(${state.reschedulePage - 1})">上一页</button>`;
    }

    const startPage = Math.max(1, state.reschedulePage - 2);
    const endPage = Math.min(totalPages, state.reschedulePage + 2);

    for (let i = startPage; i <= endPage; i++) {
        const active = i === state.reschedulePage ? 'active' : '';
        html += `<button class="btn btn-sm ${active ? 'btn-primary' : 'btn-secondary'}" onclick="goToReschedulePage(${i})">${i}</button>`;
    }

    if (state.reschedulePage < totalPages) {
        html += `<button class="btn btn-sm btn-secondary" onclick="goToReschedulePage(${state.reschedulePage + 1})">下一页</button>`;
    }

    html += '</div>';
    container.innerHTML = html;
}

function goToReschedulePage(page) {
    state.reschedulePage = page;
    searchReschedules();
}

function resetRescheduleFilters() {
    document.getElementById('filterRescheduleDate').value = '';
    document.getElementById('filterRescheduleItem').value = '';
    document.getElementById('filterReschedulePhone').value = '';
    state.reschedulePage = 1;
    searchReschedules();
}

async function loadRestrictions() {
    await searchRestrictions();
}

async function searchRestrictions() {
    const phone = document.getElementById('filterRestrictionPhone').value.trim();
    const status = document.getElementById('filterRestrictionStatus').value;

    let url = `${API_BASE}/phone-restrictions?page=${state.restrictionPage}&page_size=${state.restrictionPageSize}`;
    if (phone) url += `&phone=${encodeURIComponent(phone)}`;
    if (status) url += `&status=${status}`;

    try {
        const res = await fetch(url);
        const data = await res.json();
        state.restrictions = data.list;
        state.restrictionTotal = data.total;
        state.restrictionPage = data.page;
        renderRestrictions();
        renderRestrictionPagination(data.total_pages);
    } catch (e) {
        document.getElementById('restrictionList').innerHTML = '<tr><td colspan="7" class="loading">加载失败</td></tr>';
    }
}

function getRestrictionStatusText(isActive) {
    return isActive ? '限制中' : '已过期';
}

function getRestrictionStatusClass(isActive) {
    return isActive ? 'status-cancelled' : 'status-completed';
}

function renderRestrictions() {
    const tbody = document.getElementById('restrictionList');

    if (state.restrictions.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="empty-state">
                    <div class="empty-icon">🚫</div>
                    <p>暂无手机号限制记录</p>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = state.restrictions.map(r => `
        <tr>
            <td>${r.id}</td>
            <td>${r.phone}</td>
            <td>${escapeHtml(r.reason) || '<span style="color:#999;">未填写</span>'}</td>
            <td>${r.end_date}</td>
            <td><span class="status-badge ${getRestrictionStatusClass(r.is_active)}">${getRestrictionStatusText(r.is_active)}</span></td>
            <td>${r.created_at ? r.created_at.substring(0, 16) : '-'}</td>
            <td>
                <div class="action-buttons">
                    <button class="btn btn-link" onclick="editRestriction(${r.id})">编辑</button>
                    <button class="btn btn-link danger" onclick="deleteRestriction(${r.id})">删除</button>
                </div>
            </td>
        </tr>
    `).join('');
}

function renderRestrictionPagination(totalPages) {
    const container = document.getElementById('restrictionPagination');

    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    let html = '<div class="pagination-info">共 ' + state.restrictionTotal + ' 条记录</div>';
    html += '<div class="pagination-buttons">';

    if (state.restrictionPage > 1) {
        html += `<button class="btn btn-sm btn-secondary" onclick="goToRestrictionPage(${state.restrictionPage - 1})">上一页</button>`;
    }

    const startPage = Math.max(1, state.restrictionPage - 2);
    const endPage = Math.min(totalPages, state.restrictionPage + 2);

    for (let i = startPage; i <= endPage; i++) {
        const active = i === state.restrictionPage ? 'active' : '';
        html += `<button class="btn btn-sm ${active ? 'btn-primary' : 'btn-secondary'}" onclick="goToRestrictionPage(${i})">${i}</button>`;
    }

    if (state.restrictionPage < totalPages) {
        html += `<button class="btn btn-sm btn-secondary" onclick="goToRestrictionPage(${state.restrictionPage + 1})">下一页</button>`;
    }

    html += '</div>';
    container.innerHTML = html;
}

function goToRestrictionPage(page) {
    state.restrictionPage = page;
    searchRestrictions();
}

function resetRestrictionFilters() {
    document.getElementById('filterRestrictionPhone').value = '';
    document.getElementById('filterRestrictionStatus').value = '';
    state.restrictionPage = 1;
    searchRestrictions();
}

function openAddRestrictionModal() {
    state.editingRestrictionId = null;
    document.getElementById('restrictionModalTitle').textContent = '新增手机号限制';
    document.getElementById('restrictionPhone').value = '';
    document.getElementById('restrictionReason').value = '';
    document.getElementById('restrictionEndDate').value = '';
    document.getElementById('restrictionModal').classList.add('show');
}

async function editRestriction(id) {
    const restriction = state.restrictions.find(r => r.id === id);
    if (!restriction) return;

    state.editingRestrictionId = id;
    document.getElementById('restrictionModalTitle').textContent = '编辑手机号限制';
    document.getElementById('restrictionPhone').value = restriction.phone;
    document.getElementById('restrictionReason').value = restriction.reason || '';
    document.getElementById('restrictionEndDate').value = restriction.end_date;
    document.getElementById('restrictionModal').classList.add('show');
}

async function saveRestriction() {
    const phone = document.getElementById('restrictionPhone').value.trim();
    const reason = document.getElementById('restrictionReason').value.trim();
    const endDate = document.getElementById('restrictionEndDate').value;

    if (!phone) {
        showToast('请输入手机号', 'error');
        return;
    }

    if (!/^1[3-9]\d{9}$/.test(phone)) {
        showToast('请输入正确的手机号', 'error');
        return;
    }

    if (!endDate) {
        showToast('请选择截止日期', 'error');
        return;
    }

    try {
        let res;
        if (state.editingRestrictionId) {
            res = await fetch(`${API_BASE}/phone-restrictions/${state.editingRestrictionId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone, reason, end_date: endDate })
            });
        } else {
            res = await fetch(`${API_BASE}/phone-restrictions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone, reason, end_date: endDate })
            });
        }

        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || '保存失败');
        }

        showToast('保存成功', 'success');
        document.getElementById('restrictionModal').classList.remove('show');
        searchRestrictions();
    } catch (e) {
        showToast(e.message, 'error');
    }
}

function deleteRestriction(id) {
    const restriction = state.restrictions.find(r => r.id === id);
    showConfirm('确认删除', `确定删除手机号 ${restriction.phone} 的限制吗？`, async () => {
        try {
            const res = await fetch(`${API_BASE}/phone-restrictions/${id}`, {
                method: 'DELETE'
            });

            if (!res.ok) {
                throw new Error('删除失败');
            }

            showToast('删除成功', 'success');
            searchRestrictions();
        } catch (e) {
            showToast(e.message, 'error');
        }
    });
}

async function loadWindows() {
    try {
        const res = await fetch(`${API_BASE}/windows`);
        state.windows = await res.json();
        renderWindows();
    } catch (e) {
        document.getElementById('windowList').innerHTML = '<tr><td colspan="6" class="loading">加载失败</td></tr>';
    }
}

function renderWindows() {
    const tbody = document.getElementById('windowList');

    if (state.windows.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="empty-state">
                    <div class="empty-icon">🪟</div>
                    <p>暂无窗口，请点击右上角新增</p>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = state.windows.map((win, index) => `
        <tr>
            <td>${index + 1}</td>
            <td><strong>${escapeHtml(win.name)}</strong></td>
            <td>${escapeHtml(win.description || '-')}</td>
            <td>${win.sort_order || 0}</td>
            <td>
                <span class="status-badge ${win.status === 'active' ? 'status-completed' : 'status-cancelled'}">
                    ${win.status === 'active' ? '启用' : '停用'}
                </span>
            </td>
            <td>
                <div class="action-buttons">
                    <button class="btn btn-link" onclick="editWindow(${win.id})">编辑</button>
                    <button class="btn btn-link ${win.status === 'active' ? 'danger' : ''}" onclick="toggleWindowStatus(${win.id}, '${win.status === 'active' ? 'inactive' : 'active'}')">
                        ${win.status === 'active' ? '停用' : '启用'}
                    </button>
                    <button class="btn btn-link danger" onclick="deleteWindow(${win.id})">删除</button>
                </div>
            </td>
        </tr>
    `).join('');
}

function openAddWindowModal() {
    state.editingWindowId = null;
    document.getElementById('windowModalTitle').textContent = '新增窗口';
    document.getElementById('windowName').value = '';
    document.getElementById('windowDesc').value = '';
    document.getElementById('windowSortOrder').value = 0;
    document.getElementById('windowModal').classList.add('show');
}

async function editWindow(id) {
    const win = state.windows.find(w => w.id === id);
    if (!win) return;

    state.editingWindowId = id;
    document.getElementById('windowModalTitle').textContent = '编辑窗口';
    document.getElementById('windowName').value = win.name;
    document.getElementById('windowDesc').value = win.description || '';
    document.getElementById('windowSortOrder').value = win.sort_order || 0;
    document.getElementById('windowModal').classList.add('show');
}

async function saveWindow() {
    const name = document.getElementById('windowName').value.trim();
    const description = document.getElementById('windowDesc').value.trim();
    const sortOrder = document.getElementById('windowSortOrder').value || 0;

    if (!name) {
        showToast('请输入窗口名称', 'error');
        return;
    }

    try {
        let res;
        if (state.editingWindowId) {
            res = await fetch(`${API_BASE}/windows/${state.editingWindowId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, description, sort_order: sortOrder })
            });
        } else {
            res = await fetch(`${API_BASE}/windows`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, description, sort_order: sortOrder })
            });
        }

        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || '保存失败');
        }

        showToast('保存成功', 'success');
        document.getElementById('windowModal').classList.remove('show');
        loadWindows();
    } catch (e) {
        showToast(e.message, 'error');
    }
}

function deleteWindow(id) {
    const win = state.windows.find(w => w.id === id);
    showConfirm('确认删除', `确定删除窗口"${win.name}"吗？`, async () => {
        try {
            const res = await fetch(`${API_BASE}/windows/${id}`, {
                method: 'DELETE'
            });

            if (!res.ok) {
                throw new Error('删除失败');
            }

            showToast('删除成功', 'success');
            loadWindows();
        } catch (e) {
            showToast(e.message, 'error');
        }
    });
}

async function toggleWindowStatus(id, status) {
    const win = state.windows.find(w => w.id === id);
    const action = status === 'active' ? '启用' : '停用';
    showConfirm(`确认${action}`, `确定${action}窗口"${win.name}"吗？`, async () => {
        try {
            const res = await fetch(`${API_BASE}/windows/${id}/status`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status })
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || '操作失败');
            }

            showToast(action + '成功', 'success');
            loadWindows();
        } catch (e) {
            showToast(e.message, 'error');
        }
    });
}

function openSlotModal(itemId, itemName) {
    const today = formatDate(new Date());
    state.slotModalData = { itemId, itemName, date: today, useWindows: false, useTimeSlots: false, windowSlots: [], mode: 'total' };
    state.editingTimeSlots = [];

    document.getElementById('slotInfo').innerHTML = `
        <p><strong>事项：</strong>${escapeHtml(itemName)}</p>
        <p><strong>日期：</strong><input type="date" id="slotDate" value="${today}" style="width:auto;padding:4px 8px;border:1px solid #d9d9d9;border-radius:4px;font-size:13px;"></p>
        <p id="slotSummary"><strong>当前号源：</strong><span id="slotCurrentCount">-</span> / <span id="slotCurrentMax">-</span></p>
    `;

    document.getElementById('slotMaxCount').value = '';
    document.getElementById('slotTotalGroup').style.display = 'block';
    document.getElementById('slotTimeGroup').style.display = 'none';
    document.getElementById('slotWindowsGroup').style.display = 'none';
    document.getElementById('slotModal').classList.add('show');

    loadSlotInfo(itemId, today);

    document.getElementById('slotDate').addEventListener('change', (e) => {
        state.slotModalData.date = e.target.value;
        loadSlotInfo(itemId, e.target.value);
    });

    document.querySelectorAll('.slot-mode-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const newMode = tab.dataset.mode;
            const currentMode = state.slotModalData.mode;

            if (newMode === currentMode) return;

            if (currentMode === 'time' && state.editingTimeSlots.length > 0) {
                const hasUsed = state.editingTimeSlots.some(ts => ts.current_count && ts.current_count > 0);
                if (hasUsed) {
                    if (!confirm('分时段已有预约记录，切换到每日总号源模式将保留分时段数据但不再使用。确定要切换吗？')) {
                        return;
                    }
                } else {
                    if (!confirm('切换到每日总号源模式后，分时段配置将被清除。确定要切换吗？')) {
                        return;
                    }
                    state.editingTimeSlots = [];
                }
            }

            state.slotModalData.mode = newMode;

            document.querySelectorAll('.slot-mode-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            if (newMode === 'total') {
                document.getElementById('slotTotalGroup').style.display = 'block';
                document.getElementById('slotTimeGroup').style.display = 'none';
                document.getElementById('slotWindowsGroup').style.display = 'none';
            } else if (newMode === 'time') {
                document.getElementById('slotTotalGroup').style.display = 'none';
                document.getElementById('slotTimeGroup').style.display = 'block';
                document.getElementById('slotWindowsGroup').style.display = 'none';
                renderTimeSlotList();
            }
        });
    });

    document.getElementById('btnAddTimeSlot').addEventListener('click', () => {
        addTimeSlot();
    });
}

async function loadSlotInfo(itemId, date) {
    try {
        const res = await fetch(`${API_BASE}/slots/${itemId}/${date}`);
        const data = await res.json();

        state.slotModalData.useWindows = data.use_windows || false;
        state.slotModalData.useTimeSlots = data.use_time_slots || false;

        if (data.available !== undefined || data.use_windows || data.use_time_slots) {
            document.getElementById('slotCurrentCount').textContent = data.current_count || 0;
            document.getElementById('slotCurrentMax').textContent = data.max_count || 0;

            if (data.use_time_slots && data.time_slots && data.time_slots.length > 0) {
                state.slotModalData.mode = 'time';
                state.editingTimeSlots = data.time_slots.map(ts => ({
                    start_time: ts.start_time,
                    end_time: ts.end_time,
                    max_count: ts.max_count,
                    current_count: ts.current_count,
                    id: ts.id
                }));

                document.querySelectorAll('.slot-mode-tab').forEach(t => {
                    t.classList.toggle('active', t.dataset.mode === 'time');
                });
                document.getElementById('slotTotalGroup').style.display = 'none';
                document.getElementById('slotTimeGroup').style.display = 'block';
                document.getElementById('slotWindowsGroup').style.display = 'none';
                renderTimeSlotList();
            } else if (data.use_windows && data.windows && data.windows.length > 0) {
                state.slotModalData.windowSlots = data.windows;
                state.slotModalData.mode = 'total';
                document.querySelectorAll('.slot-mode-tab').forEach(t => {
                    t.classList.toggle('active', t.dataset.mode === 'total');
                });
                document.getElementById('slotTotalGroup').style.display = 'none';
                document.getElementById('slotTimeGroup').style.display = 'none';
                document.getElementById('slotWindowsGroup').style.display = 'block';
                renderSlotWindowList(data.windows);
            } else {
                state.slotModalData.mode = 'total';
                state.editingTimeSlots = [];
                document.querySelectorAll('.slot-mode-tab').forEach(t => {
                    t.classList.toggle('active', t.dataset.mode === 'total');
                });
                document.getElementById('slotTotalGroup').style.display = 'block';
                document.getElementById('slotTimeGroup').style.display = 'none';
                document.getElementById('slotWindowsGroup').style.display = 'none';
                document.getElementById('slotMaxCount').value = data.max_count || 20;
            }
        } else {
            document.getElementById('slotCurrentCount').textContent = '-';
            document.getElementById('slotCurrentMax').textContent = '不可预约';
        }
    } catch (e) {
        console.error('加载号源信息失败', e);
    }
}

function renderSlotWindowList(windows) {
    const container = document.getElementById('slotWindowList');
    container.innerHTML = windows.map(win => `
        <div class="window-slot-item" data-window-id="${win.window_id}">
            <div class="window-slot-info">
                <span class="window-slot-name">${escapeHtml(win.window_name)}</span>
                <span class="window-slot-usage">已用: ${win.current_count || 0} / ${win.max_count || 0}</span>
            </div>
            <div class="window-slot-input">
                <input type="number" class="window-slot-max" value="${win.max_count || 0}" min="0" max="500" data-window-id="${win.window_id}">
                <span class="window-slot-unit">个</span>
            </div>
        </div>
    `).join('');
}

function renderTimeSlotList() {
    const container = document.getElementById('slotTimeList');

    if (state.editingTimeSlots.length === 0) {
        container.innerHTML = `
            <div class="empty-state-sm">
                <span>暂无时段，点击上方按钮添加</span>
            </div>
        `;
        return;
    }

    container.innerHTML = state.editingTimeSlots.map((ts, index) => `
        <div class="time-slot-item" data-index="${index}">
            <div class="time-slot-fields">
                <div class="time-slot-field">
                    <label>开始</label>
                    <input type="time" class="ts-start" value="${ts.start_time || '09:00'}" data-index="${index}">
                </div>
                <div class="time-slot-field">
                    <label>结束</label>
                    <input type="time" class="ts-end" value="${ts.end_time || '10:00'}" data-index="${index}">
                </div>
                <div class="time-slot-field">
                    <label>容量</label>
                    <input type="number" class="ts-max" value="${ts.max_count || 10}" min="0" max="500" data-index="${index}">
                </div>
                ${ts.current_count !== undefined ? `
                <div class="time-slot-field">
                    <label>已约</label>
                    <span class="ts-current">${ts.current_count || 0}</span>
                </div>
                ` : ''}
            </div>
            <button type="button" class="time-slot-delete" onclick="removeTimeSlot(${index})">×</button>
        </div>
    `).join('');

    container.querySelectorAll('.ts-start').forEach(input => {
        input.addEventListener('change', (e) => {
            const index = parseInt(e.target.dataset.index);
            state.editingTimeSlots[index].start_time = e.target.value;
        });
    });

    container.querySelectorAll('.ts-end').forEach(input => {
        input.addEventListener('change', (e) => {
            const index = parseInt(e.target.dataset.index);
            state.editingTimeSlots[index].end_time = e.target.value;
        });
    });

    container.querySelectorAll('.ts-max').forEach(input => {
        input.addEventListener('input', (e) => {
            const index = parseInt(e.target.dataset.index);
            state.editingTimeSlots[index].max_count = parseInt(e.target.value) || 0;
        });
    });
}

function addTimeSlot() {
    const lastSlot = state.editingTimeSlots[state.editingTimeSlots.length - 1];
    let startTime = '09:00';
    let endTime = '10:00';

    if (lastSlot && lastSlot.end_time) {
        startTime = lastSlot.end_time;
        const [h, m] = startTime.split(':').map(Number);
        const endMinutes = h * 60 + m + 60;
        const endH = Math.floor(endMinutes / 60);
        const endM = endMinutes % 60;
        if (endH < 17) {
            endTime = `${endH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`;
        } else {
            endTime = '17:00';
        }
    }

    state.editingTimeSlots.push({
        start_time: startTime,
        end_time: endTime,
        max_count: 10
    });
    renderTimeSlotList();
}

function removeTimeSlot(index) {
    const ts = state.editingTimeSlots[index];
    if (ts.current_count && ts.current_count > 0) {
        showToast('该时段已有预约，无法删除', 'error');
        return;
    }
    state.editingTimeSlots.splice(index, 1);
    renderTimeSlotList();
}

async function saveSlot() {
    const { itemId, date, mode, useWindows, useTimeSlots } = state.slotModalData;

    async function clearTimeSlotsBeforeModeSwitch(message) {
        if (!confirm(message)) {
            return false;
        }

        const res = await fetch(`${API_BASE}/slots/${itemId}/${date}/time-slots`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ time_slots: [] })
        });

        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || '清除分时段配置失败');
        }

        state.slotModalData.useTimeSlots = false;
        state.editingTimeSlots = [];
        return true;
    }

    if (mode === 'time') {
        if (state.editingTimeSlots.length === 0) {
            showToast('请至少添加一个时段', 'error');
            return;
        }

        const timeRegex = /^\d{2}:\d{2}$/;
        for (let i = 0; i < state.editingTimeSlots.length; i++) {
            const ts = state.editingTimeSlots[i];
            if (!ts.start_time || !timeRegex.test(ts.start_time)) {
                showToast(`第 ${i + 1} 个时段的开始时间不正确`, 'error');
                return;
            }
            if (!ts.end_time || !timeRegex.test(ts.end_time)) {
                showToast(`第 ${i + 1} 个时段的结束时间不正确`, 'error');
                return;
            }
            if (ts.start_time >= ts.end_time) {
                showToast(`第 ${i + 1} 个时段的开始时间必须早于结束时间`, 'error');
                return;
            }
            if (ts.max_count === undefined || ts.max_count === null || isNaN(ts.max_count) || ts.max_count < 0) {
                showToast(`第 ${i + 1} 个时段的容量必须为非负整数`, 'error');
                return;
            }
        }

        const sortedSlots = [...state.editingTimeSlots].sort((a, b) => a.start_time.localeCompare(b.start_time));
        for (let i = 0; i < sortedSlots.length - 1; i++) {
            if (sortedSlots[i + 1].start_time < sortedSlots[i].end_time) {
                showToast(`时段 ${sortedSlots[i].start_time}-${sortedSlots[i].end_time} 与 ${sortedSlots[i + 1].start_time}-${sortedSlots[i + 1].end_time} 存在重叠`, 'error');
                return;
            }
        }

        try {
            const res = await fetch(`${API_BASE}/slots/${itemId}/${date}/time-slots`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ time_slots: state.editingTimeSlots })
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
    } else if (useWindows) {
        if (useTimeSlots) {
            try {
                const cleared = await clearTimeSlotsBeforeModeSwitch('保存窗口号源将清除分时段配置，确定要继续吗？');
                if (!cleared) return;
            } catch (e) {
                showToast(e.message, 'error');
                return;
            }
        }

        const windowInputs = document.querySelectorAll('.window-slot-max');
        const windowData = [];

        for (const input of windowInputs) {
            const windowId = parseInt(input.dataset.windowId, 10);
            const maxCount = parseInt(input.value, 10);

            if (isNaN(maxCount) || maxCount < 0) {
                showToast('请输入有效的号源数量', 'error');
                return;
            }

            windowData.push({ window_id: windowId, max_count: maxCount });
        }

        try {
            const res = await fetch(`${API_BASE}/slots/${itemId}/${date}/windows/max`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ windows: windowData })
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
    } else {
        if (useTimeSlots) {
            try {
                const cleared = await clearTimeSlotsBeforeModeSwitch('保存每日号源将清除分时段配置，确定要继续吗？');
                if (!cleared) return;
            } catch (e) {
                showToast(e.message, 'error');
                return;
            }
        }

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

    document.getElementById('btnSearchReview').addEventListener('click', () => {
        state.reviewPage = 1;
        searchReviews();
    });
    document.getElementById('btnResetReview').addEventListener('click', resetReviewFilters);

    document.getElementById('btnAddRestriction').addEventListener('click', openAddRestrictionModal);
    document.getElementById('btnCancelRestriction').addEventListener('click', () => {
        document.getElementById('restrictionModal').classList.remove('show');
    });
    document.getElementById('btnSaveRestriction').addEventListener('click', saveRestriction);

    document.getElementById('btnAddWindow').addEventListener('click', openAddWindowModal);
    document.getElementById('btnCancelWindow').addEventListener('click', () => {
        document.getElementById('windowModal').classList.remove('show');
    });
    document.getElementById('btnSaveWindow').addEventListener('click', saveWindow);

    document.getElementById('btnSearchRestriction').addEventListener('click', () => {
        state.restrictionPage = 1;
        searchRestrictions();
    });
    document.getElementById('btnResetRestriction').addEventListener('click', resetRestrictionFilters);

    document.getElementById('btnSearchReschedule').addEventListener('click', () => {
        state.reschedulePage = 1;
        searchReschedules();
    });
    document.getElementById('btnResetReschedule').addEventListener('click', resetRescheduleFilters);

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
window.callNumber = callNumber;
window.nextNumber = nextNumber;
window.editItem = editItem;
window.deleteItem = deleteItem;
window.deleteHoliday = deleteHoliday;
window.openSlotModal = openSlotModal;
window.addMaterial = addMaterial;
window.removeMaterial = removeMaterial;
window.moveMaterial = moveMaterial;
window.goToReminderPage = goToReminderPage;
window.goToReviewPage = goToReviewPage;
window.editRestriction = editRestriction;
window.deleteRestriction = deleteRestriction;
window.goToRestrictionPage = goToRestrictionPage;
window.goToReschedulePage = goToReschedulePage;
window.editWindow = editWindow;
window.deleteWindow = deleteWindow;
window.toggleWindowStatus = toggleWindowStatus;

document.addEventListener('DOMContentLoaded', init);
