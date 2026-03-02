const $ = (id) => document.getElementById(id);

const state = {
  token: localStorage.getItem('dashboardToken') || '',
  oauthEnabled: false,
  authUser: null,
  technicalLead: false,
  technicalLeadGuilds: [],
  operationsManager: false,
  guildId: '',
  data: null,
  masterData: null,
  masterActorsByGuild: {},
  selectedOpsTicketNos: new Set(),
  qrPollingTimer: null,
  refreshTimer: null,
  erpData: null,
  erpEditingRowId: '',
  erpSheet: localStorage.getItem('erp.sheet') || 'work_list',
  erpFilters: {
    status: '',
    column: 'all',
    keyword: ''
  },
  erpLastCheckedIndex: -1,
  erpSelectedRowIds: new Set(),
  activeTab: 'overview'
};

if (state.token) $('token').value = state.token;

$('endpointHint').textContent = `현재 대시보드 엔드포인트: ${window.location.origin}`;

function setStatus(message, type = 'info') {
  const el = $('statusText');
  el.textContent = message;
  el.style.borderColor = type === 'error' ? 'rgba(209, 58, 73, 0.45)' : 'rgba(255, 255, 255, 0.25)';
  el.style.color = type === 'error' ? '#ffd9de' : '#dbe9ff';
}

function setLastSync() {
  const d = new Date();
  $('lastSync').textContent = `마지막 동기화: ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function stopQrPolling() {
  if (state.qrPollingTimer) {
    clearInterval(state.qrPollingTimer);
    state.qrPollingTimer = null;
  }
}

async function startQrPolling(qrSessionId) {
  stopQrPolling();
  state.qrPollingTimer = setInterval(async () => {
    try {
      const res = await fetch(`/api/auth/qr/status?qrSessionId=${encodeURIComponent(qrSessionId)}`, {
        credentials: 'same-origin'
      });
      if (!res.ok) {
        return;
      }
      const data = await res.json();
      if (!data || data.status === 'pending') {
        return;
      }
      stopQrPolling();
      if (data.status === 'approved') {
        $('qrModal').style.display = 'none';
        await loadAuthUser();
        if (hasDashboardAccess()) {
          await loadGuilds();
          await loadData();
          restartAutoRefresh();
          setStatus('QR 로그인 완료');
        }
        return;
      }
      if (data.status === 'expired') {
        $('qrModal').style.display = 'none';
        setStatus('QR 로그인 시간이 만료되었습니다. 다시 시도하세요.', 'error');
      }
    } catch (_error) {}
  }, 2000);
}

function authHeaders() {
  const headers = { 'content-type': 'application/json' };
  if (state.token) {
    headers['x-dashboard-token'] = state.token;
  }
  return headers;
}

function masterAuthHeaders() {
  return { 'content-type': 'application/json' };
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    credentials: 'same-origin',
    headers: {
      ...(options.headers || {}),
      ...authHeaders()
    }
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt || `HTTP ${res.status}`);
  }
  return res.json();
}

async function apiMaster(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    credentials: 'same-origin',
    headers: {
      ...(options.headers || {}),
      ...masterAuthHeaders()
    }
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt || `HTTP ${res.status}`);
  }
  return res.json();
}

function buildDiscordLoginUrl() {
  const loginPath = $('discordLoginBtn').dataset.loginPath || '/auth/discord/start';
  const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const loginUrl = new URL(loginPath, window.location.origin);
  loginUrl.searchParams.set('returnTo', returnTo);
  return loginUrl.toString();
}

async function loadAuthConfig() {
  try {
    const res = await fetch('/api/auth/discord/config');
    if (!res.ok) {
      return;
    }
    const data = await res.json();
    state.oauthEnabled = !!data.enabled;
    $('discordLoginBtn').style.display = '';
    $('discordQrBtn').style.display = '';
    $('discordLogoutBtn').style.display = '';
    $('discordLoginBtn').disabled = false;
    $('discordLogoutBtn').disabled = false;
    $('discordLoginBtn').style.opacity = '1';
    $('discordQrBtn').style.opacity = '1';
    $('discordLogoutBtn').style.opacity = '1';
    $('discordLoginBtn').dataset.loginPath = data.loginPath || '/auth/discord/start';
  } catch (_error) {
    state.oauthEnabled = false;
    $('discordLoginBtn').style.display = '';
    $('discordQrBtn').style.display = '';
    $('discordLogoutBtn').style.display = '';
    $('discordLoginBtn').disabled = false;
    $('discordLogoutBtn').disabled = false;
    $('discordLoginBtn').style.opacity = '1';
    $('discordQrBtn').style.opacity = '1';
    $('discordLogoutBtn').style.opacity = '1';
  }
}

function applyAuthUserToInputs() {
  const userId = state.authUser && state.authUser.id ? state.authUser.id : '';
  if (userId) {
    $('embedRequesterUserId').value = userId;
    $('resequenceRequesterUserId').value = userId;
    $('embedRequesterUserId').readOnly = true;
    $('resequenceRequesterUserId').readOnly = true;
  } else {
    $('embedRequesterUserId').readOnly = false;
    $('resequenceRequesterUserId').readOnly = false;
  }
}

function renderAuthStatus() {
  if (state.authUser && state.authUser.id) {
    const label = state.authUser.globalName || state.authUser.username || state.authUser.id;
    const leadText = state.technicalLead ? 'Technical Lead' : 'General User';
    $('authUserText').textContent = `로그인됨: ${label} (${state.authUser.id}) · ${leadText}`;
    $('discordLoginBtn').style.display = 'none';
    $('discordQrBtn').style.display = 'none';
    $('discordLogoutBtn').style.display = '';
  } else {
    $('authUserText').textContent = state.oauthEnabled ? 'Discord 로그인 필요' : 'Discord OAuth 미설정';
    $('discordLoginBtn').style.display = '';
    $('discordQrBtn').style.display = '';
    $('discordLogoutBtn').style.display = '';
    $('discordLoginBtn').disabled = false;
    $('discordQrBtn').disabled = false;
    $('discordLogoutBtn').disabled = false;
    $('discordLoginBtn').style.opacity = '1';
    $('discordQrBtn').style.opacity = '1';
    $('discordLogoutBtn').style.opacity = '1';
  }
  const leadGuildText = state.technicalLeadGuilds.length
    ? state.technicalLeadGuilds.map((g) => g.guildName).join(', ')
    : '없음';
  if ($('masterLeadMatchInfo')) {
    $('masterLeadMatchInfo').textContent = `Technical Lead 매칭 길드: ${leadGuildText}`;
  }
  updateTabPermissions();
  applyDashboardVisibility();
  applyAuthUserToInputs();
}

function updateTabPermissions() {
  const canMaster = !!state.technicalLead;
  const canOps = !!state.operationsManager;

  $('masterTabBtn').disabled = !canMaster;
  $('masterTabBtn').style.opacity = canMaster ? '1' : '0.5';
  $('opsTabBtn').disabled = !canOps;
  $('opsTabBtn').style.opacity = canOps ? '1' : '0.5';

  if (state.activeTab === 'master' && !canMaster) {
    switchTab('overview');
  }
  if (state.activeTab === 'ops' && !canOps) {
    switchTab('overview');
  }
}

function isOauthLoginRequired() {
  return state.oauthEnabled;
}

function hasDashboardAccess() {
  if (isOauthLoginRequired()) {
    return !!(state.authUser && state.authUser.id);
  }
  return !!state.token;
}

function applyDashboardVisibility() {
  const authed = hasDashboardAccess();
  const showTokenUi = !isOauthLoginRequired();

  $('tabsRow').style.display = authed ? '' : 'none';
  $('tokenRow').style.display = authed ? '' : 'none';
  $('syncRow').style.display = authed ? '' : 'none';
  $('tokenHelp').style.display = showTokenUi ? '' : 'none';
  $('token').style.display = showTokenUi ? '' : 'none';
  $('saveToken').style.display = showTokenUi ? '' : 'none';
  $('overviewSection').style.display = authed && state.activeTab === 'overview' ? '' : 'none';
  $('opsSection').style.display = authed && state.activeTab === 'ops' ? '' : 'none';
  $('erpSection').style.display = authed && state.activeTab === 'erp' ? '' : 'none';
  $('masterSection').style.display = authed && state.activeTab === 'master' ? '' : 'none';
}

async function loadAuthUser() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (!res.ok) {
      state.authUser = null;
      renderAuthStatus();
      return;
    }
    const data = await res.json();
    state.authUser = data && data.user ? data.user : null;
    state.technicalLead = !!(data && data.technicalLead);
    state.technicalLeadGuilds = Array.isArray(data && data.technicalLeadGuilds) ? data.technicalLeadGuilds : [];
    if (!state.authUser) {
      state.operationsManager = false;
    }
    renderAuthStatus();
  } catch (_error) {
    state.authUser = null;
    state.technicalLead = false;
    state.technicalLeadGuilds = [];
    state.operationsManager = false;
    renderAuthStatus();
  }
}

function fmt(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function escapeHtml(input) {
  return String(input || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatTicketDetails(ticket) {
  const answers = Array.isArray(ticket && ticket.intake) ? ticket.intake : [];
  if (!answers.length) return '-';
  return answers
    .map((x) => `<div><strong>${escapeHtml(x.label || 'Field')}:</strong> ${escapeHtml(x.value || '-')}</div>`)
    .join('');
}

function guildStorageKey(key) {
  return `dashboard.${key}.${state.guildId || 'global'}`;
}

function fillSelect(el, rows, labelKey = 'name', emptyText = '선택 가능한 항목 없음', preferredValue = '') {
  const previousValue = el.value;
  el.innerHTML = '';

  if (!rows || rows.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = emptyText;
    el.appendChild(opt);
    el.disabled = true;
    return;
  }

  el.disabled = false;
  for (const row of rows) {
    const opt = document.createElement('option');
    opt.value = row.id;
    opt.textContent = row[labelKey] || row.id;
    el.appendChild(opt);
  }

  const wantedValue = preferredValue || previousValue;
  if (wantedValue && rows.some((row) => String(row.id) === String(wantedValue))) {
    el.value = wantedValue;
  } else {
    el.value = rows[0].id;
  }
}

function fillMultiSelect(el, rows, labelKey = 'name', emptyText = '항목 없음', selectedValues = []) {
  el.innerHTML = '';
  const selectedSet = new Set((selectedValues || []).map((x) => String(x)));
  if (!rows || rows.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = emptyText;
    opt.disabled = true;
    el.appendChild(opt);
    return;
  }
  for (const row of rows) {
    const opt = document.createElement('option');
    opt.value = row.id;
    opt.textContent = row[labelKey] || row.id;
    if (selectedSet.has(String(row.id))) {
      opt.selected = true;
    }
    el.appendChild(opt);
  }
}

function selectedValues(el) {
  return Array.from(el.selectedOptions || []).map((opt) => String(opt.value || '')).filter(Boolean);
}

function renderMasterIssuerStats(stats) {
  const tbody = $('masterIssuerStatsTable').querySelector('tbody');
  tbody.innerHTML = '';
  const rows = Array.isArray(stats) ? stats : [];
  if (rows.length === 0) {
    renderEmptyRow(tbody, 7, '티켓 발행 통계가 없습니다.');
    return;
  }
  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(row.ownerName || row.ownerId || '-')}<br><span class="fine">${escapeHtml(row.ownerId || '')}</span></td><td>${escapeHtml(row.ownerRole || '@everyone')}</td><td>${row.job || 0}</td><td>${row.material_use || 0}</td><td>${row.defected_material || 0}</td><td>${row.general || 0}</td><td><strong>${row.total || 0}</strong></td>`;
    tbody.appendChild(tr);
  }
}

