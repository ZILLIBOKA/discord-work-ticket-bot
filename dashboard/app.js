const $ = (id) => document.getElementById(id);

const state = {
  token: localStorage.getItem('dashboardToken') || '',
  masterToken: localStorage.getItem('masterDashboardToken') || '',
  guildId: '',
  data: null,
  masterData: null,
  refreshTimer: null,
  activeTab: 'ops'
};

if (state.token) {
  $('token').value = state.token;
}
if (state.masterToken) {
  $('masterToken').value = state.masterToken;
}

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
  return { 'x-dashboard-token': state.token, 'content-type': 'application/json' };
}

function masterAuthHeaders() {
  return { 'x-master-token': state.masterToken, 'content-type': 'application/json' };
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
  if (answers.length === 0) {
    return '-';
  }
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
  } else if (rows[0] && rows[0].id) {
    el.value = rows[0].id;
  }
}

function renderEmptyRow(tbody, colCount, text) {
  const tr = document.createElement('tr');
  tr.innerHTML = `<td colspan="${colCount}" class="muted-cell">${text}</td>`;
  tbody.appendChild(tr);
}

function switchTab(tab) {
  state.activeTab = tab === 'master' ? 'master' : 'ops';
  const opsActive = state.activeTab === 'ops';
  $('opsSection').style.display = opsActive ? '' : 'none';
  $('masterSection').style.display = opsActive ? 'none' : '';
  $('opsTabBtn').classList.toggle('active', opsActive);
  $('masterTabBtn').classList.toggle('active', !opsActive);
}

function ticketStatusChip(t) {
  if (t.claimedBy) {
    const who = t.claimedByTag || t.claimedBy;
    return `<span class="chip ok">Claimed · ${who}</span>`;
  }
  return '<span class="chip warn">Open · Unassigned</span>';
}

function getFilteredClosedTickets(list) {
  const type = $('historyType').value;
  const search = $('historySearch').value.trim().toLowerCase();
  return (list || []).filter((t) => {
    if (type !== 'all' && t.ticketType !== type) {
      return false;
    }
    if (!search) {
      return true;
    }
    const target = [t.ownerTag, t.ownerId, t.channelName, t.closeReason, t.ticketTypeLabel]
      .concat((Array.isArray(t.intake) ? t.intake : []).map((x) => `${x.label || ''} ${x.value || ''}`))
      .map((x) => String(x || '').toLowerCase())
      .join(' ');
    return target.includes(search);
  });
}

function renderTables() {
  const openBody = $('openTable').querySelector('tbody');
  const closedBody = $('closedTable').querySelector('tbody');
  openBody.innerHTML = '';
  closedBody.innerHTML = '';

  const openTickets = state.data.openTickets || [];
  const closedTickets = state.data.closedTickets || [];
  const filteredClosed = getFilteredClosedTickets(closedTickets);

  $('openCount').textContent = String(openTickets.length);
  $('closedCount').textContent = String(closedTickets.length);

  if (openTickets.length === 0) {
    renderEmptyRow(openBody, 7, '열린 티켓이 없습니다.');
  } else {
    for (const t of openTickets) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${t.ticketNo || '-'}</td><td>${t.ticketTypeLabel}</td><td>${ticketStatusChip(t)}</td><td>${escapeHtml(t.ownerTag || t.ownerId)}</td><td>${escapeHtml(t.channelName)}</td><td>${formatTicketDetails(t)}</td><td>${fmt(t.createdAt)}</td>`;
      openBody.appendChild(tr);
    }
  }

  if (filteredClosed.length === 0) {
    renderEmptyRow(closedBody, 6, '조건에 맞는 닫힌 티켓이 없습니다.');
  } else {
    for (const t of filteredClosed) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${t.ticketNo || '-'}</td><td>${t.ticketTypeLabel}</td><td>${escapeHtml(t.ownerTag || t.ownerId)}</td><td>${fmt(t.closedAt)}</td><td>${formatTicketDetails(t)}</td><td>${escapeHtml(t.closeReason || '-')}</td>`;
      closedBody.appendChild(tr);
    }
  }
}

