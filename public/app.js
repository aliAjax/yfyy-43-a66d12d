const state = {
    items: [],
    selectedItem: null,
    selectedItemMaterials: [],
    confirmedMaterialIds: new Set(),
    selectedDate: null,
    selectedTimeSlot: null,
    timeSlots: [],
    slotMode: 'window',
    currentWeekOffset: 0,
    currentAppointment: null,
    currentRating: 0,
    currentReview: null,
    reschedule: {
        weekOffset: 0,
        selectedDate: null,
        selectedTimeSlot: null,
        timeSlots: [],
        slotMode: 'window'
    }
};

const API_BASE = '/api';

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.remove();
    }, 3000);
}

async function loadItems() {
    try {
        const res = await fetch(`${API_BASE}/items`);
        state.items = await res.json();
        renderItems();
    } catch (e) {
        document.getElementById('itemList').innerHTML = '<div class="empty-state"><div class="empty-icon">❌</div><p>加载失败，请稍后重试</p></div>';
    }
}

function renderItems() {
    const container = document.getElementById('itemList');
    if (state.items.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><p>暂无可预约事项</p></div>';
        return;
    }

    const icons = ['📄', '🆔', '🏠', '💼', '👶', '🎓', '🏥', '📝'];
    
    container.innerHTML = state.items.map((item, index) => `
        <div class="item-card ${state.selectedItem?.id === item.id ? 'selected' : ''}" data-id="${item.id}">
            <div class="item-icon">${icons[index % icons.length]}</div>
            <div class="item-name">${item.name}</div>
            <div class="item-desc">${item.description || '点击预约'}</div>
        </div>
    `).join('');

    container.querySelectorAll('.item-card').forEach(card => {
        card.addEventListener('click', async () => {
            const id = parseInt(card.dataset.id);
            state.selectedItem = state.items.find(i => i.id === id);
            state.selectedItemMaterials = [];
            state.confirmedMaterialIds = new Set();
            state.selectedDate = null;
            state.selectedTimeSlot = null;
            state.currentWeekOffset = 0;
            renderItems();

            try {
                const res = await fetch(`${API_BASE}/items/${id}/materials`);
                state.selectedItemMaterials = await res.json();
            } catch (e) {
                console.error('加载材料清单失败', e);
            }

            setTimeout(() => goToStep(2), 300);
        });
    });
}

function goToStep(stepNum) {
    document.querySelectorAll('.step').forEach((s, i) => {
        s.classList.toggle('active', i + 1 === stepNum);
        s.classList.toggle('completed', i + 1 < stepNum);
    });

    document.querySelectorAll('.step-content').forEach((c, i) => {
        c.classList.toggle('active', i + 1 === stepNum);
    });

    if (stepNum === 2) {
        renderSelectedItemInfo();
        renderMaterialsBox();
        renderDateGrid();
    }
    if (stepNum === 3) {
        renderBookingSummary();
    }
}

function renderSelectedItemInfo() {
    if (state.selectedItem) {
        document.getElementById('selectedItemInfo').innerHTML = `
            <strong>已选事项：</strong>${state.selectedItem.name}
            <span style="color:#999; margin-left:10px;">${state.selectedItem.description || ''}</span>
        `;
    }
}

function renderMaterialsBox() {
    const section = document.getElementById('materialsSection');
    const box = document.getElementById('materialsListBox');

    section.style.display = 'block';

    if (state.selectedItemMaterials.length === 0) {
        box.innerHTML = `
            <div class="empty-state-mini">
                <span class="empty-icon-mini">📄</span>
                <span>该事项暂无特殊材料要求，请携带本人有效身份证件</span>
            </div>
        `;
        return;
    }

    const hasRequireConfirmation = state.selectedItemMaterials.some(m => m.require_confirmation);
    const requiredCount = state.selectedItemMaterials.filter(m => m.is_required && m.require_confirmation).length;
    const confirmedCount = state.selectedItemMaterials.filter(m => m.is_required && m.require_confirmation && state.confirmedMaterialIds.has(m.id)).length;

    let headerHtml = '';
    if (hasRequireConfirmation) {
        headerHtml = `
            <div class="material-confirm-header">
                <span class="material-confirm-title">📋 材料确认清单</span>
                <span class="material-confirm-progress">
                    ${requiredCount > 0 ? `必备材料已确认 ${confirmedCount}/${requiredCount}` : ''}
                </span>
            </div>
        `;
    }

    box.innerHTML = `
        ${headerHtml}
        <div class="material-list-citizen">
            ${state.selectedItemMaterials.map((mat, index) => {
                const isRequired = mat.is_required;
                const needConfirm = mat.require_confirmation;
                const isConfirmed = state.confirmedMaterialIds.has(mat.id);
                return `
                    <div class="material-item-citizen ${needConfirm ? 'has-confirm' : ''} ${isRequired ? 'is-required' : 'is-optional'}">
                        <div class="material-index">${index + 1}</div>
                        <div class="material-content">
                            <div class="material-name-row">
                                <span class="material-name-citizen">${escapeHtml(mat.name)}</span>
                                ${isRequired ? '<span class="material-tag material-tag-required">必备</span>' : '<span class="material-tag material-tag-optional">可选</span>'}
                            </div>
                            ${mat.description ? `<div class="material-desc-citizen">${escapeHtml(mat.description)}</div>` : ''}
                        </div>
                        ${needConfirm ? `
                            <label class="material-checkbox">
                                <input type="checkbox" class="material-confirm-check" data-material-id="${mat.id}" ${isConfirmed ? 'checked' : ''}>
                                <span class="material-check-text">${isRequired ? '我已准备好' : '我确认'}</span>
                            </label>
                        ` : ''}
                    </div>
                `;
            }).join('')}
        </div>
    `;

    box.querySelectorAll('.material-confirm-check').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const materialId = parseInt(e.target.dataset.materialId);
            if (e.target.checked) {
                state.confirmedMaterialIds.add(materialId);
            } else {
                state.confirmedMaterialIds.delete(materialId);
            }
            renderMaterialsBox();
        });
    });
}

function getWeekDates(offset = 0) {
    const today = new Date();
    const day = today.getDay() || 7;
    const monday = new Date(today);
    monday.setDate(today.getDate() - day + 1 + offset * 7);
    
    const dates = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        dates.push(d);
    }
    return dates;
}

function formatDate(date) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getItemById(itemId) {
    return state.items.find(i => i.id === parseInt(itemId));
}

function getMaxAdvanceWeeks(item) {
    if (!item || item.advance_weeks === null || item.advance_weeks === undefined || item.advance_weeks === '') {
        return 4;
    }
    const weeks = parseInt(item.advance_weeks);
    return isNaN(weeks) ? 4 : weeks;
}

function isSameDayBookingAllowed(item) {
    if (!item || item.allow_same_day === null || item.allow_same_day === undefined) {
        return true;
    }
    return item.allow_same_day === 1;
}

