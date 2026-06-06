const state = {
    items: [],
    selectedItem: null,
    selectedDate: null,
    selectedTimeSlot: null,
    currentWeekOffset: 0
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
        card.addEventListener('click', () => {
            const id = parseInt(card.dataset.id);
            state.selectedItem = state.items.find(i => i.id === id);
            renderItems();
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

function renderDateGrid() {
    const dates = getWeekDates(state.currentWeekOffset);
    const weekStart = formatDate(dates[0]);
    const weekEnd = formatDate(dates[6]);
    document.getElementById('dateRange').textContent = `${weekStart} ~ ${weekEnd}`;

    const dayNames = ['日', '一', '二', '三', '四', '五', '六'];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const container = document.getElementById('dateGrid');
    container.innerHTML = dates.map(date => {
        const dateStr = formatDate(date);
        const isPast = date < today;
        const isWeekend = date.getDay() === 0 || date.getDay() === 6;
        const isToday = formatDate(date) === formatDate(today);
        const isSelected = state.selectedDate === dateStr;

        let classes = 'date-item';
        if (isPast) classes += ' disabled';
        if (isWeekend) classes += ' disabled';
        if (isToday) classes += ' today';
        if (isSelected) classes += ' selected';

        return `
            <div class="${classes}" data-date="${dateStr}">
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

    if (state.selectedDate) {
        loadTimeSlots();
    }
}

async function loadTimeSlots() {
    if (!state.selectedItem || !state.selectedDate) return;

    const section = document.getElementById('timeSlotsSection');
    section.style.display = 'block';

    document.getElementById('timeSlots').innerHTML = '<div class="loading">加载时段中...</div>';

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

        renderTimeSlots(data.time_slots);
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

function renderBookingSummary() {
    const summary = document.getElementById('bookingSummary');
    summary.innerHTML = `
        <p><strong>办理事项：</strong>${state.selectedItem?.name || ''}</p>
        <p><strong>预约日期：</strong>${state.selectedDate || ''}</p>
        <p><strong>预约时段：</strong>${state.selectedTimeSlot || ''}</p>
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
                time_slot: state.selectedTimeSlot
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
        <p><strong>预约姓名：</strong>${appointment.user_name}</p>
        <p><strong>联系电话：</strong>${appointment.phone}</p>
        <p><strong>预约日期：</strong>${appointment.appointment_date}</p>
        <p><strong>预约时段：</strong>${appointment.time_slot}</p>
    `;
}

function resetBooking() {
    state.selectedItem = null;
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
        if (state.currentWeekOffset < 4) {
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

function init() {
    loadItems();
    initEvents();
}

document.addEventListener('DOMContentLoaded', init);