function renderMasterTable() {
  const tbody = $('masterGuildTable').querySelector('tbody');
  tbody.innerHTML = '';
  const guilds = (state.masterData && state.masterData.guilds) || [];
  if (guilds.length === 0) {
    renderEmptyRow(tbody, 6, '마스터 데이터가 없습니다.');
    return;
  }

  for (const g of guilds) {
    const tr = document.createElement('tr');
    const managerText = `${g.managerUsers || 0} users / ${g.managerRoles || 0} roles`;
    const toggleLabel = g.ticketEnabled ? 'OFF' : 'ON';
    const toggleClass = g.ticketEnabled ? 'btn-danger' : 'btn-primary';
    tr.innerHTML = `<td>${escapeHtml(g.guildName)}</td><td>${g.ticketEnabled ? '<span class="chip ok">ON</span>' : '<span class="chip warn">OFF</span>'}</td><td>${g.openTickets || 0}</td><td>${g.closedTickets || 0}</td><td>${escapeHtml(managerText)}</td><td><button class="btn ${toggleClass}" data-master-toggle="${escapeHtml(g.guildId)}">${toggleLabel}</button></td>`;
    tbody.appendChild(tr);
  }
}

function fillMasterGuildSelect() {
  const guildRows = (state.masterData && state.masterData.guilds ? state.masterData.guilds : []).map((g) => ({
    id: g.guildId,
    name: g.guildName
  }));
  const savedMasterGuild = localStorage.getItem('masterManagerGuildId') || '';
  fillSelect($('masterManagerGuild'), guildRows, 'name', '길드 없음', savedMasterGuild);
  if ($('masterManagerGuild').value) {
    localStorage.setItem('masterManagerGuildId', $('masterManagerGuild').value);
  }
}

async function loadMasterData() {
  const data = await apiMaster('/api/master/overview');
  state.masterData = data;
  const botTag = data.bot && data.bot.tag ? data.bot.tag : '-';
  const guildCount = data.bot && Number.isInteger(data.bot.guildCount) ? data.bot.guildCount : 0;
  const totalOpen = data.summary && Number.isInteger(data.summary.totalOpen) ? data.summary.totalOpen : 0;
  const totalClosed = data.summary && Number.isInteger(data.summary.totalClosed) ? data.summary.totalClosed : 0;
  $('masterSummary').textContent = `Bot: ${botTag} | Guilds: ${guildCount} | Open: ${totalOpen} | Closed: ${totalClosed}`;
  fillMasterGuildSelect();
  renderMasterTable();
}

async function masterToggleAll(enabled) {
  await apiMaster('/api/master/tickets-enabled', {
    method: 'POST',
    body: JSON.stringify({ enabled: !!enabled })
  });
  await loadMasterData();
}

async function masterToggleGuild(guildId, enabled) {
  await apiMaster(`/api/master/guilds/${guildId}/tickets-enabled`, {
    method: 'POST',
    body: JSON.stringify({ enabled: !!enabled })
  });
  await loadMasterData();
}

async function masterUpdateManagerUser(action) {
  const guildId = String($('masterManagerGuild').value || '').trim();
  const userId = String($('masterManagerUserId').value || '').trim();
  if (!guildId || !userId) {
    throw new Error('길드와 사용자 ID를 입력하세요.');
  }

  await apiMaster(`/api/master/guilds/${guildId}/manager-users`, {
    method: 'POST',
    body: JSON.stringify({ action, userId })
  });
  $('masterManagerUserId').value = '';
  await loadMasterData();
}

async function loadGuilds() {
  const data = await api('/api/guilds');
  const guilds = data.guilds || [];

  fillSelect($('guild'), guilds, 'name', '접근 가능한 길드가 없습니다');
  if (!state.guildId && guilds[0]) {
    state.guildId = guilds[0].id;
    $('guild').value = state.guildId;
  }

  if (guilds.length === 0) {
    throw new Error('길드 목록이 비어 있습니다. 봇 초대/권한을 확인하세요.');
  }
}