function isSameDayReschedulingAllowed(item) {
    if (!item || item.allow_same_day === null || item.allow_same_day === undefined) {
        return false;
    }
    return item.allow_same_day === 1;
}

function getMaxAdvanceDate(item) {
    const weeks = getMaxAdvanceWeeks(item);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const maxDate = new Date(today);
    maxDate.setDate(today.getDate() + weeks * 7 - 1);
    return maxDate;
}

function getWeekMonday(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    return d;
}

function getMaxWeekOffset(item) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const thisWeekMonday = getWeekMonday(today);
    const maxDate = getMaxAdvanceDate(item);
    const maxWeekMonday = getWeekMonday(maxDate);
    const diffDays = Math.floor((maxWeekMonday - thisWeekMonday) / (24 * 60 * 60 * 1000));
    return Math.floor(diffDays / 7);
}

function isDateWithinAdvanceWeeks(dateStr, item) {
    const date = new Date(dateStr);
    date.setHours(0, 0, 0, 0);
    const maxDate = getMaxAdvanceDate(item);
    maxDate.setHours(23, 59, 59, 999);
    return date <= maxDate;
}

function getAppointmentStartTime(timeSlot) {
    if (!timeSlot) return '09:00';
    const parts = timeSlot.split('-');
    return parts[0] || '09:00';
}

function getAppointmentDateTime(dateStr, timeSlot) {
    const startTime = getAppointmentStartTime(timeSlot);
    const [hours, minutes] = startTime.split(':').map(Number);
    const date = new Date(dateStr);
    date.setHours(hours, minutes, 0, 0);
    return date;
}

function isCancellationAllowed(appointment, item) {
    if (!appointment || appointment.status !== 'pending') return false;
    if (!item) return true;

    const deadlineHours = item.cancel_deadline_hours;
    if (deadlineHours === null || deadlineHours === undefined || deadlineHours === '') {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const aptDate = new Date(appointment.appointment_date);
        aptDate.setHours(0, 0, 0, 0);
        return aptDate >= today;
    }

    const aptDateTime = getAppointmentDateTime(appointment.appointment_date, appointment.time_slot);
    const now = new Date();
    const deadline = new Date(aptDateTime.getTime() - parseInt(deadlineHours) * 60 * 60 * 1000);
    return now <= deadline;
}

function isReschedulingAllowed(appointment, item) {
    if (!appointment || appointment.status !== 'pending') return false;
    if (!item) return true;

    const deadlineHours = item.reschedule_deadline_hours;
    if (deadlineHours === null || deadlineHours === undefined || deadlineHours === '') {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const aptDate = new Date(appointment.appointment_date);
        aptDate.setHours(0, 0, 0, 0);
        return aptDate >= today;
    }

    const aptDateTime = getAppointmentDateTime(appointment.appointment_date, appointment.time_slot);
    const now = new Date();
    const deadline = new Date(aptDateTime.getTime() - parseInt(deadlineHours) * 60 * 60 * 1000);
    return now <= deadline;
}

function renderDateGrid() {
    const dates = getWeekDates(state.currentWeekOffset);
    const weekStart = formatDate(dates[0]);
    const weekEnd = formatDate(dates[6]);
    document.getElementById('dateRange').textContent = `${weekStart} ~ ${weekEnd}`;

    const dayNames = ['日', '一', '二', '三', '四', '五', '六'];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const item = state.selectedItem;
    const sameDayAllowed = isSameDayBookingAllowed(item);
    const maxAdvanceDate = getMaxAdvanceDate(item);

    const container = document.getElementById('dateGrid');
    container.innerHTML = dates.map(date => {
        const dateStr = formatDate(date);
        const isPast = date < today;
        const isToday = date.getTime() === today.getTime();
        const isWeekend = date.getDay() === 0 || date.getDay() === 6;
        const isSelected = state.selectedDate === dateStr;
        const isBeyondMax = date > maxAdvanceDate;
        const isSameDayDisabled = isToday && !sameDayAllowed;

        let disabled = isPast || isWeekend || isBeyondMax || isSameDayDisabled;

        let classes = 'date-item';
        if (disabled) classes += ' disabled';
        if (isToday) classes += ' today';
        if (isSelected) classes += ' selected';

        let title = '';
        if (isSameDayDisabled) title = '该事项不支持当天预约';
        if (isBeyondMax) title = '超出可预约范围';
        if (isWeekend) title = '周末不可预约';
        if (isPast) title = '过去的日期不可预约';

        return `
            <div class="${classes}" data-date="${dateStr}" title="${title}">
                <span class="date-day">${isToday ? '今天' : '周' + dayNames[date.getDay()]}</span>
                <span class="date-num">${date.getDate()}</span>
            </div>
        `;
    }).join('');

    container.querySelectorAll('.date-item:not(.disabled)').forEach(item => {
        item.addEventListener('click', () => {
            state.selectedDate = item.dataset.date;
            state.selectedTimeSlot = null;
            renderDateGrid();
            loadTimeSlots();
        });
    });

    updateNavButtons();

    if (state.selectedDate) {
        loadTimeSlots();
    }
}

function updateNavButtons() {
    const item = state.selectedItem;
    const maxOffset = getMaxWeekOffset(item);

    const prevBtn = document.getElementById('prevWeek');
    const nextBtn = document.getElementById('nextWeek');

    if (prevBtn) {
        prevBtn.disabled = state.currentWeekOffset <= 0;
        prevBtn.style.opacity = state.currentWeekOffset <= 0 ? '0.5' : '1';
        prevBtn.style.cursor = state.currentWeekOffset <= 0 ? 'not-allowed' : 'pointer';
    }
    if (nextBtn) {
        nextBtn.disabled = state.currentWeekOffset >= maxOffset;
        nextBtn.style.opacity = state.currentWeekOffset >= maxOffset ? '0.5' : '1';
        nextBtn.style.cursor = state.currentWeekOffset >= maxOffset ? 'not-allowed' : 'pointer';
    }
}

