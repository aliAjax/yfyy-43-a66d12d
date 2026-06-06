const API_BASE = '/api';
const REFRESH_INTERVAL = 30 * 1000;

let boardData = null;
let previousCallingIds = new Set();
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

    let html = '<div class="items-grid">';

    data.items.forEach(item => {
        html += renderItemCard(item);
    });

    html += '</div>';
    content.innerHTML = html;
}

function renderItemCard(item) {
    const hasCalling = item.calling.length > 0;
    const waitingList = item.waiting.slice(0, 8);
    const hasMoreWaiting = item.waiting.length > 8;

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
                                <div class="waiting-more">还有 ${item.waiting.length - 8} 人等待...</div>
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
    const nameEl = document.getElementById('overlayName');

    numberEl.textContent = padNumber(apt.queue_number);
    itemEl.textContent = apt.item_name;
    nameEl.textContent = `请 ${apt.user_name} 前往窗口办理`;

    overlay.classList.remove('hidden');

    setTimeout(() => {
        overlay.classList.add('hidden');
    }, 5000);
}

function refreshBoard() {
    loadBoardData();
}

function startAutoRefresh() {
    if (refreshTimer) {
        clearInterval(refreshTimer);
    }
    refreshTimer = setInterval(() => {
        loadBoardData();
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

document.addEventListener('DOMContentLoaded', init);
