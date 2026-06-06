const state = {
    items: [],
    selectedItem: null,
    selectedItemMaterials: [],
    selectedDate: null,
    selectedTimeSlot: null,
    currentWeekOffset: 0,
    currentAppointment: null,
    currentRating: 0,
    currentReview: null
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

    box.innerHTML = state.selectedItemMaterials.map((mat, index) => `
        <div class="material-item-citizen">
            <div class="material-index">${index + 1}</div>
            <div class="material-content">
                <div class="material-name-citizen">${escapeHtml(mat.name)}</div>
                ${mat.description ? `<div class="material-desc-citizen">${escapeHtml(mat.description)}</div>` : ''}
            </div>
        </div>
    `).join('');
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
        <p><strong>办理窗口：</strong>${appointment.window_name || '系统分配'}</p>
        <p><strong>预约姓名：</strong>${appointment.user_name}</p>
        <p><strong>联系电话：</strong>${appointment.phone}</p>
        <p><strong>预约日期：</strong>${appointment.appointment_date}</p>
        <p><strong>预约时段：</strong>${appointment.time_slot}</p>
    `;

    const tips = document.querySelector('.tips');
    let materialsHtml = '';
    if (state.selectedItemMaterials.length > 0) {
        materialsHtml = `
            <p><strong>📋 所需材料清单：</strong></p>
            <ul class="material-tips-list">
                ${state.selectedItemMaterials.map(m => `
                    <li>
                        <span class="tip-material-name">${escapeHtml(m.name)}</span>
                        ${m.description ? `<span class="tip-material-desc">（${escapeHtml(m.description)}）</span>` : ''}
                    </li>
                `).join('')}
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

function getStatusText(status) {
    const statusMap = {
        'pending': '待办理',
        'arrived': '已签到',
        'completed': '已完成',
        'cancelled': '已取消'
    };
    return statusMap[status] || status;
}

function getStatusClass(status) {
    const classMap = {
        'pending': 'status-pending',
        'arrived': 'status-arrived',
        'completed': 'status-completed',
        'cancelled': 'status-cancelled'
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

        let materials = [];
        try {
            const matRes = await fetch(`${API_BASE}/items/${data.item_id}/materials`);
            materials = await matRes.json();
        } catch (e) {
            console.error('加载材料清单失败', e);
        }

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
    const canCancel = appointment.status === 'pending';
    const canReview = appointment.status === 'completed' && !state.currentReview;

    const materialsHtml = materials.length > 0 ? `
        <div class="detail-materials">
            <div class="detail-materials-title">📋 所需材料清单</div>
            <ul class="detail-materials-list">
                ${materials.map(m => `
                    <li>
                        <span class="detail-material-name">${escapeHtml(m.name)}</span>
                        ${m.description ? `<span class="detail-material-desc">${escapeHtml(m.description)}</span>` : ''}
                    </li>
                `).join('')}
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
        ${canCancel ? '<div class="detail-tip">💡 该预约处于待办理状态，您可以在线取消</div>' : ''}
        ${appointment.status === 'cancelled' ? '<div class="detail-tip detail-tip-muted">该预约已取消，号源已释放</div>' : ''}
        ${appointment.status === 'completed' && !state.currentReview ? '<div class="detail-tip">⭐ 您已完成办理，点击下方按钮进行满意度评价</div>' : ''}
        ${appointment.status === 'arrived' ? '<div class="detail-tip detail-tip-muted">该预约已签到，请到窗口办理</div>' : ''}
    `;

    document.getElementById('appointmentDetail').innerHTML = detailHtml;

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
}

document.addEventListener('DOMContentLoaded', init);