function renderMasterDeletedTickets(items) {
  const rows = Array.isArray(items) ? items : [];
  const options = rows.map((row) => {
    const no = Number.parseInt(String(row.deletedTicketNo || ''), 10);
    const owner = row.ownerTag || row.ownerId || '-';
    const type = row.ticketTypeLabel || row.ticketType || 'Ticket';
    const deletedAt = row.deletedAt ? fmt(row.deletedAt) : '-';
    return {
      id: String(no),
      name: `#${no} | ${type} | ${owner} | deleted: ${deletedAt}`
    };
  });
  fillMultiSelect($('masterDeletedTicketMulti'), options, 'name', '복구 가능한 삭제 티켓 없음');
}

function renderMasterErpAuditRows(rows) {
  const tbody = $('masterErpAuditTable').querySelector('tbody');
  tbody.innerHTML = '';
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    renderEmptyRow(tbody, 6, 'ERP 변경 로그가 없습니다.');
    return;
  }
  for (const row of list) {
    const detailText = escapeHtml(JSON.stringify(row.detail || {}));
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${fmt(row.at)}</td><td>${escapeHtml(row.sheetKey || '-')}</td><td>${row.rowNo || '-'}</td><td>${escapeHtml(row.action || '-')}</td><td>${escapeHtml(row.actorName || row.actorUserId || '-')}<br><span class="fine">${escapeHtml(row.actorUserId || '')}</span></td><td><code>${detailText}</code></td>`;
    tbody.appendChild(tr);
  }
}

function renderEmptyRow(tbody, colCount, text) {
  const tr = document.createElement('tr');
  tr.innerHTML = `<td colspan="${colCount}" class="muted-cell">${text}</td>`;
  tbody.appendChild(tr);
}

function ticketStatusChip(t) {
  return '<span class="chip warn">Open</span>';
}

function historyStatusChip(status) {
  if (status === 'closed') {
    return '<span class="chip ok">Closed</span>';
  }
  return '<span class="chip warn">Open</span>';
}

function buildHistoryRows(openTickets, closedTickets) {
  const openRows = (openTickets || []).map((t) => ({
    ...t,
    historyStatus: 'open',
    openedAt: Number(t.createdAt) || 0,
    closedAt: 0,
    historyTime: Number(t.createdAt) || 0
  }));
  const closedRows = (closedTickets || []).map((t) => ({
    ...t,
    historyStatus: 'closed',
    openedAt: Number(t.createdAt) || 0,
    closedAt: Number(t.closedAt) || 0,
    historyTime: Number(t.closedAt || t.createdAt) || 0
  }));
  return openRows.concat(closedRows).sort((a, b) => (b.historyTime || 0) - (a.historyTime || 0));
}

function switchTab(tab) {
  if (!hasDashboardAccess()) {
    state.activeTab = 'overview';
    $('overviewTabBtn').classList.add('active');
    $('opsTabBtn').classList.remove('active');
    $('erpTabBtn').classList.remove('active');
    $('masterTabBtn').classList.remove('active');
    $('overviewSection').style.display = 'none';
    $('opsSection').style.display = 'none';
    $('erpSection').style.display = 'none';
    $('masterSection').style.display = 'none';
    applyDashboardVisibility();
    return;
  }
  state.activeTab = tab;
  $('overviewSection').style.display = tab === 'overview' ? '' : 'none';
  $('opsSection').style.display = tab === 'ops' ? '' : 'none';
  $('erpSection').style.display = tab === 'erp' ? '' : 'none';
  $('masterSection').style.display = tab === 'master' ? '' : 'none';
  $('overviewTabBtn').classList.toggle('active', tab === 'overview');
  $('opsTabBtn').classList.toggle('active', tab === 'ops');
  $('erpTabBtn').classList.toggle('active', tab === 'erp');
  $('masterTabBtn').classList.toggle('active', tab === 'master');
  applyDashboardVisibility();
}

function getFilteredHistoryTickets(list) {
  const type = $('historyType').value;
  const search = $('historySearch').value.trim().toLowerCase();
  return (list || []).filter((t) => {
    if (type !== 'all' && t.ticketType !== type) return false;
    if (!search) return true;
    const target = [t.ownerTag, t.ownerId, t.channelName, t.closeReason, t.ticketTypeLabel, t.historyStatus]
      .concat((Array.isArray(t.intake) ? t.intake : []).map((x) => `${x.label || ''} ${x.value || ''}`))
      .map((x) => String(x || '').toLowerCase())
      .join(' ');
    return target.includes(search);
  });
}

function renderOverviewTables() {
  const openBody = $('openTable').querySelector('tbody');
  const closedBody = $('closedTable').querySelector('tbody');
  const userBody = $('userRoleTable').querySelector('tbody');
  const roleBody = $('rolePriorityTable').querySelector('tbody');
  openBody.innerHTML = '';
  closedBody.innerHTML = '';
  userBody.innerHTML = '';
  roleBody.innerHTML = '';

  const openTickets = state.data.openTickets || [];
  const closedTickets = state.data.closedTickets || [];
  const historyRows = buildHistoryRows(openTickets, closedTickets);
  const filteredHistory = getFilteredHistoryTickets(historyRows);

  $('openCount').textContent = String(openTickets.length);
  $('closedCount').textContent = String(closedTickets.length);

  if (!openTickets.length) {
    renderEmptyRow(openBody, 7, '열린 티켓이 없습니다.');
  } else {
    for (const t of openTickets) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${t.ticketNo || '-'}</td><td>${escapeHtml(t.ticketTypeLabel)}</td><td>${ticketStatusChip(t)}</td><td>${escapeHtml(t.ownerTag || t.ownerId)}</td><td>${escapeHtml(t.channelName)}</td><td>${formatTicketDetails(t)}</td><td>${fmt(t.createdAt)}</td>`;
      openBody.appendChild(tr);
    }
  }

  if (!filteredHistory.length) {
    renderEmptyRow(closedBody, 8, '조건에 맞는 티켓 이력이 없습니다.');
  } else {
    for (const t of filteredHistory) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${t.ticketNo || '-'}</td><td>${escapeHtml(t.ticketTypeLabel)}</td><td>${historyStatusChip(t.historyStatus)}</td><td>${escapeHtml(t.ownerTag || t.ownerId)}</td><td>${fmt(t.openedAt)}</td><td>${t.historyStatus === 'closed' ? fmt(t.closedAt) : '-'}</td><td>${formatTicketDetails(t)}</td><td>${escapeHtml(t.historyStatus === 'closed' ? (t.closeReason || '-') : '-')}</td>`;
      closedBody.appendChild(tr);
    }
  }

  const memberRows = state.data.memberRoleRows || [];
  if (!memberRows.length) {
    renderEmptyRow(userBody, 3, '사용자 정보가 없습니다.');
  } else {
    for (const m of memberRows) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(m.displayName || m.username)}<br><span class="fine">${escapeHtml(m.userId)}</span></td><td>${escapeHtml(m.highestRoleName || '@everyone')}</td><td>${escapeHtml((m.roles || []).join(', ') || '@everyone')}</td>`;
      userBody.appendChild(tr);
    }
  }

  const roles = state.data.roleOptions || [];
  if (!roles.length) {
    renderEmptyRow(roleBody, 2, '역할 정보가 없습니다.');
  } else {
    for (const r of roles) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.id)}</td>`;
      roleBody.appendChild(tr);
    }
  }
}

function renderOperationsHistoryTable() {
  const tbody = $('opsHistoryTable').querySelector('tbody');
  tbody.innerHTML = '';
  const openTickets = state.data && state.data.openTickets ? state.data.openTickets : [];
  const closedTickets = state.data && state.data.closedTickets ? state.data.closedTickets : [];
  const historyRows = buildHistoryRows(openTickets, closedTickets);
  const validNos = new Set(
    historyRows
      .map((t) => Number.parseInt(t.ticketNo, 10))
      .filter((n) => Number.isInteger(n) && n > 0)
  );
  state.selectedOpsTicketNos = new Set(
    Array.from(state.selectedOpsTicketNos).filter((n) => validNos.has(Number(n)))
  );

  if (!historyRows.length) {
    renderEmptyRow(tbody, 9, '기록된 티켓이 없습니다.');
    $('opsSelectAll').checked = false;
    $('removeTicketNos').value = '';
    return;
  }

  for (const t of historyRows) {
    const ticketNo = Number.parseInt(t.ticketNo, 10);
    const checked = Number.isInteger(ticketNo) && state.selectedOpsTicketNos.has(ticketNo) ? 'checked' : '';
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><input class="chk ops-ticket-select" type="checkbox" data-ticket-no="${ticketNo || ''}" ${checked} /></td><td>${t.ticketNo || '-'}</td><td>${escapeHtml(t.ticketTypeLabel)}</td><td>${historyStatusChip(t.historyStatus)}</td><td>${escapeHtml(t.ownerTag || t.ownerId)}</td><td>${fmt(t.openedAt)}</td><td>${t.historyStatus === 'closed' ? fmt(t.closedAt) : '-'}</td><td>${formatTicketDetails(t)}</td><td>${escapeHtml(t.historyStatus === 'closed' ? (t.closeReason || '-') : '-')}</td>`;
    tbody.appendChild(tr);
  }

  const totalRows = historyRows.filter((t) => Number.isInteger(Number.parseInt(t.ticketNo, 10))).length;
  const selectedCount = Array.from(state.selectedOpsTicketNos).filter((n) => validNos.has(Number(n))).length;
  $('opsSelectAll').checked = totalRows > 0 && selectedCount === totalRows;
  $('removeTicketNos').value = Array.from(state.selectedOpsTicketNos).sort((a, b) => a - b).join(', ');
}

