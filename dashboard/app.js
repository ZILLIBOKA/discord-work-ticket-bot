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
  refreshTimer: null,
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

async function loadAuthConfig() {
  try {
    const res = await fetch('/api/auth/discord/config');
    if (!res.ok) {
      return;
    }
    const data = await res.json();
    state.oauthEnabled = !!data.enabled;
    $('discordLoginBtn').style.display = '';
    $('discordLogoutBtn').style.display = '';
    $('discordLoginBtn').disabled = false;
    $('discordLogoutBtn').disabled = false;
    $('discordLoginBtn').style.opacity = '1';
    $('discordLogoutBtn').style.opacity = '1';
    $('discordLoginBtn').dataset.loginPath = data.loginPath || '/auth/discord/start';
  } catch (_error) {
    state.oauthEnabled = false;
    $('discordLoginBtn').style.display = '';
    $('discordLogoutBtn').style.display = '';
    $('discordLoginBtn').disabled = false;
    $('discordLogoutBtn').disabled = false;
    $('discordLoginBtn').style.opacity = '1';
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
    $('discordLogoutBtn').style.display = '';
  } else {
    $('authUserText').textContent = state.oauthEnabled ? 'Discord 로그인 필요' : 'Discord OAuth 미설정';
    $('discordLoginBtn').style.display = '';
    $('discordLogoutBtn').style.display = '';
    $('discordLoginBtn').disabled = false;
    $('discordLogoutBtn').disabled = false;
    $('discordLoginBtn').style.opacity = '1';
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

function renderEmptyRow(tbody, colCount, text) {
  const tr = document.createElement('tr');
  tr.innerHTML = `<td colspan="${colCount}" class="muted-cell">${text}</td>`;
  tbody.appendChild(tr);
}

function ticketStatusChip(t) {
  if (t.claimedBy) {
    const who = t.claimedByTag || t.claimedBy;
    return `<span class="chip ok">Claimed · ${escapeHtml(who)}</span>`;
  }
  return '<span class="chip warn">Open · Unassigned</span>';
}

function switchTab(tab) {
  if (!hasDashboardAccess()) {
    state.activeTab = 'overview';
    $('overviewTabBtn').classList.add('active');
    $('opsTabBtn').classList.remove('active');
    $('masterTabBtn').classList.remove('active');
    $('overviewSection').style.display = 'none';
    $('opsSection').style.display = 'none';
    $('masterSection').style.display = 'none';
    applyDashboardVisibility();
    return;
  }
  state.activeTab = tab;
  $('overviewSection').style.display = tab === 'overview' ? '' : 'none';
  $('opsSection').style.display = tab === 'ops' ? '' : 'none';
  $('masterSection').style.display = tab === 'master' ? '' : 'none';
  $('overviewTabBtn').classList.toggle('active', tab === 'overview');
  $('opsTabBtn').classList.toggle('active', tab === 'ops');
  $('masterTabBtn').classList.toggle('active', tab === 'master');
  applyDashboardVisibility();
}

function getFilteredClosedTickets(list) {
  const type = $('historyType').value;
  const search = $('historySearch').value.trim().toLowerCase();
  return (list || []).filter((t) => {
    if (type !== 'all' && t.ticketType !== type) return false;
    if (!search) return true;
    const target = [t.ownerTag, t.ownerId, t.channelName, t.closeReason, t.ticketTypeLabel]
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
  const filteredClosed = getFilteredClosedTickets(closedTickets);

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

  if (!filteredClosed.length) {
    renderEmptyRow(closedBody, 6, '조건에 맞는 닫힌 티켓이 없습니다.');
  } else {
    for (const t of filteredClosed) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${t.ticketNo || '-'}</td><td>${escapeHtml(t.ticketTypeLabel)}</td><td>${escapeHtml(t.ownerTag || t.ownerId)}</td><td>${fmt(t.closedAt)}</td><td>${formatTicketDetails(t)}</td><td>${escapeHtml(t.closeReason || '-')}</td>`;
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
  const closedTickets = state.data && state.data.closedTickets ? state.data.closedTickets : [];
  if (!closedTickets.length) {
    renderEmptyRow(tbody, 6, '닫힌 티켓이 없습니다.');
    return;
  }
  for (const t of closedTickets) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${t.ticketNo || '-'}</td><td>${escapeHtml(t.ticketTypeLabel)}</td><td>${escapeHtml(t.ownerTag || t.ownerId)}</td><td>${fmt(t.closedAt)}</td><td>${formatTicketDetails(t)}</td><td>${escapeHtml(t.closeReason || '-')}</td>`;
    tbody.appendChild(tr);
  }
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
}

async function loadMasterActors() {
  const guildId = String($('masterOperatorGuild').value || '').trim();
  if (!guildId) {
    fillMultiSelect($('masterOperatorMemberMulti'), [], 'name', '멤버 없음');
    fillMultiSelect($('masterOperatorRoleMulti'), [], 'name', '역할 없음');
    fillMultiSelect($('masterCurrentOperatorUsers'), [], 'name', '없음');
    fillMultiSelect($('masterCurrentOperatorRoles'), [], 'name', '없음');
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

  $('masterOperatorSummary').textContent = `현재 Operations 사용자 ${currentUsers.length}명 | 역할 ${currentRoles.length}개`;
}

async function refreshMasterActors(guildId) {
  state.masterActorsByGuild[guildId] = null;
  await loadMasterActors();
  await loadMasterData();
}

function parseTicketNoList(raw) {
  return String(raw || '')
    .split(',')
    .map((x) => Number.parseInt(x.trim(), 10))
    .filter((x) => Number.isInteger(x) && x > 0);
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

$('loadMaster').addEventListener('click', async () => {
  try {
    await loadMasterData();
  } catch (error) {
    setStatus(`마스터 로드 실패: ${error.message}`, 'error');
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
$('masterTabBtn').addEventListener('click', () => {
  if (!hasDashboardAccess()) {
    setStatus('먼저 Discord 로그인 후 접근하세요.', 'error');
    return;
  }
  if (!state.technicalLead) {
    setStatus('Master 탭은 Technical Lead만 접근할 수 있습니다.', 'error');
    return;
  }
  switchTab('master');
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
$('discordLoginBtn').addEventListener('click', () => {
  if (!state.oauthEnabled) {
    setStatus('Discord OAuth 미설정입니다. 먼저 Discord 로그인 페이지를 열고, Koyeb OAuth 환경변수를 설정해주세요.', 'error');
    window.open('https://discord.com/login', '_blank', 'noopener,noreferrer');
    return;
  }
  const loginPath = $('discordLoginBtn').dataset.loginPath || '/auth/discord/start';
  const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  window.location.href = `${loginPath}?returnTo=${encodeURIComponent(returnTo)}`;
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

$('sendEmbed').addEventListener('click', async () => {
  $('embedResult').textContent = '전송 중...';
  try {
    const requesterUserId = state.authUser && state.authUser.id
      ? state.authUser.id
      : String($('embedRequesterUserId').value || '').trim();
    const payload = {
      requesterUserId,
      channelId: $('embedChannel').value || String($('embedChannelManual').value || '').trim(),
      title: $('embedTitle').value.trim(),
      description: $('embedDesc').value.trim(),
      color: $('embedColor').value.trim() || '#2b8cff'
    };
    if (!payload.requesterUserId || !payload.channelId || !payload.title || !payload.description) {
      throw new Error('발신자 ID, 채널, 제목, 내용을 모두 입력하세요.');
    }
    localStorage.setItem(guildStorageKey('embedRequesterUserId'), payload.requesterUserId);
    const result = await api(`/api/guilds/${state.guildId}/embed`, { method: 'POST', body: JSON.stringify(payload) });
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
    const removeTicketNos = parseTicketNoList($('removeTicketNos').value);
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
    $('removeTicketNos').value = '';
    await loadData();
  } catch (error) {
    $('resequenceResult').textContent = `실패: ${error.message}`;
    $('resequenceResult').style.color = '#d13a49';
  }
});

$('masterOperatorGuild').addEventListener('change', async () => {
  localStorage.setItem('masterOperatorGuildId', $('masterOperatorGuild').value || '');
  try {
    await loadMasterActors();
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