async function loadData() {
  state.guildId = $('guild').value;
  if (!state.guildId) {
    throw new Error('길드를 먼저 선택하세요.');
  }

  const data = await api(`/api/guilds/${state.guildId}/data`);
  state.data = data;
  const savedEmbedChannelId = localStorage.getItem(guildStorageKey('embedChannelId')) || '';

  fillSelect($('memberSelect'), data.memberOptions || [], 'name', '멤버 목록 없음 (ID 수동 관리 권장)');
  fillSelect($('roleSelect'), data.roleOptions || [], 'name', '역할 목록 없음');
  fillSelect($('embedChannel'), data.textChannels || [], 'name', '텍스트 채널 없음', savedEmbedChannelId);
  if ($('embedChannel').value) {
    localStorage.setItem(guildStorageKey('embedChannelId'), $('embedChannel').value);
  }

  $('managerSummary').textContent = `사용자: ${(data.managerUsers || []).map((x) => x.label).join(', ') || '없음'} | 역할: ${(data.managerRoles || []).map((x) => x.label).join(', ') || '없음'}`;
  renderTables();
  setLastSync();
  const available = data.channelStats && Number.isInteger(data.channelStats.availableTextChannels)
    ? data.channelStats.availableTextChannels
    : (data.textChannels || []).length;
  const memberCount = (data.memberOptions || []).length;
  const roleCount = (data.roleOptions || []).length;
  let status = `길드 '${data.guild && data.guild.name ? data.guild.name : state.guildId}' 동기화 완료 · 채널 ${available}개 · 멤버 ${memberCount}명 · 역할 ${roleCount}개`;
  if (memberCount === 0) {
    status += ' (멤버 인텐트/권한 제한 가능)';
  }
  if (available === 0) {
    status += ' (채널 권한 확인 필요)';
  }
  setStatus(status);
}

function restartAutoRefresh() {
  if (state.refreshTimer) {
    clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }

  if (!$('liveToggle').checked) {
    return;
  }

  const interval = Math.max(3000, Number($('liveInterval').value || 10000));
  state.refreshTimer = setInterval(async () => {
    if (!state.token || !state.guildId) {
      return;
    }
    try {
      await loadData();
    } catch (error) {
      setStatus(`라이브 동기화 실패: ${error.message}`, 'error');
    }
  }, interval);
}

async function updateManager(kind, action) {
  const selectedId = kind === 'users' ? $('memberSelect').value : $('roleSelect').value;
  const manualUserId = kind === 'users' ? String($('memberManualId').value || '').trim() : '';
  const id = kind === 'users' ? (manualUserId || selectedId) : selectedId;
  if (!id) {
    setStatus('선택 가능한 항목이 없어 작업을 건너뜁니다.', 'error');
    return;
  }

  const body = kind === 'users' ? { action, userId: id } : { action, roleId: id };
  await api(`/api/guilds/${state.guildId}/manager-${kind}`, {
    method: 'POST',
    body: JSON.stringify(body)
  });

  await loadData();
  if (kind === 'users' && manualUserId) {
    $('memberManualId').value = '';
  }
}

$('saveToken').addEventListener('click', async () => {
  try {
    state.token = $('token').value.trim();
    if (!state.token) {
      setStatus('토큰을 입력하세요.', 'error');
      return;
    }
    localStorage.setItem('dashboardToken', state.token);
    await loadGuilds();
    await loadData();
    restartAutoRefresh();
  } catch (error) {
    setStatus(`토큰 저장 실패: ${error.message}`, 'error');
  }
});

$('saveMasterToken').addEventListener('click', async () => {
  try {
    state.masterToken = $('masterToken').value.trim();
    if (!state.masterToken) {
      throw new Error('마스터 토큰을 입력하세요.');
    }
    localStorage.setItem('masterDashboardToken', state.masterToken);
    await loadMasterData();
    setStatus('마스터 토큰 저장 및 검증 완료');
  } catch (error) {
    setStatus(`마스터 토큰 실패: ${error.message}`, 'error');
  }
});

$('load').addEventListener('click', async () => {
  try {
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
    await loadData();
  } catch (error) {
    setStatus(`길드 변경 실패: ${error.message}`, 'error');
  }
});

$('masterManagerGuild').addEventListener('change', () => {
  localStorage.setItem('masterManagerGuildId', $('masterManagerGuild').value || '');
});