function erpStatusClass(value) {
  const key = String(value || '').toLowerCase().replace(/\s+/g, '');
  if (key === 'inprogress') return 'inprogress';
  if (key === 'notstarted') return 'notstarted';
  if (key === 'noissue') return 'noissue';
  if (key === 'important' || key === 'pending' || key === 'cleared') return key;
  return '';
}

function currentErpSheet() {
  const data = state.erpData || {};
  const sheets = data.sheets || {};
  const key = String($('erpSheetSelect').value || state.erpSheet || '').trim();
  if (key && sheets[key]) {
    state.erpSheet = key;
    return { key, sheet: sheets[key] };
  }
  const firstKey = Object.keys(sheets)[0] || '';
  state.erpSheet = firstKey;
  return { key: firstKey, sheet: firstKey ? sheets[firstKey] : null };
}

function findErpRowById(rowId) {
  const { sheet } = currentErpSheet();
  if (!sheet || !Array.isArray(sheet.rows)) {
    return null;
  }
  return sheet.rows.find((row) => String(row.id || '') === String(rowId || '')) || null;
}

function renderErpSheetSelect() {
  const options = ((state.erpData && state.erpData.sheetOptions) || []).map((x) => ({
    id: x.id,
    name: `${x.name} (${x.count || 0})`
  }));
  fillSelect($('erpSheetSelect'), options, 'name', 'ERP 시트 없음', state.erpSheet);
  state.erpSheet = $('erpSheetSelect').value || state.erpSheet;
  localStorage.setItem('erp.sheet', state.erpSheet);
}

function openModal(id) {
  $(id).style.display = 'flex';
  setTimeout(() => {
    const root = $(id);
    if (!root) return;
    const target = root.querySelector('input:not([type="hidden"]), select, textarea, button');
    if (target && typeof target.focus === 'function') {
      target.focus();
    }
  }, 0);
}

function closeModal(id) {
  $(id).style.display = 'none';
}

function erpFilterStorageKey() {
  return `erp.filters.${state.guildId || 'global'}.${state.erpSheet || 'work_list'}`;
}

function saveErpFilters() {
  try {
    localStorage.setItem(erpFilterStorageKey(), JSON.stringify(state.erpFilters || {}));
  } catch (_error) {}
}

function loadErpFilters() {
  try {
    const raw = localStorage.getItem(erpFilterStorageKey());
    if (!raw) {
      state.erpFilters = { status: '', column: 'all', keyword: '' };
      return;
    }
    const parsed = JSON.parse(raw);
    state.erpFilters = {
      status: String(parsed && parsed.status ? parsed.status : ''),
      column: String(parsed && parsed.column ? parsed.column : 'all'),
      keyword: String(parsed && parsed.keyword ? parsed.keyword : '')
    };
  } catch (_error) {
    state.erpFilters = { status: '', column: 'all', keyword: '' };
  }
}

function renderErpFilterModalFields() {
  const { sheet } = currentErpSheet();
  const statusSelect = $('erpFilterStatus');
  const colSelect = $('erpFilterColumn');
  statusSelect.innerHTML = '<option value="">상태 전체</option>';
  colSelect.innerHTML = '<option value="all">모든 컬럼</option>';
  const statusColumn = (sheet && sheet.columns || []).find((column) => column.id === 'status' && Array.isArray(column.options));
  if (statusColumn) {
    for (const optionText of statusColumn.options) {
      const opt = document.createElement('option');
      opt.value = optionText;
      opt.textContent = optionText;
      statusSelect.appendChild(opt);
    }
  }
  for (const column of (sheet && sheet.columns) || []) {
    const opt = document.createElement('option');
    opt.value = column.id;
    opt.textContent = column.label;
    colSelect.appendChild(opt);
  }
  statusSelect.value = state.erpFilters.status || '';
  colSelect.value = state.erpFilters.column || 'all';
  $('erpFilterKeyword').value = state.erpFilters.keyword || '';
}

function renderErpBulkEditModalFields() {
  const { sheet } = currentErpSheet();
  const colSelect = $('erpBulkEditColumn');
  const statusValue = $('erpBulkEditStatusValue');
  colSelect.innerHTML = '';
  for (const column of (sheet && sheet.columns) || []) {
    const opt = document.createElement('option');
    opt.value = column.id;
    opt.textContent = column.label;
    colSelect.appendChild(opt);
  }
  const statusColumn = (sheet && sheet.columns || []).find((column) => column.id === 'status' && Array.isArray(column.options));
  statusValue.innerHTML = '<option value="">상태 선택</option>';
  if (statusColumn) {
    for (const optionText of statusColumn.options) {
      const opt = document.createElement('option');
      opt.value = optionText;
      opt.textContent = optionText;
      statusValue.appendChild(opt);
    }
  }
  const selectedCol = String(colSelect.value || '');
  const isStatus = selectedCol === 'status' && statusColumn;
  statusValue.style.display = isStatus ? '' : 'none';
  $('erpBulkEditValue').style.display = isStatus ? 'none' : '';
}

function clearErpForm() {
  state.erpEditingRowId = '';
  $('erpModalTitle').textContent = 'ERP 행 추가';
  $('erpFormResult').textContent = '';
  $('erpFormResult').style.color = '';
  for (const input of Array.from(document.querySelectorAll('#erpFormFields [data-erp-field]'))) {
    input.value = '';
  }
}

function renderErpForm() {
  const { sheet } = currentErpSheet();
  const wrap = $('erpFormFields');
  wrap.innerHTML = '';
  if (!sheet || !Array.isArray(sheet.columns)) {
    return;
  }
  for (const column of sheet.columns) {
    const item = document.createElement('div');
    item.className = 'erp-form-item';
    const label = document.createElement('label');
    label.className = 'label';
    label.textContent = column.label;
    let input;
    if (column.type === 'select' && Array.isArray(column.options)) {
      input = document.createElement('select');
      input.className = 'select';
      const empty = document.createElement('option');
      empty.value = '';
      empty.textContent = '선택';
      input.appendChild(empty);
      for (const optionText of column.options) {
        const opt = document.createElement('option');
        opt.value = optionText;
        opt.textContent = optionText;
        input.appendChild(opt);
      }
    } else {
      input = document.createElement('input');
      input.className = 'field';
      input.type = 'text';
      input.placeholder = column.label;
    }
    input.id = `erpField_${column.id}`;
    input.dataset.erpField = column.id;
    item.appendChild(label);
    item.appendChild(input);
    wrap.appendChild(item);
  }
}

function collectErpFormPayload() {
  const { sheet } = currentErpSheet();
  const payload = {};
  for (const column of (sheet && sheet.columns) || []) {
    const el = $(`erpField_${column.id}`);
    payload[column.id] = String((el && el.value) || '').trim();
  }
  return payload;
}