async function loadTimeSlots() {
    if (!state.selectedItem || !state.selectedDate) return;

    const section = document.getElementById('timeSlotsSection');
    section.style.display = 'block';

    document.getElementById('timeSlots').innerHTML = '<div class="loading">加载时段中...</div>';
    state.selectedTimeSlot = null;

    try {
        const res = await fetch(`${API_BASE}/slots/${state.selectedItem.id}/${state.selectedDate}`);
        const data = await res.json();

        if (!data.available) {
            document.getElementById('timeSlots').innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📅</div>
                    <p>${data.reason || '该日期不可预约'}</p>
                </div>
            `;
            return;
        }

        if (data.use_time_slots && data.time_slots && data.time_slots.length > 0) {
            state.slotMode = 'time';
            state.timeSlots = data.time_slots;
            renderTimeSlotCapacities(data.time_slots);
        } else {
            state.slotMode = 'window';
            state.timeSlots = data.time_slots || [];
            renderTimeSlots(data.time_slots || []);
        }
    } catch (e) {
        document.getElementById('timeSlots').innerHTML = '<div class="empty-state"><p>加载失败</p></div>';
    }
}

function renderTimeSlots(slots) {
    const container = document.getElementById('timeSlots');
    
    if (slots.every(s => !s.available)) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">⏰</div>
                <p>今日号源已满，请选择其他日期</p>
            </div>
        `;
        return;
    }

    container.innerHTML = slots.map(slot => `
        <div class="time-slot ${!slot.available ? 'disabled' : ''} ${state.selectedTimeSlot === slot.time ? 'selected' : ''}" 
             data-time="${slot.time}" ${!slot.available ? '' : ''}>
            ${slot.time}
            ${!slot.available ? '' : ''}
        </div>
    `).join('');

    container.querySelectorAll('.time-slot:not(.disabled)').forEach(item => {
        item.addEventListener('click', () => {
            state.selectedTimeSlot = item.dataset.time;
            renderTimeSlots(slots);
            setTimeout(() => goToStep(3), 300);
        });
    });
}

function renderTimeSlotCapacities(timeSlots) {
    const container = document.getElementById('timeSlots');
    
    const allFull = timeSlots.every(ts => ts.current_count >= ts.max_count);
    if (allFull) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">⏰</div>
                <p>今日号源已满，请选择其他日期</p>
            </div>
        `;
        return;
    }

    container.innerHTML = timeSlots.map(ts => {
        const remaining = ts.max_count - ts.current_count;
        const isFull = remaining <= 0;
        const isSelected = state.selectedTimeSlot === `${ts.start_time}-${ts.end_time}`;
        
        return `
            <div class="time-slot-capacity ${isFull ? 'disabled' : ''} ${isSelected ? 'selected' : ''}"
                 data-start="${ts.start_time}" data-end="${ts.end_time}" data-key="${ts.start_time}-${ts.end_time}">
                <div class="tsc-time">${ts.start_time} - ${ts.end_time}</div>
                <div class="tsc-info">
                    <span class="tsc-remaining ${remaining <= 3 && remaining > 0 ? 'few' : ''}">
                        ${isFull ? '已满' : `剩余 ${remaining} 个`}
                    </span>
                    <span class="tsc-total">共 ${ts.max_count} 个</span>
                </div>
            </div>
        `;
    }).join('');

    container.querySelectorAll('.time-slot-capacity:not(.disabled)').forEach(item => {
        item.addEventListener('click', () => {
            const key = item.dataset.key;
            state.selectedTimeSlot = key;
            renderTimeSlotCapacities(timeSlots);
            setTimeout(() => goToStep(3), 300);
        });
    });
}

function renderBookingSummary() {
    const summary = document.getElementById('bookingSummary');
    let timeDisplay = state.selectedTimeSlot || '';
    
    if (state.slotMode === 'time' && state.selectedTimeSlot) {
        const [start, end] = state.selectedTimeSlot.split('-');
        timeDisplay = `${start} - ${end}`;
    }

    let materialsSummary = '';
    if (state.selectedItemMaterials.length > 0) {
        const requiredCount = state.selectedItemMaterials.filter(m => m.is_required).length;
        const requireConfirmCount = state.selectedItemMaterials.filter(m => m.require_confirmation).length;
        const confirmedCount = state.selectedItemMaterials.filter(m => m.require_confirmation && state.confirmedMaterialIds.has(m.id)).length;
        
        materialsSummary = `
            <p style="margin-top:8px; padding-top:8px; border-top:1px dashed #eee;">
                <strong>📋 材料：</strong>
                共 ${state.selectedItemMaterials.length} 项
                ${requiredCount > 0 ? `（必备 ${requiredCount} 项）` : ''}
                ${requireConfirmCount > 0 ? `，已确认 ${confirmedCount}/${requireConfirmCount}` : ''}
            </p>
        `;
    }
    
    summary.innerHTML = `
        <p><strong>办理事项：</strong>${state.selectedItem?.name || ''}</p>
        <p><strong>预约日期：</strong>${state.selectedDate || ''}</p>
        <p><strong>预约时段：</strong>${timeDisplay}</p>
        ${materialsSummary}
    `;
}

async function submitBooking() {
    const userName = document.getElementById('userName').value.trim();
    const userPhone = document.getElementById('userPhone').value.trim();
    const agreeTerms = document.getElementById('agreeTerms').checked;

    if (!userName) {
        showToast('请输入姓名', 'error');
        return;
    }
    if (!userPhone) {
        showToast('请输入手机号', 'error');
        return;
    }
    if (!/^1[3-9]\d{9}$/.test(userPhone)) {
        showToast('请输入正确的手机号', 'error');
        return;
    }
    if (!agreeTerms) {
        showToast('请先阅读并同意预约须知', 'error');
        return;
    }

    const requiredMaterials = state.selectedItemMaterials.filter(m => m.is_required && m.require_confirmation);
    const unconfirmedRequired = requiredMaterials.filter(m => !state.confirmedMaterialIds.has(m.id));
    if (unconfirmedRequired.length > 0) {
        showToast(`请确认必备材料：${unconfirmedRequired[0].name}`, 'error');
        const section = document.getElementById('materialsSection');
        if (section) {
            section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        return;
    }

    const materialConfirmations = state.selectedItemMaterials.map(m => ({
        material_id: m.id,
        is_confirmed: state.confirmedMaterialIds.has(m.id)
    }));

    const submitBtn = document.getElementById('submitBooking');
    submitBtn.disabled = true;
    submitBtn.textContent = '提交中...';

    try {
        const res = await fetch(`${API_BASE}/appointments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                item_id: state.selectedItem.id,
                user_name: userName,
                phone: userPhone,
                appointment_date: state.selectedDate,
                time_slot: state.selectedTimeSlot,
                material_confirmations: materialConfirmations
            })
        });

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || '预约失败');
        }

        renderSuccess(data);
        goToStep(4);
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '提交预约';
    }
}

