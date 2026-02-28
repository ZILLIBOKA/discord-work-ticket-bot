const $ = (id) => document.getElementById(id);

const state = {
  token: localStorage.getItem('dashboardToken') || '',
  guildId: '',
  data: null,
  refreshTimer: null
};

if (state.token) {
  $('token').value = state.token;
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

function fmt(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function fillSelect(el, rows, labelKey = 'name', emptyText = '선택 가능한 항목 없음') {
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
}

function renderEmptyRow(tbody, colCount, text) {
  const tr = document.createElement('tr');
  tr.innerHTML = `<td colspan="${colCount}" class="muted-cell">${text}</td>`;
  tbody.appendChild(tr);
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
    renderEmptyRow(openBody, 6, '열린 티켓이 없습니다.');
  } else {
    for (const t of openTickets) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${t.ticketNo || '-'}</td><td>${t.ticketTypeLabel}</td><td>${ticketStatusChip(t)}</td><td>${t.ownerTag || t.ownerId}</td><td>${t.channelName}</td><td>${fmt(t.createdAt)}</td>`;
      openBody.appendChild(tr);
    }
  }

  if (filteredClosed.length === 0) {
    renderEmptyRow(closedBody, 5, '조건에 맞는 닫힌 티켓이 없습니다.');
  } else {
    for (const t of filteredClosed) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${t.ticketNo || '-'}</td><td>${t.ticketTypeLabel}</td><td>${t.ownerTag || t.ownerId}</td><td>${fmt(t.closedAt)}</td><td>${t.closeReason || '-'}</td>`;
      closedBody.appendChild(tr);
    }
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

  fillSelect($('memberSelect'), data.memberOptions || [], 'name', '멤버 목록 없음 (ID 수동 관리 권장)');
  fillSelect($('roleSelect'), data.roleOptions || [], 'name', '역할 목록 없음');
  fillSelect($('embedChannel'), data.textChannels || [], 'name', '텍스트 채널 없음');

  $('managerSummary').textContent = `사용자: ${(data.managerUsers || []).map((x) => x.label).join(', ') || '없음'} | 역할: ${(data.managerRoles || []).map((x) => x.label).join(', ') || '없음'}`;
  renderTables();
  setLastSync();
  setStatus(`길드 '${data.guild && data.guild.name ? data.guild.name : state.guildId}' 동기화 완료`);
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
  const id = kind === 'users' ? $('memberSelect').value : $('roleSelect').value;
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

$('load').addEventListener('click', async () => {
  try {
    await loadData();
  } catch (error) {
    setStatus(`불러오기 실패: ${error.message}`, 'error');
  }
});

$('guild').addEventListener('change', async () => {
  try {
    await loadData();
  } catch (error) {
    setStatus(`길드 변경 실패: ${error.message}`, 'error');
  }
});

$('liveToggle').addEventListener('change', restartAutoRefresh);
$('liveInterval').addEventListener('change', restartAutoRefresh);

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

$('sendEmbed').addEventListener('click', async () => {
  $('embedResult').textContent = '전송 중...';
  try {
    const payload = {
      channelId: $('embedChannel').value,
      title: $('embedTitle').value.trim(),
      description: $('embedDesc').value.trim(),
      color: $('embedColor').value.trim() || '#2b8cff'
    };

    if (!payload.channelId || !payload.title || !payload.description) {
      throw new Error('채널, 제목, 내용을 모두 입력하세요.');
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
  if (!state.token) {
    setStatus('토큰을 입력해 연결하세요.');
    return;
  }

  try {
    await loadGuilds();
    await loadData();
    restartAutoRefresh();
  } catch (error) {
    setStatus(`초기 로드 실패: ${error.message}`, 'error');
  }
})();