function renderErpTable() {
  const thead = $('erpTable').querySelector('thead');
  const tbody = $('erpTable').querySelector('tbody');
  thead.innerHTML = '';
  tbody.innerHTML = '';
  const search = String(state.erpFilters.keyword || '').trim().toLowerCase();
  const statusFilter = String(state.erpFilters.status || '').trim();
  const columnFilter = String(state.erpFilters.column || 'all').trim();
  const canEdit = !!(state.erpData && state.erpData.canEdit);
  const { sheet } = currentErpSheet();
  if (!sheet || !Array.isArray(sheet.columns)) {
    renderEmptyRow(tbody, 1, 'ERP 시트 데이터가 없습니다.');
    return;
  }

  const header = document.createElement('tr');
  header.innerHTML = `${canEdit ? '<th><input id="erpSelectAll" class="chk" type="checkbox" /></th>' : ''}<th>No</th>${sheet.columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('')}<th>Updated</th>${canEdit ? '<th>Action</th>' : ''}`;
  thead.appendChild(header);

  const rows = (sheet.rows || []).filter((row) => {
    if (statusFilter && String(row.status || '') !== statusFilter) {
      return false;
    }
    if (!search) return true;
    if (columnFilter && columnFilter !== 'all') {
      return String(row[columnFilter] || '').toLowerCase().includes(search);
    }
    const joined = [row.no].concat(sheet.columns.map((column) => row[column.id] || '')).join(' ').toLowerCase();
    return joined.includes(search);
  });

  if (!rows.length) {
    renderEmptyRow(tbody, sheet.columns.length + (canEdit ? 4 : 2), 'ERP 데이터가 없습니다.');
    return;
  }

  rows.forEach((row, rowIndex) => {
    const tr = document.createElement('tr');
    tr.dataset.rowId = String(row.id || '');
    const cols = [];
    if (canEdit) {
      const checked = state.erpSelectedRowIds.has(String(row.id || '')) ? 'checked' : '';
      cols.push(`<td><input class="chk erp-row-select" type="checkbox" data-row-id="${escapeHtml(row.id)}" data-row-index="${rowIndex}" ${checked} /></td>`);
    }
    cols.push(`<td>${row.no || '-'}</td>`);
    for (const column of sheet.columns) {
      const value = row[column.id] || '';
      if (column.id === 'status') {
        cols.push(`<td class="erp-cell" data-col-id="${escapeHtml(column.id)}"><span class="erp-status ${erpStatusClass(value)}">${escapeHtml(value || '-')}</span></td>`);
      } else {
        cols.push(`<td class="erp-cell" data-col-id="${escapeHtml(column.id)}">${escapeHtml(value || '-')}</td>`);
      }
    }
    cols.push(`<td>${fmt(row.updatedAt)}</td>`);
    if (canEdit) {
      cols.push(`<td><button class="btn btn-soft erp-edit" data-row-id="${escapeHtml(row.id)}">수정</button> <button class="btn btn-danger erp-delete" data-row-id="${escapeHtml(row.id)}">삭제</button></td>`);
    }
    tr.innerHTML = cols.join('');
    tbody.appendChild(tr);
  });

  if (canEdit) {
    const all = Array.from(document.querySelectorAll('.erp-row-select'));
    const selected = all.filter((x) => x.checked).length;
    const selectAll = $('erpSelectAll');
    if (selectAll) {
      selectAll.checked = all.length > 0 && selected === all.length;
    }
  }
}

function fillErpFormFromRow(row) {
  const { sheet } = currentErpSheet();
  if (!sheet) return;
  for (const column of sheet.columns) {
    const el = $(`erpField_${column.id}`);
    if (el) {
      el.value = String(row[column.id] || '');
    }
  }
  state.erpEditingRowId = String(row.id || '');
  $('erpModalTitle').textContent = `ERP 행 수정 #${row.no || '-'}`;
  openModal('erpModal');
}

function renderErp() {
  renderErpSheetSelect();
  loadErpFilters();
  renderErpFilterModalFields();
  renderErpBulkEditModalFields();
  renderErpForm();
  renderErpTable();
  const canEdit = !!(state.erpData && state.erpData.canEdit);
  $('erpSaveBtn').disabled = !canEdit;
  $('erpSaveBtn').style.opacity = canEdit ? '1' : '0.5';
  $('erpFormResult').textContent = canEdit ? '' : 'ERP 수정은 Operations 또는 Technical Lead 권한이 필요합니다.';
  $('erpFormResult').style.color = canEdit ? '' : '#d13a49';
  const { key } = currentErpSheet();
  const summary = (state.erpData && state.erpData.summary && state.erpData.summary[key]) || {};
  const statusCounts = summary.statusCounts || {};
  const statusText = Object.entries(statusCounts).map(([k, v]) => `${k}:${v}`).join(' · ');
  $('erpSummaryText').textContent = `총 ${summary.total || 0}건 · 삭제 ${summary.deleted || 0}건${statusText ? ` · ${statusText}` : ''}`;
  const filterPieces = [];
  if (state.erpFilters.status) filterPieces.push(`상태=${state.erpFilters.status}`);
  if (state.erpFilters.keyword) {
    const colText = state.erpFilters.column === 'all' ? '전체 컬럼' : state.erpFilters.column;
    filterPieces.push(`${colText} 포함 "${state.erpFilters.keyword}"`);
  }
  $('erpFilterSummaryText').textContent = filterPieces.length ? `필터: ${filterPieces.join(' · ')}` : '필터: 없음';
  const deletedRows = (state.erpData && state.erpData.deletedSheets && state.erpData.deletedSheets[key] && state.erpData.deletedSheets[key].rows) || [];
  const deletedOptions = deletedRows.map((row) => ({
    id: row.id,
    name: `#${row.no || '-'} | ${fmt(row.deletedAt)}`
  }));
  fillMultiSelect($('erpDeletedRowsSelect'), deletedOptions, 'name', '삭제된 행 없음');
  $('erpDeleteSelectedBtn').disabled = !canEdit;
  $('erpRestoreSelectedBtn').disabled = !canEdit;
  $('erpOpenAddModal').disabled = !canEdit;
  $('erpOpenImportModal').disabled = !canEdit;
  $('erpOpenBulkEditModal').disabled = !canEdit;
  updateErpSelectionUi();
}

function updateErpSelectionUi() {
  const selectedCount = state.erpSelectedRowIds.size;
  $('erpSelectedInfo').textContent = `선택된 행: ${selectedCount}`;
  const canEdit = !!(state.erpData && state.erpData.canEdit);
  const enableSelectedActions = canEdit && selectedCount > 0;
  $('erpOpenBulkEditModal').disabled = !enableSelectedActions;
  $('erpDeleteSelectedBtn').disabled = !enableSelectedActions;
}

async function loadErpData() {
  if (!hasDashboardAccess() || !state.guildId) {
    return;
  }
  const data = await api(`/api/guilds/${state.guildId}/erp`);
  state.erpData = data || { sheetOptions: [], sheets: {} };
  state.erpSelectedRowIds = new Set(
    Array.from(state.erpSelectedRowIds).filter((id) => {
      const { key } = currentErpSheet();
      const rows = (data && data.sheets && data.sheets[key] && data.sheets[key].rows) || [];
      return rows.some((row) => String(row.id || '') === String(id));
    })
  );
  renderErp();
}

async function loadGuilds() {
  const data = await api('/api/guilds');
  const guilds = data.guilds || [];
  fillSelect($('guild'), guilds, 'name', '접근 가능한 길드가 없습니다');
  if (!state.guildId && guilds[0]) {
    state.guildId = guilds[0].id;
    $('guild').value = state.guildId;
  }
  if (!guilds.length) throw new Error('길드 목록이 비어 있습니다.');
}

async function loadData() {
  if (!hasDashboardAccess()) {
    state.operationsManager = false;
    applyDashboardVisibility();
    return;
  }
  state.guildId = $('guild').value;
  if (!state.guildId) throw new Error('길드를 먼저 선택하세요.');

  const data = await api(`/api/guilds/${state.guildId}/data`);
  state.data = data;
  state.operationsManager = !!(
    data &&
    data.auth &&
    data.auth.permissions &&
    data.auth.permissions.loggedIn &&
    data.auth.permissions.operationsManager
  );

  const savedEmbedChannelId = localStorage.getItem(guildStorageKey('embedChannelId')) || '';
  const savedEmbedRequester = localStorage.getItem(guildStorageKey('embedRequesterUserId')) || '';
  const savedResequenceRequester = localStorage.getItem(guildStorageKey('resequenceRequesterUserId')) || '';

  fillSelect($('embedChannel'), data.textChannels || [], 'name', '텍스트 채널 없음', savedEmbedChannelId);
  if ($('embedChannel').value) {
    localStorage.setItem(guildStorageKey('embedChannelId'), $('embedChannel').value);
  }
  if (!state.authUser || !state.authUser.id) {
    if (savedEmbedRequester) $('embedRequesterUserId').value = savedEmbedRequester;
    if (savedResequenceRequester) $('resequenceRequesterUserId').value = savedResequenceRequester;
  }
  const allowRequesterInput = !!(data.permissions && data.permissions.operationsAllowedForDashboardUserIdInput);
  $('embedRequesterUserId').style.display = allowRequesterInput ? '' : 'none';
  $('resequenceRequesterUserId').style.display = allowRequesterInput ? '' : 'none';
  applyAuthUserToInputs();

  renderOverviewTables();
  renderOperationsHistoryTable();
  try {
    await loadErpData();
  } catch (_error) {}
  setLastSync();

  const available = data.channelStats && Number.isInteger(data.channelStats.availableTextChannels)
    ? data.channelStats.availableTextChannels
    : (data.textChannels || []).length;
  const memberCount = (data.memberRoleRows || []).length;
  const roleCount = (data.roleOptions || []).length;
  let status = `길드 '${data.guild && data.guild.name ? data.guild.name : state.guildId}' 동기화 완료 · 채널 ${available}개 · 사용자 ${memberCount}명 · 역할 ${roleCount}개`;
  if (data.auth && data.auth.permissions && data.auth.permissions.loggedIn) {
    status += data.auth.permissions.operationsManager ? ' · Operations 권한 있음' : ' · Operations 권한 없음';
  } else {
    status += ' · 로그인 필요';
  }
  setStatus(status);
  updateTabPermissions();
}

function restartAutoRefresh() {
  if (state.refreshTimer) {
    clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }
  if (!$('liveToggle').checked) return;
  const interval = Math.max(3000, Number($('liveInterval').value || 10000));
  state.refreshTimer = setInterval(async () => {
    if (!hasDashboardAccess() || !state.guildId) return;
    try {
      await loadData();
    } catch (error) {
      setStatus(`라이브 동기화 실패: ${error.message}`, 'error');
    }
  }, interval);
}

function fillMasterGuildSelect() {
  const guildRows = (state.masterData && state.masterData.guilds || []).map((g) => ({ id: g.guildId, name: g.guildName }));
  const saved = localStorage.getItem('masterOperatorGuildId') || '';
  fillSelect($('masterOperatorGuild'), guildRows, 'name', '길드 없음', saved);
  if ($('masterOperatorGuild').value) {
    localStorage.setItem('masterOperatorGuildId', $('masterOperatorGuild').value);
  }
}