function renderSuccess(appointment) {
    const details = document.getElementById('successDetails');
    details.innerHTML = `
        <p><strong>预约编号：</strong>${appointment.id}</p>
        <p><strong>办理事项：</strong>${state.selectedItem.name}</p>
        <p><strong>办理窗口：</strong>${appointment.window_name || '系统分配'}</p>
        <p><strong>预约姓名：</strong>${appointment.user_name}</p>
        <p><strong>联系电话：</strong>${appointment.phone}</p>
        <p><strong>预约日期：</strong>${appointment.appointment_date}</p>
        <p><strong>预约时段：</strong>${appointment.time_slot}</p>
    `;

    const tips = document.querySelector('.tips');
    let materialsHtml = '';
    if (state.selectedItemMaterials.length > 0) {
        const hasConfirms = state.selectedItemMaterials.some(m => m.require_confirmation);
        materialsHtml = `
            <p><strong>📋 材料确认清单：</strong></p>
            <ul class="material-tips-list">
                ${state.selectedItemMaterials.map(m => {
                    const isRequired = m.is_required;
                    const isConfirmed = state.confirmedMaterialIds.has(m.id);
                    const needConfirm = m.require_confirmation;
                    return `
                        <li class="material-tip-item">
                            <div class="material-tip-header">
                                <span class="tip-material-name">${escapeHtml(m.name)}</span>
                                ${isRequired ? '<span class="material-tag material-tag-required">必备</span>' : '<span class="material-tag material-tag-optional">可选</span>'}
                                ${needConfirm ? (isConfirmed ? '<span class="material-tag material-tag-confirmed">已确认 ✓</span>' : '<span class="material-tag material-tag-unconfirmed">未确认</span>') : ''}
                            </div>
                            ${m.description ? `<div class="tip-material-desc">${escapeHtml(m.description)}</div>` : ''}
                        </li>
                    `;
                }).join('')}
            </ul>
        `;
    }

    tips.innerHTML = `
        <div class="reminder-box" id="latestReminderBox" style="display:none;">
            <div class="reminder-title">📱 最近提醒</div>
            <div class="reminder-content" id="latestReminderContent"></div>
        </div>
        ${materialsHtml}
        <p style="margin-top:12px;"><strong>温馨提示：</strong></p>
        <ul>
            <li>请您在预约时段前10分钟到达办事大厅</li>
            <li>${state.selectedItemMaterials.length > 0 ? '请务必携带好上述材料，以免影响办理' : '请携带好相关证件和材料'}</li>
            <li>如需取消预约，可通过首页"查询/取消预约"功能凭预约编号和手机号在线取消</li>
        </ul>
    `;

    loadLatestReminder(appointment.phone);
}

async function loadLatestReminder(phone) {
    try {
        const res = await fetch(`${API_BASE}/reminders/latest?phone=${encodeURIComponent(phone)}`);
        if (res.ok) {
            const data = await res.json();
            const box = document.getElementById('latestReminderBox');
            const content = document.getElementById('latestReminderContent');
            if (box && content && data.content) {
                content.textContent = data.content;
                box.style.display = 'block';
            }
        }
    } catch (e) {
        console.error('加载最新提醒失败', e);
    }
}

function resetBooking() {
    state.selectedItem = null;
    state.selectedItemMaterials = [];
    state.confirmedMaterialIds = new Set();
    state.selectedDate = null;
    state.selectedTimeSlot = null;
    state.currentWeekOffset = 0;
    document.getElementById('userName').value = '';
    document.getElementById('userPhone').value = '';
    document.getElementById('agreeTerms').checked = false;
    document.getElementById('timeSlotsSection').style.display = 'none';
    goToStep(1);
    renderItems();
}

function initEvents() {
    document.getElementById('prevWeek').addEventListener('click', () => {
        if (state.currentWeekOffset > 0) {
            state.currentWeekOffset--;
            renderDateGrid();
        }
    });

    document.getElementById('nextWeek').addEventListener('click', () => {
        const maxOffset = getMaxWeekOffset(state.selectedItem);
        if (state.currentWeekOffset < maxOffset) {
            state.currentWeekOffset++;
            renderDateGrid();
        }
    });

    document.getElementById('backToStep2').addEventListener('click', () => {
        goToStep(2);
    });

    document.getElementById('submitBooking').addEventListener('click', submitBooking);

    document.getElementById('newBooking').addEventListener('click', resetBooking);

    document.getElementById('closeNotice').addEventListener('click', () => {
        document.getElementById('noticeModal').classList.remove('show');
    });

    document.querySelector('.checkbox-group label').addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('noticeModal').classList.add('show');
    });
}

function getStatusText(status) {
    const statusMap = {
        'pending': '待办理',
        'arrived': '已签到',
        'completed': '已完成',
        'cancelled': '已取消',
        'no_show': '已爽约'
    };
    return statusMap[status] || status;
}

function getStatusClass(status) {
    const classMap = {
        'pending': 'status-pending',
        'arrived': 'status-arrived',
        'completed': 'status-completed',
        'cancelled': 'status-cancelled',
        'no_show': 'status-no_show'
    };
    return classMap[status] || '';
}

function openQueryModal() {
    document.getElementById('queryModal').classList.add('show');
    document.getElementById('queryForm').style.display = 'block';
    document.getElementById('queryResult').style.display = 'none';
    document.getElementById('queryId').value = '';
    document.getElementById('queryPhone').value = '';
    state.currentAppointment = null;
}

function closeQueryModal() {
    document.getElementById('queryModal').classList.remove('show');
}

async function submitQuery() {
    const id = document.getElementById('queryId').value.trim();
    const phone = document.getElementById('queryPhone').value.trim();

    if (!id) {
        showToast('请输入预约编号', 'error');
        return;
    }
    if (!phone) {
        showToast('请输入手机号', 'error');
        return;
    }
    if (!/^1[3-9]\d{9}$/.test(phone)) {
        showToast('请输入正确的手机号', 'error');
        return;
    }

    const submitBtn = document.getElementById('submitQuery');
    submitBtn.disabled = true;
    submitBtn.textContent = '查询中...';

    try {
        const res = await fetch(`${API_BASE}/appointments/query?id=${encodeURIComponent(id)}&phone=${encodeURIComponent(phone)}`);
        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || '查询失败');
        }

        state.currentAppointment = data;
        state.currentReview = null;

        const materials = data.material_snapshots || [];

        if (data.status === 'completed') {
            try {
                const reviewRes = await fetch(`${API_BASE}/appointments/${data.id}/review?phone=${encodeURIComponent(phone)}`);
                if (reviewRes.ok) {
                    state.currentReview = await reviewRes.json();
                }
            } catch (e) {
                console.error('加载评价失败', e);
            }
        }

        renderAppointmentDetail(data, materials);

        loadLatestReminderForDetail(data.id, data.phone);

        document.getElementById('queryForm').style.display = 'none';
        document.getElementById('queryResult').style.display = 'block';
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '查询预约';
    }
}