$('embedChannel').addEventListener('change', () => {
  if (!state.guildId) {
    return;
  }
  localStorage.setItem(guildStorageKey('embedChannelId'), $('embedChannel').value || '');
});

$('liveToggle').addEventListener('change', restartAutoRefresh);
$('liveInterval').addEventListener('change', restartAutoRefresh);
$('opsTabBtn').addEventListener('click', () => switchTab('ops'));
$('masterTabBtn').addEventListener('click', () => switchTab('master'));

$('historyType').addEventListener('change', renderTables);
$('historySearch').addEventListener('input', renderTables);
$('historyClear').addEventListener('click', () => {
  $('historyType').value = 'all';
  $('historySearch').value = '';
  renderTables();
});

$('addManagerUser').addEventListener('click', () => updateManager('users', 'add').catch((e) => setStatus(`사용자 추가 실패: ${e.message}`, 'error')));
$('removeManagerUser').addEventListener('click', () => updateManager('users', 'remove').catch((e) => setStatus(`사용자 제거 실패: ${e.message}`, 'error')));
$('addManagerRole').addEventListener('click', () => updateManager('roles', 'add').catch((e) => setStatus(`역할 추가 실패: ${e.message}`, 'error')));
$('removeManagerRole').addEventListener('click', () => updateManager('roles', 'remove').catch((e) => setStatus(`역할 제거 실패: ${e.message}`, 'error')));

$('masterEnableAll').addEventListener('click', async () => {
  try {
    await masterToggleAll(true);
  } catch (error) {
    setStatus(`전체 ON 실패: ${error.message}`, 'error');
  }
});

$('masterDisableAll').addEventListener('click', async () => {
  try {
    await masterToggleAll(false);
  } catch (error) {
    setStatus(`전체 OFF 실패: ${error.message}`, 'error');
  }
});

$('masterAddManagerUser').addEventListener('click', async () => {
  try {
    await masterUpdateManagerUser('add');
  } catch (error) {
    setStatus(`마스터 사용자 추가 실패: ${error.message}`, 'error');
  }
});

$('masterRemoveManagerUser').addEventListener('click', async () => {
  try {
    await masterUpdateManagerUser('remove');
  } catch (error) {
    setStatus(`마스터 사용자 제거 실패: ${error.message}`, 'error');
  }
});

$('masterGuildTable').addEventListener('click', async (ev) => {
  const target = ev.target;
  if (!target || !target.dataset || !target.dataset.masterToggle) {
    return;
  }
  const guildId = target.dataset.masterToggle;
  const guild = (state.masterData && state.masterData.guilds || []).find((g) => g.guildId === guildId);
  if (!guild) {
    return;
  }
  try {
    await masterToggleGuild(guildId, !guild.ticketEnabled);
  } catch (error) {
    setStatus(`길드 티켓 상태 변경 실패: ${error.message}`, 'error');
  }
});

$('sendEmbed').addEventListener('click', async () => {
  $('embedResult').textContent = '전송 중...';
  try {
    const selectedChannelId = $('embedChannel').value;
    const manualChannelId = String($('embedChannelManual').value || '').trim();
    const payload = {
      channelId: selectedChannelId || manualChannelId,
      title: $('embedTitle').value.trim(),
      description: $('embedDesc').value.trim(),
      color: $('embedColor').value.trim() || '#2b8cff'
    };

    if (!payload.channelId || !payload.title || !payload.description) {
      throw new Error('채널(선택 또는 ID 직접 입력), 제목, 내용을 모두 입력하세요.');
    }

    const result = await api(`/api/guilds/${state.guildId}/embed`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    $('embedResult').textContent = `전송 완료 (messageId: ${result.messageId})`;
    $('embedResult').style.color = '#128058';
  } catch (error) {
    $('embedResult').textContent = `전송 실패: ${error.message}`;
    $('embedResult').style.color = '#d13a49';
  }
});

(async () => {
  switchTab('ops');

  if (!state.token) {
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

  if (state.masterToken) {
    try {
      await loadMasterData();
    } catch (_error) {
      // silent: user can reload manually
    }
  }
})();