async function loadMasterData() {
  const data = await apiMaster('/api/master/overview');
  state.masterData = data;
  const botTag = data.bot && data.bot.tag ? data.bot.tag : '-';
  const guildCount = data.bot && Number.isInteger(data.bot.guildCount) ? data.bot.guildCount : 0;
  const totalOpen = data.summary && Number.isInteger(data.summary.totalOpen) ? data.summary.totalOpen : 0;
  const totalClosed = data.summary && Number.isInteger(data.summary.totalClosed) ? data.summary.totalClosed : 0;
  $('masterSummary').textContent = `Bot: ${botTag} | Guilds: ${guildCount} | Open: ${totalOpen} | Closed: ${totalClosed} | Mode: Operations Permission`;
  fillMasterGuildSelect();
  await loadMasterActors();
  await loadMasterErpAudit().catch(() => {});
}

async function loadMasterActors() {
  const guildId = String($('masterOperatorGuild').value || '').trim();
  if (!guildId) {
    fillMultiSelect($('masterOperatorMemberMulti'), [], 'name', '멤버 없음');
    fillMultiSelect($('masterOperatorRoleMulti'), [], 'name', '역할 없음');
    fillMultiSelect($('masterCurrentOperatorUsers'), [], 'name', '없음');
    fillMultiSelect($('masterCurrentOperatorRoles'), [], 'name', '없음');
    fillMultiSelect($('masterDeletedTicketMulti'), [], 'name', '복구 가능한 삭제 티켓 없음');
    renderMasterIssuerStats([]);
    $('masterOperatorSummary').textContent = '운영 권한 정보 없음';
    return;
  }

  let actors = state.masterActorsByGuild[guildId];
  if (!actors) {
    actors = await apiMaster(`/api/master/guilds/${guildId}/actors`);
    state.masterActorsByGuild[guildId] = actors;
  }

  const memberOptions = actors.memberOptions || [];
  const roleOptions = actors.roleOptions || [];
  fillMultiSelect($('masterOperatorMemberMulti'), memberOptions, 'name', '멤버 없음');
  fillMultiSelect($('masterOperatorRoleMulti'), roleOptions, 'name', '역할 없음');

  const memberMap = new Map(memberOptions.map((m) => [String(m.id), m.name]));
  const roleMap = new Map(roleOptions.map((r) => [String(r.id), r.name]));
  const currentUsers = (actors.currentOperatorUserIds || []).map((id) => ({
    id: String(id),
    name: memberMap.get(String(id)) || `User ID ${id}`
  }));
  const currentRoles = (actors.currentOperatorRoleIds || []).map((id) => ({
    id: String(id),
    name: roleMap.get(String(id)) || `Role ID ${id}`
  }));
  fillMultiSelect($('masterCurrentOperatorUsers'), currentUsers, 'name', '없음');
  fillMultiSelect($('masterCurrentOperatorRoles'), currentRoles, 'name', '없음');
  renderMasterIssuerStats(actors.issuerStats || []);
  renderMasterDeletedTickets(actors.deletedTickets || []);

  $('masterOperatorSummary').textContent = `현재 Operations 사용자 ${currentUsers.length}명 | 역할 ${currentRoles.length}개`;
}

async function refreshMasterActors(guildId) {
  state.masterActorsByGuild[guildId] = null;
  await loadMasterActors();
  await loadMasterData();
}

async function loadMasterErpAudit() {
  const guildId = String($('masterOperatorGuild').value || '').trim();
  if (!guildId) {
    renderMasterErpAuditRows([]);
    return;
  }
  const params = new URLSearchParams();
  const sheetKey = String($('masterErpAuditSheet').value || '').trim();
  const rowNo = String($('masterErpAuditRowNo').value || '').trim();
  const keyword = String($('masterErpAuditKeyword').value || '').trim();
  if (sheetKey) params.set('sheetKey', sheetKey);
  if (rowNo) params.set('rowNo', rowNo);
  if (keyword) params.set('keyword', keyword);
  const query = params.toString() ? `?${params.toString()}` : '';
  const data = await apiMaster(`/api/master/guilds/${guildId}/erp-audit${query}`);
  renderMasterErpAuditRows(data.rows || []);
}