function renderAppointmentDetail(appointment, materials = []) {
    const statusText = getStatusText(appointment.status);
    const statusClass = getStatusClass(appointment.status);

    const item = getItemById(appointment.item_id);
    const canCancel = isCancellationAllowed(appointment, item);
    const canReschedule = isReschedulingAllowed(appointment, item);
    const canReview = appointment.status === 'completed' && !state.currentReview;

    let cancelTip = '';
    let rescheduleTip = '';

    if (appointment.status === 'pending') {
        if (!canCancel) {
            const deadlineHours = item?.cancel_deadline_hours;
            if (deadlineHours !== null && deadlineHours !== undefined && deadlineHours !== '') {
                cancelTip = `<div class="detail-tip detail-tip-muted">⏰ 已超过取消截止时间（预约前 ${deadlineHours} 小时内不可取消）</div>`;
            } else {
                cancelTip = `<div class="detail-tip detail-tip-muted">⏰ 已超过取消时间</div>`;
            }
        } else {
            cancelTip = `<div class="detail-tip">💡 您可以在线取消预约</div>`;
        }

        if (!canReschedule) {
            const deadlineHours = item?.reschedule_deadline_hours;
            if (deadlineHours !== null && deadlineHours !== undefined && deadlineHours !== '') {
                rescheduleTip = `<div class="detail-tip detail-tip-muted">⏰ 已超过改期截止时间（预约前 ${deadlineHours} 小时内不可改期）</div>`;
            } else {
                rescheduleTip = `<div class="detail-tip detail-tip-muted">⏰ 已超过改期时间</div>`;
            }
        } else {
            rescheduleTip = `<div class="detail-tip">💡 您可以在线改期</div>`;
        }
    }

    const materialsHtml = materials.length > 0 ? `
        <div class="detail-materials">
            <div class="detail-materials-title">📋 材料确认清单</div>
            <ul class="detail-materials-list">
                ${materials.map((m, index) => {
                    const matName = m.material_name || m.name;
                    const matDesc = m.material_description !== undefined ? m.material_description : m.description;
                    const isRequired = m.is_required;
                    const needConfirm = m.require_confirmation;
                    const isConfirmed = m.is_confirmed;
                    return `
                        <li class="detail-material-item">
                            <div class="detail-material-header">
                                <span class="detail-material-index">${index + 1}.</span>
                                <span class="detail-material-name">${escapeHtml(matName)}</span>
                                ${isRequired ? '<span class="material-tag material-tag-required">必备</span>' : '<span class="material-tag material-tag-optional">可选</span>'}
                            </div>
                            ${matDesc ? `<div class="detail-material-desc">${escapeHtml(matDesc)}</div>` : ''}
                            ${needConfirm ? `
                                <div class="detail-material-status">
                                    ${isConfirmed 
                                        ? '<span class="material-status-confirmed">✓ 已确认</span>' 
                                        : '<span class="material-status-unconfirmed">✗ 未确认</span>'
                                    }
                                </div>
                            ` : ''}
                        </li>
                    `;
                }).join('')}
            </ul>
        </div>
    ` : '';

    let reviewHtml = '';
    if (state.currentReview) {
        const stars = '★'.repeat(state.currentReview.rating) + '☆'.repeat(5 - state.currentReview.rating);
        reviewHtml = `
            <div class="detail-review">
                <div class="detail-review-title">⭐ 我的评价</div>
                <div class="detail-review-rating">
                    <span class="review-stars">${stars}</span>
                    <span class="review-score">${state.currentReview.rating} 分</span>
                </div>
                ${state.currentReview.feedback ? `<div class="detail-review-feedback">${escapeHtml(state.currentReview.feedback)}</div>` : ''}
                <div class="detail-review-time">评价时间：${state.currentReview.created_at ? state.currentReview.created_at.substring(0, 19) : ''}</div>
            </div>
        `;
    }

    const detailHtml = `
        <div class="detail-header">
            <span class="detail-title">预约详情</span>
            <span class="status-badge ${statusClass}">${statusText}</span>
        </div>
        <div class="detail-body">
            <div class="detail-row">
                <span class="detail-label">预约编号</span>
                <span class="detail-value">${appointment.id}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">办理事项</span>
                <span class="detail-value">${appointment.item_name || ''}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">办理窗口</span>
                <span class="detail-value">${appointment.window_name || '系统分配'}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">预约姓名</span>
                <span class="detail-value">${appointment.user_name}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">联系电话</span>
                <span class="detail-value">${appointment.phone}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">预约日期</span>
                <span class="detail-value">${appointment.appointment_date}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">预约时段</span>
                <span class="detail-value">${appointment.time_slot}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">提交时间</span>
                <span class="detail-value">${appointment.created_at || ''}</span>
            </div>
            ${materialsHtml}
            <div class="detail-reminder" id="detailReminder" style="display:none;">
                <div class="detail-reminder-title">📱 最近提醒</div>
                <div class="detail-reminder-content" id="detailReminderContent"></div>
                <div class="detail-reminder-time" id="detailReminderTime"></div>
            </div>
            ${reviewHtml}
        </div>
        ${rescheduleTip}
        ${cancelTip}
        ${appointment.status === 'cancelled' ? '<div class="detail-tip detail-tip-muted">该预约已取消，号源已释放</div>' : ''}
        ${appointment.status === 'completed' && !state.currentReview ? '<div class="detail-tip">⭐ 您已完成办理，点击下方按钮进行满意度评价</div>' : ''}
        ${appointment.status === 'arrived' ? '<div class="detail-tip detail-tip-muted">该预约已签到，请到窗口办理</div>' : ''}
        ${appointment.status === 'no_show' ? '<div class="detail-tip detail-tip-warning">⚠️ 该预约已被标记为爽约，多次爽约将被限制预约</div>' : ''}
    `;

    document.getElementById('appointmentDetail').innerHTML = detailHtml;

    const rescheduleBtn = document.getElementById('rescheduleAppointmentBtn');
    if (rescheduleBtn) {
        rescheduleBtn.style.display = canReschedule ? 'inline-block' : 'none';
    }

    const cancelBtn = document.getElementById('cancelAppointmentBtn');
    if (canCancel) {
        cancelBtn.style.display = 'block';
    } else {
        cancelBtn.style.display = 'none';
    }

    const reviewBtn = document.getElementById('reviewBtn');
    if (canReview) {
        reviewBtn.style.display = 'block';
    } else {
        reviewBtn.style.display = 'none';
    }
}

async function loadLatestReminderForDetail(appointmentId, phone) {
    try {
        const res = await fetch(`${API_BASE}/reminders/latest?appointment_id=${encodeURIComponent(appointmentId)}`);
        if (res.ok) {
            const data = await res.json();
            const box = document.getElementById('detailReminder');
            const content = document.getElementById('detailReminderContent');
            const time = document.getElementById('detailReminderTime');
            if (box && content && data.content) {
                content.textContent = data.content;
                if (time && data.created_at) {
                    time.textContent = data.created_at.substring(0, 19);
                }
                box.style.display = 'block';
            }
        }
    } catch (e) {
        console.error('加载最新提醒失败', e);
    }
}

function backToQuery() {
    document.getElementById('queryForm').style.display = 'block';
    document.getElementById('queryResult').style.display = 'none';
    state.currentAppointment = null;
    state.currentReview = null;
}

function openReviewModal() {
    if (!state.currentAppointment) return;

    state.currentRating = 0;
    document.getElementById('reviewInfo').innerHTML = `
        <p><strong>预约编号：</strong>${state.currentAppointment.id}</p>
        <p><strong>办理事项：</strong>${state.currentAppointment.item_name || ''}</p>
        <p><strong>办理日期：</strong>${state.currentAppointment.appointment_date} ${state.currentAppointment.time_slot}</p>
    `;

    updateRatingDisplay();
    document.getElementById('reviewFeedback').value = '';
    document.getElementById('feedbackCount').textContent = '0';
    document.getElementById('reviewModal').classList.add('show');
}

