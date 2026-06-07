const API_BASE = '/api';
const REFRESH_INTERVAL = 30 * 1000;

let boardData = null;
let windowBoardData = null;
let currentView = 'item';
let previousCallingIds = new Set();
let previousWindowCallingIds = new Set();
let refreshTimer = null;
let timeTimer = null;

function formatDate(date) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    return `${year}年${month}月${day}日 ${weekdays[date.getDay()]}`;
}

function formatTime(date) {
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}

function updateDateTime() {
    const now = new Date();
    document.getElementById('currentDate').textContent = formatDate(now);
    document.getElementById('currentTime').textContent = formatTime(now);
}

function padNumber(num) {
    return String(num || 0).padStart(3, '0');
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

async function loadBoardData() {
    try {
        const res = await fetch(`${API_BASE}/board/today`);
        const data = await res.json();

        const currentCallingIds = new Set();
        data.items.forEach(item => {
            item.calling.forEach(apt => currentCallingIds.add(apt.id));
        });

        const newCallings = [];
        currentCallingIds.forEach(id => {
            if (!previousCallingIds.has(id)) {
                data.items.forEach(item => {
                    const apt = item.calling.find(a => a.id === id);
                    if (apt) {
                        newCallings.push({ ...apt, item_name: item.item_name });
                    }
                });
            }
        });

        previousCallingIds = currentCallingIds;
        boardData = data;

        renderBoard(data);
        updateLastUpdate();

        if (newCallings.length > 0) {
            showCallingOverlay(newCallings[0]);
        }

    } catch (e) {
        console.error('加载看板数据失败', e);
        document.getElementById('boardContent').innerHTML = `
            <div class="error-state">
                <div class="error-icon">⚠️</div>
                <p>加载失败，请稍后重试</p>
                <button class="btn-retry" onclick="refreshBoard()">重新加载</button>
            </div>
        `;
    }
}

function updateLastUpdate() {
    const now = new Date();
    document.getElementById('lastUpdate').textContent = formatTime(now);
}

function renderBoard(data) {
    document.getElementById('statTotal').textContent = data.summary.total;
    document.getElementById('statCalling').textContent = data.summary.calling;
    document.getElementById('statWaiting').textContent = data.summary.waiting;
    document.getElementById('statCompleted').textContent = data.summary.completed;

    const content = document.getElementById('boardContent');

    if (data.items.length === 0) {
        content.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📋</div>
                <p>今日暂无预约事项</p>
            </div>
        `;
        return;
    }

    const timeSlots = groupByTimeSlot(data);

    if (timeSlots.length === 0) {
        content.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">⏰</div>
                <p>今日暂无预约时段</p>
            </div>
        `;
        return;
    }

    let html = '<div class="time-slots-container">';
    timeSlots.forEach(slot => {
        html += renderTimeSlotCard(slot);
    });
    html += '</div>';

    html += '<div class="items-section">';
    html += '<h2 class="section-header">📋 各事项详情</h2>';
    html += '<div class="items-grid">';
    data.items.forEach(item => {
        html += renderItemCard(item);
    });
    html += '</div>';
    html += '</div>';

    content.innerHTML = html;
}

function groupByTimeSlot(data) {
    const slotMap = new Map();

    data.items.forEach(item => {
        const allApts = [...item.calling, ...item.waiting, ...item.pending, ...item.completed];
        allApts.forEach(apt => {
            const time = apt.time_slot;
            if (!slotMap.has(time)) {
                slotMap.set(time, {
                    time_slot: time,
                    calling: [],
                    waiting: [],
                    pending: [],
                    completed: []
                });
            }
            const slot = slotMap.get(time);
            const aptWithItem = { ...apt, item_name: item.item_name, item_id: item.item_id };
            if (apt.status === 'calling') {
                slot.calling.push(aptWithItem);
            } else if (apt.status === 'arrived') {
                slot.waiting.push(aptWithItem);
            } else if (apt.status === 'pending') {
                slot.pending.push(aptWithItem);
            } else if (apt.status === 'completed') {
                slot.completed.push(aptWithItem);
            }
        });
    });

    const slots = Array.from(slotMap.values()).sort((a, b) => a.time_slot.localeCompare(b.time_slot));
    return slots;
}

function renderTimeSlotCard(slot) {
    const total = slot.calling.length + slot.waiting.length + slot.pending.length + slot.completed.length;
    const hasCalling = slot.calling.length > 0;

    return `
        <div class="time-slot-card ${hasCalling ? 'has-calling' : ''}">
            <div class="time-slot-header">
                <div class="time-slot-time">
                    <span class="time-icon">🕐</span>
                    <span class="time-text">${slot.time_slot}</span>
                </div>
                <div class="time-slot-counts">
                    <span class="count-tag tag-calling">叫号 ${slot.calling.length}</span>
                    <span class="count-tag tag-waiting">等待 ${slot.waiting.length}</span>
                    <span class="count-tag tag-pending">待到场 ${slot.pending.length}</span>
                    <span class="count-tag tag-completed">完成 ${slot.completed.length}</span>
                </div>
            </div>

            <div class="time-slot-body">
                ${slot.calling.length > 0 ? `
                    <div class="slot-calling-section">
                        <div class="slot-section-title">🔔 正在叫号</div>
                        <div class="slot-calling-list">
                            ${slot.calling.map(apt => `
                                <div class="slot-calling-item calling-pulse" data-id="${apt.id}">
                                    <div class="slot-calling-number">${padNumber(apt.queue_number)}</div>
                                    <div class="slot-calling-info">
                                        <div class="slot-calling-name">${escapeHtml(apt.user_name)}</div>
                                        <div class="slot-calling-item-name">${escapeHtml(apt.item_name)}</div>
                                        <div class="slot-calling-window">${escapeHtml(apt.window_name || '系统分配')}</div>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}

                ${slot.waiting.length > 0 ? `
                    <div class="slot-waiting-section">
                        <div class="slot-section-title">📋 等待办理 (${slot.waiting.length})</div>
                        <div class="slot-waiting-list">
                            ${slot.waiting.slice(0, 6).map((apt, idx) => `
                                <div class="slot-waiting-item ${idx < 3 ? 'priority' : ''}">
                                    <span class="slot-waiting-num">${padNumber(apt.queue_number)}</span>
                                    <span class="slot-waiting-name">${escapeHtml(apt.user_name)}</span>
                                    <span class="slot-waiting-item-name">${escapeHtml(apt.item_name)}</span>
                                </div>
                            `).join('')}
                            ${slot.waiting.length > 6 ? `
                                <div class="slot-waiting-more">还有 ${slot.waiting.length - 6} 人...</div>
                            ` : ''}
                        </div>
                    </div>
                ` : ''}

                ${slot.pending.length > 0 ? `
                    <div class="slot-pending-section">
                        <div class="slot-section-title">⏳ 待到场 (${slot.pending.length})</div>
                        <div class="slot-pending-list">
                            ${slot.pending.slice(0, 4).map(apt => `
                                <div class="slot-pending-item">
                                    <span class="slot-pending-num">${padNumber(apt.queue_number)}</span>
                                    <span class="slot-pending-name">${escapeHtml(apt.user_name)}</span>
                                    <span class="slot-pending-item-name">${escapeHtml(apt.item_name)}</span>
                                </div>
                            `).join('')}
                            ${slot.pending.length > 4 ? `
                                <div class="slot-pending-more">还有 ${slot.pending.length - 4} 人未到场</div>
                            ` : ''}
                        </div>
                    </div>
                ` : ''}

                ${slot.completed.length > 0 ? `
                    <div class="slot-completed-section">
                        <div class="slot-section-title">✅ 已完成 (${slot.completed.length})</div>
                        <div class="slot-completed-list">
                            ${slot.completed.slice(0, 5).map(apt => `
                                <div class="slot-completed-item">
                                    <span class="slot-completed-num">${padNumber(apt.queue_number)}</span>
                                    <span class="slot-completed-name">${escapeHtml(apt.user_name)}</span>
                                    <span class="slot-completed-item-name">${escapeHtml(apt.item_name)}</span>
                                </div>
                            `).join('')}
                            ${slot.completed.length > 5 ? `
                                <div class="slot-completed-more">还有 ${slot.completed.length - 5} 人已完成</div>
                            ` : ''}
                        </div>
                    </div>
                ` : ''}

                ${total === 0 ? `
                    <div class="slot-empty">该时段暂无预约</div>
                ` : ''}
            </div>
        </div>
    `;
}

function renderItemCard(item) {
    const hasCalling = item.calling.length > 0;
    const waitingList = item.waiting.slice(0, 6);
    const hasMoreWaiting = item.waiting.length > 6;

    return `
        <div class="item-card ${hasCalling ? 'has-calling' : ''}">
            <div class="item-card-header">
                <h3 class="item-name">${escapeHtml(item.item_name)}</h3>
                <div class="item-counts">
                    <span class="count-badge count-calling">叫号 ${item.calling.length}</span>
                    <span class="count-badge count-waiting">等待 ${item.waiting.length}</span>
                    <span class="count-badge count-completed">完成 ${item.completed.length}</span>
                </div>
            </div>

            <div class="item-card-body">
                ${hasCalling ? `
                    <div class="calling-section">
                        <div class="section-title">🔔 正在叫号</div>
                        <div class="calling-list">
                            ${item.calling.map(apt => `
                                <div class="calling-item calling-pulse" data-id="${apt.id}">
                                    <div class="calling-number-big">${padNumber(apt.queue_number)}</div>
                                    <div class="calling-info">
                                        <div class="calling-name">${escapeHtml(apt.user_name)}</div>
                                        <div class="calling-time">${apt.time_slot} 时段</div>
                                        <div class="calling-window">${escapeHtml(apt.window_name || '系统分配')}</div>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : `
                    <div class="no-calling">
                        <div class="no-calling-icon">⏸</div>
                        <div class="no-calling-text">暂无叫号</div>
                    </div>
                `}

                <div class="waiting-section">
                    <div class="section-title">📋 等待列表</div>
                    ${waitingList.length > 0 ? `
                        <div class="waiting-list">
                            ${waitingList.map((apt, index) => `
                                <div class="waiting-item ${index < 3 ? 'waiting-priority' : ''}">
                                    <span class="waiting-number">${padNumber(apt.queue_number)}</span>
                                    <span class="waiting-name">${escapeHtml(apt.user_name)}</span>
                                    <span class="waiting-time">${apt.time_slot}</span>
                                </div>
                            `).join('')}
                            ${hasMoreWaiting ? `
                                <div class="waiting-more">还有 ${item.waiting.length - 6} 人等待...</div>
                            ` : ''}
                        </div>
                    ` : `
                        <div class="no-waiting">暂无等待</div>
                    `}
                </div>
            </div>
        </div>
    `;
}

function showCallingOverlay(apt) {
    const overlay = document.getElementById('callingOverlay');
    const numberEl = document.getElementById('overlayNumber');
    const itemEl = document.getElementById('overlayItem');
    const windowEl = document.getElementById('overlayWindow');
    const nameEl = document.getElementById('overlayName');

    numberEl.textContent = padNumber(apt.queue_number);
    itemEl.textContent = apt.item_name;
    if (windowEl) {
        windowEl.textContent = apt.window_name || '系统分配';
    }
    nameEl.textContent = `请 ${apt.user_name} 前往${apt.window_name || '窗口'}办理`;

    overlay.classList.remove('hidden');

    setTimeout(() => {
        overlay.classList.add('hidden');
    }, 5000);
}

function refreshBoard() {
    if (currentView === 'item') {
        loadBoardData();
    } else {
        loadWindowBoardData();
    }
}

function switchView(view) {
    if (currentView === view) return;

    currentView = view;

    document.querySelectorAll('.btn-view').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === view);
    });

    if (view === 'item') {
        loadBoardData();
    } else {
        loadWindowBoardData();
    }
}

async function loadWindowBoardData() {
    try {
        const res = await fetch(`${API_BASE}/board/windows`);
        const data = await res.json();

        const currentCallingIds = new Set();
        data.windows.forEach(w => {
            if (w.current_calling) {
                currentCallingIds.add(w.current_calling.id);
            }
        });

        const newCallings = [];
        currentCallingIds.forEach(id => {
            if (!previousWindowCallingIds.has(id)) {
                data.windows.forEach(w => {
                    if (w.current_calling && w.current_calling.id === id) {
                        newCallings.push({ 
                            ...w.current_calling, 
                            window_name: w.window_name,
                            item_name: w.current_calling.item_name || ''
                        });
                    }
                });
            }
        });

        previousWindowCallingIds = currentCallingIds;
        windowBoardData = data;

        renderWindowBoard(data);
        updateLastUpdate();

        if (newCallings.length > 0) {
            showCallingOverlay(newCallings[0]);
        }

    } catch (e) {
        console.error('加载窗口看板数据失败', e);
        document.getElementById('boardContent').innerHTML = `
            <div class="error-state">
                <div class="error-icon">⚠️</div>
                <p>加载失败，请稍后重试</p>
                <button class="btn-retry" onclick="refreshBoard()">重新加载</button>
            </div>
        `;
    }
}

function renderWindowBoard(data) {
    document.getElementById('statTotal').textContent = data.windows.reduce((sum, w) => sum + w.total_count, 0);
    document.getElementById('statCalling').textContent = data.summary.calling;
    document.getElementById('statWaiting').textContent = data.summary.waiting;
    document.getElementById('statCompleted').textContent = data.summary.completed;

    const content = document.getElementById('boardContent');

    if (data.windows.length === 0) {
        content.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">🪟</div>
                <p>暂无可用窗口</p>
            </div>
        `;
        return;
    }

    let html = '<div class="windows-grid">';
    data.windows.forEach(win => {
        html += renderWindowCard(win);
    });
    html += '</div>';

    content.innerHTML = html;
}

function renderWindowCard(win) {
    const hasCalling = !!win.current_calling;
    const waitingCount = win.waiting_count;

    return `
        <div class="window-card ${hasCalling ? 'has-calling' : ''}">
            <div class="window-card-header">
                <h3 class="window-name">${escapeHtml(win.window_name)}</h3>
                <div class="window-counts">
                    <span class="count-badge count-calling">叫号 ${hasCalling ? 1 : 0}</span>
                    <span class="count-badge count-waiting">等待 ${waitingCount}</span>
                    <span class="count-badge count-completed">完成 ${win.completed_count}</span>
                </div>
            </div>

            <div class="window-card-body">
                ${hasCalling ? `
                    <div class="calling-section">
                        <div class="section-title">🔔 正在叫号</div>
                        <div class="calling-list">
                            <div class="calling-item calling-pulse" data-id="${win.current_calling.id}">
                                <div class="calling-number-big">${padNumber(win.current_calling.queue_number)}</div>
                                <div class="calling-info">
                                    <div class="calling-name">${escapeHtml(win.current_calling.user_name)}</div>
                                    <div class="calling-time">${win.current_calling.time_slot} 时段</div>
                                    <div class="calling-item-name">${escapeHtml(win.current_calling.item_name || '')}</div>
                                </div>
                            </div>
                        </div>
                    </div>
                ` : `
                    <div class="no-calling">
                        <div class="no-calling-icon">⏸</div>
                        <div class="no-calling-text">暂无叫号</div>
                    </div>
                `}

                <div class="waiting-section">
                    <div class="section-title">📋 等待列表 (${waitingCount})</div>
                    ${waitingCount > 0 ? `
                        <div class="waiting-mini-list">
                            <span class="waiting-hint">还有 ${waitingCount} 人等待</span>
                        </div>
                    ` : `
                        <div class="no-waiting">暂无等待</div>
                    `}
                </div>
            </div>
        </div>
    `;
}

function startAutoRefresh() {
    if (refreshTimer) {
        clearInterval(refreshTimer);
    }
    refreshTimer = setInterval(() => {
        if (currentView === 'item') {
            loadBoardData();
        } else {
            loadWindowBoardData();
        }
    }, REFRESH_INTERVAL);
}

function startTimeUpdate() {
    updateDateTime();
    timeTimer = setInterval(updateDateTime, 1000);
}

function init() {
    startTimeUpdate();
    loadBoardData();
    startAutoRefresh();
}

window.refreshBoard = refreshBoard;
window.switchView = switchView;

document.addEventListener('DOMContentLoaded', init);