function parseTicketNoList(raw) {
  return String(raw || '')
    .split(',')
    .map((x) => Number.parseInt(x.trim(), 10))
    .filter((x) => Number.isInteger(x) && x > 0);
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

$('saveToken').addEventListener('click', async () => {
  try {
    if (isOauthLoginRequired()) {
      setStatus('OAuth 모드에서는 토큰 저장이 필요하지 않습니다.');
      return;
    }
    state.token = $('token').value.trim();
    if (!state.token) throw new Error('토큰을 입력하세요.');
    localStorage.setItem('dashboardToken', state.token);
    await loadGuilds();
    await loadData();
    restartAutoRefresh();
  } catch (error) {
    setStatus(`토큰 저장 실패: ${error.message}`, 'error');
  }
});

$('load').addEventListener('click', async () => {
  try {
    if (!hasDashboardAccess()) {
      throw new Error('먼저 Discord 로그인 후 사용하세요.');
    }
    await loadData();
  } catch (error) {
    setStatus(`불러오기 실패: ${error.message}`, 'error');
  }
});

$('guild').addEventListener('change', async () => {
  try {
    if (!hasDashboardAccess()) {
      throw new Error('먼저 Discord 로그인 후 사용하세요.');
    }
    await loadData();
  } catch (error) {
    setStatus(`길드 변경 실패: ${error.message}`, 'error');
  }
});

$('embedChannel').addEventListener('change', () => {
  if (!state.guildId) return;
  localStorage.setItem(guildStorageKey('embedChannelId'), $('embedChannel').value || '');
});
$('embedRequesterUserId').addEventListener('change', () => {
  if (!state.guildId) return;
  localStorage.setItem(guildStorageKey('embedRequesterUserId'), String($('embedRequesterUserId').value || '').trim());
});
$('resequenceRequesterUserId').addEventListener('change', () => {
  if (!state.guildId) return;
  localStorage.setItem(guildStorageKey('resequenceRequesterUserId'), String($('resequenceRequesterUserId').value || '').trim());
});

$('liveToggle').addEventListener('change', restartAutoRefresh);
$('liveInterval').addEventListener('change', restartAutoRefresh);

$('overviewTabBtn').addEventListener('click', () => switchTab('overview'));
$('masterTabBtn').addEventListener('click', async () => {
  if (!hasDashboardAccess()) {
    setStatus('먼저 Discord 로그인 후 접근하세요.', 'error');
    return;
  }
  if (!state.technicalLead) {
    setStatus('Master 탭은 Technical Lead만 접근할 수 있습니다.', 'error');
    return;
  }
  switchTab('master');
  await loadMasterData().catch((error) => {
    setStatus(`마스터 자동 로드 실패: ${error.message}`, 'error');
  });
});
$('opsTabBtn').addEventListener('click', () => {
  if (!hasDashboardAccess()) {
    setStatus('먼저 Discord 로그인 후 접근하세요.', 'error');
    return;
  }
  if (!state.operationsManager) {
    setStatus('Operations 탭은 Operations 권한 사용자만 접근할 수 있습니다.', 'error');
    return;
  }
  switchTab('ops');
});
$('erpTabBtn').addEventListener('click', async () => {
  if (!hasDashboardAccess()) {
    setStatus('먼저 Discord 로그인 후 접근하세요.', 'error');
    return;
  }
  switchTab('erp');
  await loadErpData().catch((error) => {
    setStatus(`ERP 로드 실패: ${error.message}`, 'error');
  });
});
$('discordLoginBtn').addEventListener('click', () => {
  if (!state.oauthEnabled) {
    setStatus('Discord OAuth 미설정입니다. 먼저 Discord 로그인 페이지를 열고, Koyeb OAuth 환경변수를 설정해주세요.', 'error');
    window.open('https://discord.com/login', '_blank', 'noopener,noreferrer');
    return;
  }
  window.location.href = buildDiscordLoginUrl();
});
$('discordQrBtn').addEventListener('click', () => {
  if (!state.oauthEnabled) {
    setStatus('Discord OAuth 미설정입니다. 먼저 OAuth 환경변수를 설정해주세요.', 'error');
    return;
  }
  fetch('/api/auth/qr/create', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' }
  })
    .then(async (res) => {
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || `HTTP ${res.status}`);
      }
      return res.json();
    })
    .then((data) => {
      const loginUrl = String(data && data.loginUrl ? data.loginUrl : '').trim();
      const qrSessionId = String(data && data.qrSessionId ? data.qrSessionId : '').trim();
      if (!loginUrl || !qrSessionId) {
        throw new Error('QR login URL 생성 실패');
      }
      $('discordQrImage').src = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(loginUrl)}`;
      $('discordQrOpenLink').href = loginUrl;
      $('qrModal').style.display = 'flex';
      startQrPolling(qrSessionId);
    })
    .catch((error) => {
      setStatus(`QR 로그인 준비 실패: ${error.message}`, 'error');
    });
});
$('discordQrCloseBtn').addEventListener('click', () => {
  stopQrPolling();
  $('qrModal').style.display = 'none';
});
$('qrModal').addEventListener('click', (event) => {
  if (event.target === $('qrModal')) {
    stopQrPolling();
    $('qrModal').style.display = 'none';
  }
});
$('discordLogoutBtn').addEventListener('click', async () => {
  if (!state.oauthEnabled) {
    setStatus('현재 OAuth 세션이 없습니다.');
    return;
  }
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    state.authUser = null;
    state.technicalLead = false;
    state.technicalLeadGuilds = [];
    state.operationsManager = false;
    renderAuthStatus();
    switchTab('overview');
    if (state.token && state.guildId) {
      await loadData().catch(() => {});
    }
    setStatus('Discord 로그아웃 완료');
  } catch (error) {
    setStatus(`로그아웃 실패: ${error.message}`, 'error');
  }
});

$('historyType').addEventListener('change', renderOverviewTables);
$('historySearch').addEventListener('input', renderOverviewTables);
$('historyClear').addEventListener('click', () => {
  $('historyType').value = 'all';
  $('historySearch').value = '';
  renderOverviewTables();
});

$('erpSheetSelect').addEventListener('change', () => {
  state.erpSheet = $('erpSheetSelect').value || state.erpSheet;
  localStorage.setItem('erp.sheet', state.erpSheet);
  state.erpEditingRowId = '';
  state.erpSelectedRowIds.clear();
  loadErpFilters();
  renderErp();
  updateErpSelectionUi();
});

$('erpOpenAddModal').addEventListener('click', () => {
  clearErpForm();
  renderErpForm();
  $('erpModalTitle').textContent = 'ERP 행 추가';
  openModal('erpModal');
});

$('erpModalCloseBtn').addEventListener('click', () => {
  closeModal('erpModal');
});

$('erpModal').addEventListener('click', (event) => {
  if (event.target === $('erpModal')) {
    closeModal('erpModal');
  }
});

$('erpOpenImportModal').addEventListener('click', () => {
  $('erpImportResult').textContent = '';
  $('erpImportFile').value = '';
  $('erpImportReplaceAll').checked = false;
  openModal('erpImportModal');
});

$('erpImportModalCloseBtn').addEventListener('click', () => closeModal('erpImportModal'));
$('erpImportModal').addEventListener('click', (event) => {
  if (event.target === $('erpImportModal')) {
    closeModal('erpImportModal');
  }
});

$('erpOpenFilterModal').addEventListener('click', () => {
  renderErpFilterModalFields();
  openModal('erpFilterModal');
});

$('erpFilterModalCloseBtn').addEventListener('click', () => closeModal('erpFilterModal'));
$('erpFilterModal').addEventListener('click', (event) => {
  if (event.target === $('erpFilterModal')) {
    closeModal('erpFilterModal');
  }
});
$('erpFilterKeyword').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    $('erpApplyFilterBtn').click();
  }
});

$('erpApplyFilterBtn').addEventListener('click', () => {
  state.erpFilters.status = String($('erpFilterStatus').value || '').trim();
  state.erpFilters.column = String($('erpFilterColumn').value || 'all').trim();
  state.erpFilters.keyword = String($('erpFilterKeyword').value || '').trim();
  saveErpFilters();
  renderErp();
  closeModal('erpFilterModal');
});

$('erpClearFilterBtn').addEventListener('click', () => {
  state.erpFilters = { status: '', column: 'all', keyword: '' };
  saveErpFilters();
  renderErp();
  closeModal('erpFilterModal');
});

$('erpOpenBulkEditModal').addEventListener('click', () => {
  const canEdit = !!(state.erpData && state.erpData.canEdit);
  if (!canEdit) {
    setStatus('권한이 없습니다.', 'error');
    return;
  }
  if (state.erpSelectedRowIds.size === 0) {
    setStatus('먼저 행을 선택하세요.', 'error');
    return;
  }
  renderErpBulkEditModalFields();
  $('erpBulkEditResult').textContent = '';
  $('erpBulkEditValue').value = '';
  $('erpBulkEditStatusValue').value = '';
  openModal('erpBulkEditModal');
});

$('erpBulkEditColumn').addEventListener('change', renderErpBulkEditModalFields);
$('erpBulkEditModalCloseBtn').addEventListener('click', () => closeModal('erpBulkEditModal'));
$('erpBulkEditModal').addEventListener('click', (event) => {
  if (event.target === $('erpBulkEditModal')) {
    closeModal('erpBulkEditModal');
  }
});

$('erpRunBulkEditBtn').addEventListener('click', async () => {
  $('erpBulkEditResult').textContent = '처리 중...';
  try {
    if (!state.guildId) {
      throw new Error('길드를 먼저 선택하세요.');
    }
    const { key, sheet } = currentErpSheet();
    const colId = String($('erpBulkEditColumn').value || '').trim();
    if (!key || !colId || !sheet) {
      throw new Error('컬럼을 선택하세요.');
    }
    const rowIds = Array.from(state.erpSelectedRowIds);
    if (!rowIds.length) {
      throw new Error('선택된 행이 없습니다.');
    }
    const targetCol = (sheet.columns || []).find((c) => c.id === colId);
    if (!targetCol) {
      throw new Error('유효하지 않은 컬럼입니다.');
    }
    const value = targetCol.id === 'status'
      ? String($('erpBulkEditStatusValue').value || '').trim()
      : String($('erpBulkEditValue').value || '').trim();
    if (!value) {
      throw new Error('변경 값을 입력하세요.');
    }
    const rowMap = new Map((sheet.rows || []).map((row) => [String(row.id || ''), row]));
    let done = 0;
    for (const rowId of rowIds) {
      const row = rowMap.get(String(rowId));
      if (!row) continue;
      const payload = {};
      for (const c of sheet.columns) {
        payload[c.id] = String(row[c.id] || '');
      }
      payload[colId] = value;
      // eslint-disable-next-line no-await-in-loop
      await api(`/api/guilds/${state.guildId}/erp/${key}/rows/${rowId}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      done += 1;
    }
    $('erpBulkEditResult').textContent = `완료: ${done}건 수정`;
    $('erpBulkEditResult').style.color = '#128058';
    await loadErpData();
    closeModal('erpBulkEditModal');
  } catch (error) {
    $('erpBulkEditResult').textContent = `실패: ${error.message}`;
    $('erpBulkEditResult').style.color = '#d13a49';
  }
});

$('erpOpenRestoreModal').addEventListener('click', () => {
  openModal('erpRestoreModal');
});

$('erpRestoreModalCloseBtn').addEventListener('click', () => closeModal('erpRestoreModal'));
$('erpRestoreModal').addEventListener('click', (event) => {
  if (event.target === $('erpRestoreModal')) {
    closeModal('erpRestoreModal');
  }
});

document.addEventListener('keydown', (event) => {
  const modalOrder = ['erpModal', 'erpImportModal', 'erpFilterModal', 'erpBulkEditModal', 'erpRestoreModal', 'qrModal'];
  const opened = modalOrder.find((id) => $(id) && $(id).style.display === 'flex');
  if (!opened) {
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    closeModal(opened);
    return;
  }
  if ((event.ctrlKey || event.metaKey) && (event.key === 's' || event.key === 'S') && opened === 'erpModal') {
    event.preventDefault();
    $('erpSaveBtn').click();
  }
});

$('erpImportBtn').addEventListener('click', async () => {
  $('erpImportResult').textContent = '가져오는 중...';
  try {
    if (!state.guildId) {
      throw new Error('길드를 먼저 선택하세요.');
    }
    const { key } = currentErpSheet();
    if (!key) {
      throw new Error('ERP 시트를 선택하세요.');
    }
    const fileInput = $('erpImportFile');
    const file = fileInput && fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
    if (!file) {
      throw new Error('파일을 선택하세요.');
    }
    const arrayBuffer = await file.arrayBuffer();
    const fileBase64 = arrayBufferToBase64(arrayBuffer);
    const replaceAll = !!$('erpImportReplaceAll').checked;
    const result = await api(`/api/guilds/${state.guildId}/erp/${key}/import`, {
      method: 'POST',
      body: JSON.stringify({ fileBase64, replaceAll })
    });
    $('erpImportResult').textContent = `가져오기 완료: ${result.importedCount || 0}건 (총 ${result.totalCount || 0}건)`;
    $('erpImportResult').style.color = '#128058';
    fileInput.value = '';
    $('erpImportReplaceAll').checked = false;
    state.erpSelectedRowIds.clear();
    clearErpForm();
    await loadErpData();
    closeModal('erpImportModal');
  } catch (error) {
    $('erpImportResult').textContent = `가져오기 실패: ${error.message}`;
    $('erpImportResult').style.color = '#d13a49';
  }
});

$('erpReloadBtn').addEventListener('click', async () => {
  try {
    await loadErpData();
    setStatus('ERP 데이터 새로고침 완료');
  } catch (error) {
    setStatus(`ERP 데이터 새로고침 실패: ${error.message}`, 'error');
  }
});