function closeReviewModal() {
    document.getElementById('reviewModal').classList.remove('show');
}

function updateRatingDisplay() {
    const stars = document.querySelectorAll('#ratingStars .star');
    const ratingText = document.getElementById('ratingText');

    const ratingTexts = {
        1: '非常不满意',
        2: '不满意',
        3: '一般',
        4: '满意',
        5: '非常满意'
    };

    stars.forEach((star, index) => {
        if (index < state.currentRating) {
            star.textContent = '★';
            star.classList.add('active');
        } else {
            star.textContent = '☆';
            star.classList.remove('active');
        }
    });

    ratingText.textContent = state.currentRating > 0 
        ? `${ratingTexts[state.currentRating]}（${state.currentRating} 分）`
        : '请点击星星评分';
}

function initRatingStars() {
    const stars = document.querySelectorAll('#ratingStars .star');
    stars.forEach(star => {
        star.addEventListener('click', () => {
            state.currentRating = parseInt(star.dataset.rating);
            updateRatingDisplay();
        });

        star.addEventListener('mouseenter', () => {
            const rating = parseInt(star.dataset.rating);
            stars.forEach((s, index) => {
                if (index < rating) {
                    s.textContent = '★';
                } else {
                    s.textContent = '☆';
                }
            });
        });

        star.addEventListener('mouseleave', () => {
            updateRatingDisplay();
        });
    });
}

async function submitReview() {
    if (!state.currentAppointment) return;

    if (state.currentRating < 1) {
        showToast('请选择满意度评分', 'error');
        return;
    }

    const feedback = document.getElementById('reviewFeedback').value.trim();

    const submitBtn = document.getElementById('submitReview');
    submitBtn.disabled = true;
    submitBtn.textContent = '提交中...';

    try {
        const res = await fetch(`${API_BASE}/reviews`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                appointment_id: state.currentAppointment.id,
                phone: state.currentAppointment.phone,
                rating: state.currentRating,
                feedback: feedback
            })
        });

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || '提交失败');
        }

        state.currentReview = {
            id: data.id,
            rating: state.currentRating,
            feedback: feedback,
            created_at: data.created_at
        };

        closeReviewModal();
        showToast('评价提交成功，感谢您的反馈！', 'success');

        if (state.currentAppointment) {
            renderAppointmentDetail(state.currentAppointment);
        }

        setTimeout(() => {
            document.getElementById('reviewSuccessModal').classList.add('show');
        }, 300);
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '提交评价';
    }
}

function openConfirmCancel() {
    document.getElementById('confirmCancelModal').classList.add('show');
}

function closeConfirmCancel() {
    document.getElementById('confirmCancelModal').classList.remove('show');
}

async function confirmCancelAppointment() {
    if (!state.currentAppointment) return;

    const confirmBtn = document.getElementById('confirmCancelBtn');
    confirmBtn.disabled = true;
    confirmBtn.textContent = '取消中...';

    try {
        const res = await fetch(`${API_BASE}/appointments/${state.currentAppointment.id}/cancel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                phone: state.currentAppointment.phone
            })
        });

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || '取消失败');
        }

        showToast('预约已取消，号源已释放', 'success');
        closeConfirmCancel();

        state.currentAppointment.status = 'cancelled';
        renderAppointmentDetail(state.currentAppointment);
        loadLatestReminderForDetail(state.currentAppointment.id, state.currentAppointment.phone);
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        confirmBtn.disabled = false;
        confirmBtn.textContent = '确认取消';
    }
}

function openRescheduleModal() {
    if (!state.currentAppointment) return;

    state.reschedule.weekOffset = 0;
    state.reschedule.selectedDate = null;
    state.reschedule.selectedTimeSlot = null;
    state.reschedule.timeSlots = [];
    document.getElementById('rescheduleReason').value = '';

    document.getElementById('rescheduleStep1').style.display = 'block';
    document.getElementById('rescheduleStep2').style.display = 'none';
    document.getElementById('rescheduleModal').classList.add('show');

    renderCurrentAppointmentInfo();
    renderRescheduleDateGrid();
    updateRescheduleConfirmBtn();
}

function closeRescheduleModal() {
    document.getElementById('rescheduleModal').classList.remove('show');
}

function renderCurrentAppointmentInfo() {
    if (!state.currentAppointment) return;

    const apt = state.currentAppointment;
    document.getElementById('currentAppointmentInfo').innerHTML = `
        <div class="reschedule-info-item">
            <span class="reschedule-info-label">办理事项</span>
            <span class="reschedule-info-value">${escapeHtml(apt.item_name || '')}</span>
        </div>
        <div class="reschedule-info-item">
            <span class="reschedule-info-label">预约日期</span>
            <span class="reschedule-info-value">${apt.appointment_date}</span>
        </div>
        <div class="reschedule-info-item">
            <span class="reschedule-info-label">预约时段</span>
            <span class="reschedule-info-value">${apt.time_slot}</span>
        </div>
        <div class="reschedule-info-item">
            <span class="reschedule-info-label">办理窗口</span>
            <span class="reschedule-info-value">${apt.window_name || '系统分配'}</span>
        </div>
    `;
}

function renderRescheduleDateGrid() {
    const dates = getWeekDates(state.reschedule.weekOffset);
    const weekStart = formatDate(dates[0]);
    const weekEnd = formatDate(dates[6]);
    document.getElementById('rescheduleDateRange').textContent = `${weekStart} ~ ${weekEnd}`;

    const dayNames = ['日', '一', '二', '三', '四', '五', '六'];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const item = state.currentAppointment ? getItemById(state.currentAppointment.item_id) : null;
    const sameDayAllowed = isSameDayReschedulingAllowed(item);
    const maxAdvanceDate = getMaxAdvanceDate(item);

    const container = document.getElementById('rescheduleDateGrid');
    container.innerHTML = dates.map(date => {
        const dateStr = formatDate(date);
        const isPast = date < today;
        const isToday = date.getTime() === today.getTime();
        const isWeekend = date.getDay() === 0 || date.getDay() === 6;
        const isSelected = state.reschedule.selectedDate === dateStr;
        const isSameAsOld = state.currentAppointment && dateStr === state.currentAppointment.appointment_date;
        const isBeyondMax = date > maxAdvanceDate;
        const isSameDayDisabled = isToday && !sameDayAllowed;

        let disabled = isPast || isWeekend || isBeyondMax || isSameDayDisabled || isSameAsOld;

        let classes = 'date-item';
        if (disabled) classes += ' disabled';
        if (isToday) classes += ' today';
        if (isSelected) classes += ' selected';
        if (isSameAsOld) classes += ' same-as-old';

        let title = '';
        if (isSameAsOld) title = '当前预约日期';
        else if (isSameDayDisabled) title = '该事项不支持当天预约';
        else if (isBeyondMax) title = '超出可预约范围';
        else if (isWeekend) title = '周末不可预约';
        else if (isPast) title = '过去的日期不可预约';

        return `
            <div class="${classes}" data-date="${dateStr}" title="${title}">
                <span class="date-day">${isToday ? '今天' : '周' + dayNames[date.getDay()]}</span>
                <span class="date-num">${date.getDate()}</span>
            </div>
        `;
    }).join('');

    container.querySelectorAll('.date-item:not(.disabled)').forEach(item => {
        item.addEventListener('click', () => {
            state.reschedule.selectedDate = item.dataset.date;
            state.reschedule.selectedTimeSlot = null;
            renderRescheduleDateGrid();
            loadRescheduleTimeSlots();
            updateRescheduleConfirmBtn();
        });
    });

    if (state.reschedule.selectedDate) {
        const selectedDateObj = new Date(state.reschedule.selectedDate);
        if (selectedDateObj < today) {
            state.reschedule.selectedDate = null;
            state.reschedule.selectedTimeSlot = null;
        }
    }

    updateRescheduleNavButtons();

    if (state.reschedule.selectedDate) {
        loadRescheduleTimeSlots();
    }
    updateRescheduleConfirmBtn();
}

function updateRescheduleNavButtons() {
    const item = state.currentAppointment ? getItemById(state.currentAppointment.item_id) : null;
    const maxOffset = getMaxWeekOffset(item);

    const prevBtn = document.getElementById('reschedulePrevWeek');
    const nextBtn = document.getElementById('rescheduleNextWeek');

    if (prevBtn) {
        prevBtn.disabled = state.reschedule.weekOffset <= 0;
        prevBtn.style.opacity = state.reschedule.weekOffset <= 0 ? '0.5' : '1';
        prevBtn.style.cursor = state.reschedule.weekOffset <= 0 ? 'not-allowed' : 'pointer';
    }
    if (nextBtn) {
        nextBtn.disabled = state.reschedule.weekOffset >= maxOffset;
        nextBtn.style.opacity = state.reschedule.weekOffset >= maxOffset ? '0.5' : '1';
        nextBtn.style.cursor = state.reschedule.weekOffset >= maxOffset ? 'not-allowed' : 'pointer';
    }
}

async function loadRescheduleTimeSlots() {
    if (!state.currentAppointment || !state.reschedule.selectedDate) return;

    const section = document.getElementById('rescheduleTimeSlotsSection');
    section.style.display = 'block';

    document.getElementById('rescheduleTimeSlots').innerHTML = '<div class="loading">加载时段中...</div>';
    state.reschedule.selectedTimeSlot = null;

    try {
        const res = await fetch(`${API_BASE}/slots/${state.currentAppointment.item_id}/${state.reschedule.selectedDate}`);
        const data = await res.json();

        if (!data.available) {
            document.getElementById('rescheduleTimeSlots').innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📅</div>
                    <p>${data.reason || '该日期不可预约'}</p>
                </div>
            `;
            return;
        }

        if (data.use_time_slots && data.time_slots && data.time_slots.length > 0) {
            state.reschedule.slotMode = 'time';
            state.reschedule.timeSlots = data.time_slots;
            renderRescheduleTimeSlotCapacities(data.time_slots);
        } else {
            state.reschedule.slotMode = 'window';
            state.reschedule.timeSlots = data.time_slots || [];
            renderRescheduleTimeSlots(data.time_slots || []);
        }
    } catch (e) {
        document.getElementById('rescheduleTimeSlots').innerHTML = '<div class="empty-state"><p>加载失败</p></div>';
    }
    updateRescheduleConfirmBtn();
}