$('erpExportBtn').addEventListener('click', async () => {
  try {
    if (!state.guildId) {
      throw new Error('길드를 먼저 선택하세요.');
    }
    const url = `/api/guilds/${state.guildId}/erp/export.xlsx`;
    const res = await fetch(url, {
      credentials: 'same-origin',
      headers: authHeaders()
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(txt || `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = `erp_${state.guildId}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(objectUrl);
    setStatus('ERP Excel 다운로드 완료');
  } catch (error) {
    setStatus(`ERP Excel 다운로드 실패: ${error.message}`, 'error');
  }
});

$('erpSaveBtn').addEventListener('click', async () => {
  $('erpFormResult').textContent = '저장 중...';
  try {
    if (!state.guildId) {
      throw new Error('길드를 먼저 선택하세요.');
    }
    const { key } = currentErpSheet();
    if (!key) {
      throw new Error('ERP 시트를 선택하세요.');
    }
    const payload = collectErpFormPayload();
    let result;
    if (state.erpEditingRowId) {
      result = await api(`/api/guilds/${state.guildId}/erp/${key}/rows/${state.erpEditingRowId}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
    } else {
      result = await api(`/api/guilds/${state.guildId}/erp/${key}/rows`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
    }
    $('erpFormResult').textContent = `저장 완료 (No: ${result.row && result.row.no ? result.row.no : '-'})`;
    $('erpFormResult').style.color = '#128058';
    await loadErpData();
    clearErpForm();
    closeModal('erpModal');
  } catch (error) {
    $('erpFormResult').textContent = `저장 실패: ${error.message}`;
    $('erpFormResult').style.color = '#d13a49';
  }
});

$('erpClearBtn').addEventListener('click', clearErpForm);

$('erpTable').addEventListener('click', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const checkbox = target.closest('.erp-row-select');
  if (checkbox instanceof HTMLInputElement) {
    const rowId = String(checkbox.dataset.rowId || '');
    const rowIndex = Number.parseInt(String(checkbox.dataset.rowIndex || ''), 10);
    if (rowId) {
      if (checkbox.checked) state.erpSelectedRowIds.add(rowId);
      else state.erpSelectedRowIds.delete(rowId);
    }
    if (event.shiftKey && Number.isInteger(rowIndex) && state.erpLastCheckedIndex >= 0) {
      const min = Math.min(state.erpLastCheckedIndex, rowIndex);
      const max = Math.max(state.erpLastCheckedIndex, rowIndex);
      const all = Array.from(document.querySelectorAll('.erp-row-select'));
      for (const item of all) {
        const idx = Number.parseInt(String(item.dataset.rowIndex || ''), 10);
        if (!Number.isInteger(idx) || idx < min || idx > max) continue;
        item.checked = checkbox.checked;
        const id = String(item.dataset.rowId || '');
        if (!id) continue;
        if (checkbox.checked) state.erpSelectedRowIds.add(id);
        else state.erpSelectedRowIds.delete(id);
      }
    }
    if (Number.isInteger(rowIndex)) {
      state.erpLastCheckedIndex = rowIndex;
    }
    const all = Array.from(document.querySelectorAll('.erp-row-select'));
    const selected = all.filter((x) => x.checked).length;
    const selectAll = $('erpSelectAll');
    if (selectAll) {
      selectAll.checked = all.length > 0 && selected === all.length;
    }
    updateErpSelectionUi();
    return;
  }

  const canEdit = !!(state.erpData && state.erpData.canEdit);
  const rowEl = target.closest('tr');
  if (canEdit && rowEl && target.closest('tbody') && !target.closest('button, a, input, select, textarea, label')) {
    const rowId = String(rowEl.dataset.rowId || '');
    if (rowId) {
      const rowCheckbox = rowEl.querySelector('.erp-row-select');
      if (rowCheckbox instanceof HTMLInputElement) {
        rowCheckbox.checked = !rowCheckbox.checked;
        if (rowCheckbox.checked) state.erpSelectedRowIds.add(rowId);
        else state.erpSelectedRowIds.delete(rowId);
        const all = Array.from(document.querySelectorAll('.erp-row-select'));
        const selected = all.filter((x) => x.checked).length;
        const selectAll = $('erpSelectAll');
        if (selectAll) {
          selectAll.checked = all.length > 0 && selected === all.length;
        }
        updateErpSelectionUi();
        return;
      }
    }
  }
  const editBtn = target.closest('.erp-edit');
  const delBtn = target.closest('.erp-delete');
  const { key, sheet } = currentErpSheet();
  if (!key || !sheet) {
    return;
  }
  if (editBtn) {
    const rowId = String(editBtn.dataset.rowId || '');
    const row = (sheet.rows || []).find((item) => String(item.id || '') === rowId);
    if (!row) {
      return;
    }
    fillErpFormFromRow(row);
    return;
  }
  if (delBtn) {
    const rowId = String(delBtn.dataset.rowId || '');
    if (!rowId) {
      return;
    }
    if (!window.confirm('이 행을 삭제하시겠습니까?')) {
      return;
    }
    try {
      await api(`/api/guilds/${state.guildId}/erp/${key}/rows/${rowId}`, { method: 'DELETE' });
      setStatus('ERP 행 삭제 완료');
      clearErpForm();
      await loadErpData();
    } catch (error) {
      setStatus(`ERP 행 삭제 실패: ${error.message}`, 'error');
    }
  }
});

$('erpTable').addEventListener('dblclick', async (event) => {
  try {
    if (!$('erpQuickEditToggle').checked) {
      return;
    }
    const canEdit = !!(state.erpData && state.erpData.canEdit);
    if (!canEdit) {
      return;
    }
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const cell = target.closest('.erp-cell');
    if (!cell) {
      return;
    }
    const tr = cell.closest('tr');
    const rowId = tr ? String(tr.dataset.rowId || '') : '';
    const colId = String(cell.dataset.colId || '');
    if (!rowId || !colId) {
      return;
    }
    const row = findErpRowById(rowId);
    if (!row) {
      return;
    }
    const { key, sheet } = currentErpSheet();
    const column = (sheet && sheet.columns || []).find((c) => c.id === colId);
    if (!column) {
      return;
    }
    const currentValue = String(row[colId] || '');
    let nextValue = currentValue;
    if (column.type === 'select' && Array.isArray(column.options)) {
      const guide = `${column.options.join(', ')}`;
      const input = window.prompt(`${column.label} 값을 입력하세요.\n가능한 값: ${guide}`, currentValue);
      if (input === null) {
        return;
      }
      const found = column.options.find((opt) => String(opt).toLowerCase() === String(input).trim().toLowerCase());
      if (!found) {
        alert(`유효하지 않은 값입니다.\n가능한 값: ${guide}`);
        return;
      }
      nextValue = found;
    } else {
      const input = window.prompt(`${column.label} 값을 입력하세요.`, currentValue);
      if (input === null) {
        return;
      }
      nextValue = String(input).trim();
    }
    if (nextValue === currentValue) {
      return;
    }
    const payload = {};
    for (const c of sheet.columns) {
      payload[c.id] = String(row[c.id] || '');
    }
    payload[colId] = nextValue;
    await api(`/api/guilds/${state.guildId}/erp/${key}/rows/${rowId}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
    await loadErpData();
    setStatus('빠른 수정 완료');
  } catch (error) {
    setStatus(`빠른 수정 실패: ${error.message}`, 'error');
  }
});

$('erpTable').addEventListener('change', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) {
    return;
  }
  if (target.id === 'erpSelectAll') {
    const checked = !!target.checked;
    const rows = Array.from(document.querySelectorAll('.erp-row-select'));
    for (const row of rows) {
      row.checked = checked;
      const rowId = String(row.dataset.rowId || '');
      if (!rowId) continue;
      if (checked) state.erpSelectedRowIds.add(rowId);
      else state.erpSelectedRowIds.delete(rowId);
    }
    updateErpSelectionUi();
    return;
  }
  if (target.classList.contains('erp-row-select')) {
    const rowId = String(target.dataset.rowId || '');
    if (!rowId) return;
    if (target.checked) state.erpSelectedRowIds.add(rowId);
    else state.erpSelectedRowIds.delete(rowId);
    const all = Array.from(document.querySelectorAll('.erp-row-select'));
    const selected = all.filter((x) => x.checked).length;
    const selectAll = $('erpSelectAll');
    if (selectAll) {
      selectAll.checked = all.length > 0 && selected === all.length;
    }
    updateErpSelectionUi();
  }
});

$('erpDeleteSelectedBtn').addEventListener('click', async () => {
  try {
    if (!state.guildId) throw new Error('길드를 먼저 선택하세요.');
    const { key } = currentErpSheet();
    const rowIds = Array.from(state.erpSelectedRowIds);
    if (!key || rowIds.length === 0) throw new Error('삭제할 행을 선택하세요.');
    if (!window.confirm(`선택한 ${rowIds.length}개 행을 삭제하시겠습니까?`)) return;
    const result = await api(`/api/guilds/${state.guildId}/erp/${key}/rows/delete-many`, {
      method: 'POST',
      body: JSON.stringify({ rowIds })
    });
    state.erpSelectedRowIds.clear();
    clearErpForm();
    await loadErpData();
    setStatus(`ERP ${result.removedCount || rowIds.length}개 행 삭제 완료`);
    updateErpSelectionUi();
  } catch (error) {
    setStatus(`ERP 선택 삭제 실패: ${error.message}`, 'error');
  }
});

$('erpRestoreSelectedBtn').addEventListener('click', async () => {
  try {
    if (!state.guildId) throw new Error('길드를 먼저 선택하세요.');
    const { key } = currentErpSheet();
    const rowIds = selectedValues($('erpDeletedRowsSelect'));
    if (!key || rowIds.length === 0) throw new Error('복구할 삭제행을 선택하세요.');
    const result = await api(`/api/guilds/${state.guildId}/erp/${key}/rows/restore`, {
      method: 'POST',
      body: JSON.stringify({ rowIds })
    });
    await loadErpData();
    setStatus(`ERP ${result.restoredCount || rowIds.length}개 행 복구 완료`);
    closeModal('erpRestoreModal');
    updateErpSelectionUi();
  } catch (error) {
    setStatus(`ERP 복구 실패: ${error.message}`, 'error');
  }
});

$('sendEmbed').addEventListener('click', async () => {
  $('embedResult').textContent = '전송 중...';
  try {
    const targetGuildId = String($('masterOperatorGuild').value || state.guildId || '').trim();
    const payload = {
      channelId: $('embedChannel').value || String($('embedChannelManual').value || '').trim(),
      title: $('embedTitle').value.trim(),
      description: $('embedDesc').value.trim(),
      color: $('embedColor').value.trim() || '#2b8cff'
    };
    if (!targetGuildId) {
      throw new Error('길드를 먼저 선택하세요.');
    }
    if (!payload.channelId || !payload.title || !payload.description) {
      throw new Error('채널, 제목, 내용을 모두 입력하세요.');
    }
    const result = await apiMaster(`/api/master/guilds/${targetGuildId}/embed`, { method: 'POST', body: JSON.stringify(payload) });
    $('embedResult').textContent = `전송 완료 (messageId: ${result.messageId})`;
    $('embedResult').style.color = '#128058';
  } catch (error) {
    $('embedResult').textContent = `전송 실패: ${error.message}`;
    $('embedResult').style.color = '#d13a49';
  }
});

$('runResequence').addEventListener('click', async () => {
  $('resequenceResult').textContent = '처리 중...';
  try {
    const requesterUserId = state.authUser && state.authUser.id
      ? state.authUser.id
      : String($('resequenceRequesterUserId').value || '').trim();
    const selectedNos = Array.from(state.selectedOpsTicketNos).map((n) => Number.parseInt(n, 10)).filter((n) => Number.isInteger(n) && n > 0);
    const removeTicketNos = selectedNos.length ? selectedNos : parseTicketNoList($('removeTicketNos').value);
    if (!requesterUserId) {
      throw new Error('발신자 Discord User ID를 입력하세요.');
    }
    localStorage.setItem(guildStorageKey('resequenceRequesterUserId'), requesterUserId);
    const result = await api(`/api/guilds/${state.guildId}/tickets/resequence`, {
      method: 'POST',
      body: JSON.stringify({ requesterUserId, removeTicketNos })
    });
    $('resequenceResult').textContent = `완료: nextTicketNo=${result.nextTicketNo}, open=${result.openCount}, closed=${result.closedCount}`;
    $('resequenceResult').style.color = '#128058';
    state.selectedOpsTicketNos.clear();
    $('removeTicketNos').value = '';
    $('opsSelectAll').checked = false;
    await loadData();
  } catch (error) {
    $('resequenceResult').textContent = `실패: ${error.message}`;
    $('resequenceResult').style.color = '#d13a49';
  }
});

$('opsSelectAll').addEventListener('change', () => {
  const checked = !!$('opsSelectAll').checked;
  const checkboxes = Array.from(document.querySelectorAll('.ops-ticket-select'));
  if (!checkboxes.length) {
    state.selectedOpsTicketNos.clear();
    $('removeTicketNos').value = '';
    return;
  }
  for (const el of checkboxes) {
    const no = Number.parseInt(el.dataset.ticketNo || '', 10);
    if (!Number.isInteger(no) || no <= 0) {
      continue;
    }
    el.checked = checked;
    if (checked) {
      state.selectedOpsTicketNos.add(no);
    } else {
      state.selectedOpsTicketNos.delete(no);
    }
  }
  $('removeTicketNos').value = Array.from(state.selectedOpsTicketNos).sort((a, b) => a - b).join(', ');
});

$('opsHistoryTable').addEventListener('change', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) {
    return;
  }
  if (!target.classList.contains('ops-ticket-select')) {
    return;
  }
  const no = Number.parseInt(target.dataset.ticketNo || '', 10);
  if (!Number.isInteger(no) || no <= 0) {
    return;
  }
  if (target.checked) {
    state.selectedOpsTicketNos.add(no);
  } else {
    state.selectedOpsTicketNos.delete(no);
  }
  const checkboxes = Array.from(document.querySelectorAll('.ops-ticket-select'));
  const totalRows = checkboxes.length;
  const selectedCount = checkboxes.filter((el) => el.checked).length;
  $('opsSelectAll').checked = totalRows > 0 && selectedCount === totalRows;
  $('removeTicketNos').value = Array.from(state.selectedOpsTicketNos).sort((a, b) => a - b).join(', ');
});

$('clearSelectedTickets').addEventListener('click', () => {
  state.selectedOpsTicketNos.clear();
  $('opsSelectAll').checked = false;
  const checkboxes = Array.from(document.querySelectorAll('.ops-ticket-select'));
  for (const el of checkboxes) {
    el.checked = false;
  }
  $('removeTicketNos').value = '';
});

$('masterOperatorGuild').addEventListener('change', async () => {
  localStorage.setItem('masterOperatorGuildId', $('masterOperatorGuild').value || '');
  try {
    const selectedGuildId = String($('masterOperatorGuild').value || '').trim();
    if (selectedGuildId && $('guild').value !== selectedGuildId) {
      $('guild').value = selectedGuildId;
      state.guildId = selectedGuildId;
      await loadData();
    }
    await loadMasterActors();
    await loadMasterErpAudit();
  } catch (error) {
    setStatus(`운영 권한 대상 로드 실패: ${error.message}`, 'error');
  }
});

$('masterAddOperatorUsers').addEventListener('click', async () => {
  try {
    const guildId = String($('masterOperatorGuild').value || '').trim();
    const userIds = selectedValues($('masterOperatorMemberMulti'));
    if (!guildId || userIds.length === 0) throw new Error('길드와 사용자를 선택하세요.');
    await Promise.all(userIds.map((userId) =>
      apiMaster(`/api/master/guilds/${guildId}/operators-users`, {
        method: 'POST',
        body: JSON.stringify({ action: 'add', userId })
      })
    ));
    await refreshMasterActors(guildId);
  } catch (error) {
    setStatus(`Operations 사용자 추가 실패: ${error.message}`, 'error');
  }
});

$('masterRemoveOperatorUsers').addEventListener('click', async () => {
  try {
    const guildId = String($('masterOperatorGuild').value || '').trim();
    const userIds = selectedValues($('masterOperatorMemberMulti')).concat(selectedValues($('masterCurrentOperatorUsers')));
    const uniq = Array.from(new Set(userIds.filter(Boolean)));
    if (!guildId || uniq.length === 0) throw new Error('길드와 제거할 사용자를 선택하세요.');
    await Promise.all(uniq.map((userId) =>
      apiMaster(`/api/master/guilds/${guildId}/operators-users`, {
        method: 'POST',
        body: JSON.stringify({ action: 'remove', userId })
      })
    ));
    await refreshMasterActors(guildId);
  } catch (error) {
    setStatus(`Operations 사용자 제거 실패: ${error.message}`, 'error');
  }
});

$('masterAddOperatorRoles').addEventListener('click', async () => {
  try {
    const guildId = String($('masterOperatorGuild').value || '').trim();
    const roleIds = selectedValues($('masterOperatorRoleMulti'));
    if (!guildId || roleIds.length === 0) throw new Error('길드와 역할을 선택하세요.');
    await Promise.all(roleIds.map((roleId) =>
      apiMaster(`/api/master/guilds/${guildId}/operators-roles`, {
        method: 'POST',
        body: JSON.stringify({ action: 'add', roleId })
      })
    ));
    await refreshMasterActors(guildId);
  } catch (error) {
    setStatus(`Operations 역할 추가 실패: ${error.message}`, 'error');
  }
});

$('masterRemoveOperatorRoles').addEventListener('click', async () => {
  try {
    const guildId = String($('masterOperatorGuild').value || '').trim();
    const roleIds = selectedValues($('masterOperatorRoleMulti')).concat(selectedValues($('masterCurrentOperatorRoles')));
    const uniq = Array.from(new Set(roleIds.filter(Boolean)));
    if (!guildId || uniq.length === 0) throw new Error('길드와 제거할 역할을 선택하세요.');
    await Promise.all(uniq.map((roleId) =>
      apiMaster(`/api/master/guilds/${guildId}/operators-roles`, {
        method: 'POST',
        body: JSON.stringify({ action: 'remove', roleId })
      })
    ));
    await refreshMasterActors(guildId);
  } catch (error) {
    setStatus(`Operations 역할 제거 실패: ${error.message}`, 'error');
  }
});

$('masterRestoreDeletedTickets').addEventListener('click', async () => {
  try {
    const guildId = String($('masterOperatorGuild').value || '').trim();
    const ticketNos = selectedValues($('masterDeletedTicketMulti'))
      .map((x) => Number.parseInt(String(x), 10))
      .filter((x) => Number.isInteger(x) && x > 0);
    if (!guildId || ticketNos.length === 0) {
      throw new Error('길드와 복구할 티켓을 선택하세요.');
    }
    const result = await apiMaster(`/api/master/guilds/${guildId}/restore-tickets`, {
      method: 'POST',
      body: JSON.stringify({ ticketNos })
    });
    $('masterRestoreResult').textContent = `복구 완료: ${result.restoredCount}건`;
    $('masterRestoreResult').style.color = '#128058';
    await refreshMasterActors(guildId);
    await loadData().catch(() => {});
  } catch (error) {
    $('masterRestoreResult').textContent = `복구 실패: ${error.message}`;
    $('masterRestoreResult').style.color = '#d13a49';
  }
});

$('masterLoadErpAuditBtn').addEventListener('click', async () => {
  try {
    await loadMasterErpAudit();
    setStatus('ERP 변경 로그 조회 완료');
  } catch (error) {
    setStatus(`ERP 변경 로그 조회 실패: ${error.message}`, 'error');
  }
});

$('masterErpAuditSheet').addEventListener('change', () => {
  loadMasterErpAudit().catch(() => {});
});

$('masterErpAuditRowNo').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    $('masterLoadErpAuditBtn').click();
  }
});

$('masterErpAuditKeyword').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    $('masterLoadErpAuditBtn').click();
  }
});

(async () => {
  switchTab('overview');
  await loadAuthConfig();
  await loadAuthUser();
  applyDashboardVisibility();

  if (isOauthLoginRequired()) {
    if (!hasDashboardAccess()) {
      setStatus('Discord 로그인 후 대시보드가 표시됩니다.');
    } else {
      try {
        await loadGuilds();
        await loadData();
        restartAutoRefresh();
      } catch (error) {
        setStatus(`초기 로드 실패: ${error.message}`, 'error');
      }
    }
  } else if (!state.token) {
    setStatus('토큰을 입력해 연결하세요.');
  } else {
    try {
      await loadGuilds();
      await loadData();
      restartAutoRefresh();
    } catch (error) {
      setStatus(`초기 로드 실패: ${error.message}`, 'error');
    }
  }

  if (state.technicalLead) {
    await loadMasterData().catch(() => {});
  }
})();