function renderRescheduleTimeSlots(slots) {
    const container = document.getElementById('rescheduleTimeSlots');
    
    if (slots.every(s => !s.available)) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">⏰</div>
                <p>今日号源已满，请选择其他日期</p>
            </div>
        `;
        return;
    }

    const currentSlot = state.currentAppointment?.time_slot;
    const isSameDate = state.reschedule.selectedDate === state.currentAppointment?.appointment_date;

    container.innerHTML = slots.map(slot => {
        const isCurrent = isSameDate && slot.time === currentSlot;
        return `
            <div class="time-slot ${!slot.available ? 'disabled' : ''} ${state.reschedule.selectedTimeSlot === slot.time ? 'selected' : ''} ${isCurrent ? 'current-slot' : ''}" 
                 data-time="${slot.time}"
                 title="${isCurrent ? '当前预约时段' : ''}">
                ${slot.time}
                ${isCurrent ? ' (当前)' : ''}
            </div>
        `;
    }).join('');

    container.querySelectorAll('.time-slot:not(.disabled):not(.current-slot)').forEach(item => {
        item.addEventListener('click', () => {
            state.reschedule.selectedTimeSlot = item.dataset.time;
            renderRescheduleTimeSlots(slots);
            updateRescheduleConfirmBtn();
        });
    });
}

function renderRescheduleTimeSlotCapacities(timeSlots) {
    const container = document.getElementById('rescheduleTimeSlots');
    
    const allFull = timeSlots.every(ts => ts.current_count >= ts.max_count);
    if (allFull) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">⏰</div>
                <p>今日号源已满，请选择其他日期</p>
            </div>
        `;
        return;
    }

    const currentSlot = state.currentAppointment?.time_slot;
    const isSameDate = state.reschedule.selectedDate === state.currentAppointment?.appointment_date;

    container.innerHTML = timeSlots.map(ts => {
        const remaining = ts.max_count - ts.current_count;
        const isFull = remaining <= 0;
        const slotKey = `${ts.start_time}-${ts.end_time}`;
        const isSelected = state.reschedule.selectedTimeSlot === slotKey;
        const isCurrent = isSameDate && slotKey === currentSlot;
        
        let classes = 'time-slot-capacity';
        if (isFull) classes += ' disabled';
        if (isSelected) classes += ' selected';
        if (isCurrent) classes += ' current-slot';

        return `
            <div class="${classes}"
                 data-start="${ts.start_time}" data-end="${ts.end_time}" data-key="${slotKey}"
                 title="${isCurrent ? '当前预约时段' : ''}">
                <div class="tsc-time">${ts.start_time} - ${ts.end_time} ${isCurrent ? ' (当前)' : ''}</div>
                <div class="tsc-info">
                    <span class="tsc-remaining ${remaining <= 3 && remaining > 0 ? 'few' : ''}">
                        ${isFull ? '已满' : `剩余 ${remaining} 个`}
                    </span>
                    <span class="tsc-total">共 ${ts.max_count} 个</span>
                </div>
            </div>
        `;
    }).join('');

    container.querySelectorAll('.time-slot-capacity:not(.disabled):not(.current-slot)').forEach(item => {
        item.addEventListener('click', () => {
            const key = item.dataset.key;
            state.reschedule.selectedTimeSlot = key;
            renderRescheduleTimeSlotCapacities(timeSlots);
            updateRescheduleConfirmBtn();
        });
    });
}

function updateRescheduleConfirmBtn() {
    const btn = document.getElementById('confirmRescheduleBtn');
    const hasDate = !!state.reschedule.selectedDate;
    const hasTime = !!state.reschedule.selectedTimeSlot;
    btn.disabled = !(hasDate && hasTime);
}

function openConfirmReschedule() {
    if (!state.reschedule.selectedDate || !state.reschedule.selectedTimeSlot) return;

    const oldDate = state.currentAppointment.appointment_date;
    const oldTime = state.currentAppointment.time_slot;
    const newDate = state.reschedule.selectedDate;
    const newTime = state.reschedule.selectedTimeSlot;

    const infoHtml = `
        <p><strong>原预约：</strong>${oldDate} ${oldTime}</p>
        <p><strong>新预约：</strong>${newDate} ${newTime}</p>
    `;
    document.getElementById('confirmRescheduleInfo').innerHTML = infoHtml;

    document.getElementById('confirmRescheduleModal').classList.add('show');
}

function closeConfirmReschedule() {
    document.getElementById('confirmRescheduleModal').classList.remove('show');
}

async function submitReschedule() {
    if (!state.currentAppointment || !state.reschedule.selectedDate || !state.reschedule.selectedTimeSlot) return;

    const confirmBtn = document.getElementById('confirmRescheduleOkBtn');
    confirmBtn.disabled = true;
    confirmBtn.textContent = '改期中...';

    try {
        const res = await fetch(`${API_BASE}/appointments/${state.currentAppointment.id}/reschedule`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                phone: state.currentAppointment.phone,
                new_date: state.reschedule.selectedDate,
                new_time_slot: state.reschedule.selectedTimeSlot,
                reason: document.getElementById('rescheduleReason').value.trim()
            })
        });

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || '改期失败');
        }

        closeConfirmReschedule();

        state.currentAppointment = data.appointment;

        document.getElementById('rescheduleStep1').style.display = 'none';
        document.getElementById('rescheduleStep2').style.display = 'block';

        const successDetails = document.getElementById('rescheduleSuccessDetails');
        successDetails.innerHTML = `
            <p><strong>预约编号：</strong>${data.appointment.id}</p>
            <p><strong>办理事项：</strong>${data.appointment.item_name || ''}</p>
            <p><strong>办理窗口：</strong>${data.appointment.window_name || '系统分配'}</p>
            <p><strong>预约姓名：</strong>${data.appointment.user_name}</p>
            <p><strong>联系电话：</strong>${data.appointment.phone}</p>
            <p><strong>预约日期：</strong>${data.appointment.appointment_date}</p>
            <p><strong>预约时段：</strong>${data.appointment.time_slot}</p>
        `;

        showToast('改期成功！', 'success');
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        confirmBtn.disabled = false;
        confirmBtn.textContent = '确认改期';
    }
}

function initRescheduleEvents() {
    document.getElementById('rescheduleAppointmentBtn').addEventListener('click', openRescheduleModal);
    document.getElementById('closeRescheduleModal').addEventListener('click', closeRescheduleModal);
    document.getElementById('cancelRescheduleBtn').addEventListener('click', closeRescheduleModal);
    document.getElementById('confirmRescheduleBtn').addEventListener('click', openConfirmReschedule);
    document.getElementById('cancelRescheduleConfirmBtn').addEventListener('click', closeConfirmReschedule);
    document.getElementById('confirmRescheduleOkBtn').addEventListener('click', submitReschedule);
    document.getElementById('rescheduleDoneBtn').addEventListener('click', () => {
        closeRescheduleModal();
        if (state.currentAppointment) {
            renderAppointmentDetail(state.currentAppointment);
            loadLatestReminderForDetail(state.currentAppointment.id, state.currentAppointment.phone);
        }
    });

    document.getElementById('reschedulePrevWeek').addEventListener('click', () => {
        if (state.reschedule.weekOffset > 0) {
            state.reschedule.weekOffset--;
            renderRescheduleDateGrid();
        }
    });

    document.getElementById('rescheduleNextWeek').addEventListener('click', () => {
        const item = state.currentAppointment ? getItemById(state.currentAppointment.item_id) : null;
        const maxOffset = getMaxWeekOffset(item);
        if (state.reschedule.weekOffset < maxOffset) {
            state.reschedule.weekOffset++;
            renderRescheduleDateGrid();
        }
    });

    document.getElementById('rescheduleModal').addEventListener('click', (e) => {
        if (e.target.id === 'rescheduleModal') {
            closeRescheduleModal();
        }
    });

    document.getElementById('confirmRescheduleModal').addEventListener('click', (e) => {
        if (e.target.id === 'confirmRescheduleModal') {
            closeConfirmReschedule();
        }
    });
}

function initQueryEvents() {
    document.getElementById('openQueryBtn').addEventListener('click', openQueryModal);
    document.getElementById('closeQueryModal').addEventListener('click', closeQueryModal);
    document.getElementById('submitQuery').addEventListener('click', submitQuery);
    document.getElementById('backToQuery').addEventListener('click', backToQuery);
    document.getElementById('cancelAppointmentBtn').addEventListener('click', openConfirmCancel);
    document.getElementById('cancelCancelBtn').addEventListener('click', closeConfirmCancel);
    document.getElementById('confirmCancelBtn').addEventListener('click', confirmCancelAppointment);

    document.getElementById('reviewBtn').addEventListener('click', openReviewModal);
    document.getElementById('closeReviewModal').addEventListener('click', closeReviewModal);
    document.getElementById('submitReview').addEventListener('click', submitReview);
    document.getElementById('closeReviewSuccess').addEventListener('click', () => {
        document.getElementById('reviewSuccessModal').classList.remove('show');
    });

    document.getElementById('reviewFeedback').addEventListener('input', (e) => {
        document.getElementById('feedbackCount').textContent = e.target.value.length;
    });

    document.getElementById('queryModal').addEventListener('click', (e) => {
        if (e.target.id === 'queryModal') {
            closeQueryModal();
        }
    });

    document.getElementById('confirmCancelModal').addEventListener('click', (e) => {
        if (e.target.id === 'confirmCancelModal') {
            closeConfirmCancel();
        }
    });

    document.getElementById('reviewModal').addEventListener('click', (e) => {
        if (e.target.id === 'reviewModal') {
            closeReviewModal();
        }
    });

    document.getElementById('reviewSuccessModal').addEventListener('click', (e) => {
        if (e.target.id === 'reviewSuccessModal') {
            document.getElementById('reviewSuccessModal').classList.remove('show');
        }
    });

    document.getElementById('queryId').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            document.getElementById('queryPhone').focus();
        }
    });

    document.getElementById('queryPhone').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            submitQuery();
        }
    });

    initRatingStars();
}

function init() {
    loadItems();
    initEvents();
    initQueryEvents();
    initRescheduleEvents();
}

document.addEventListener('DOMContentLoaded', init);
