const $ = (id) => document.getElementById(id);

const state = {
  token: localStorage.getItem('dashboardToken') || '',
  guildId: '',
  data: null
};

if (state.token) {
  $('token').value = state.token;
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

function fillSelect(el, rows, labelKey = 'name') {
  el.innerHTML = '';
  for (const row of rows) {
    const opt = document.createElement('option');
    opt.value = row.id;
    opt.textContent = row[labelKey] || row.id;
    el.appendChild(opt);
  }
}

function renderTables() {
  const openBody = $('openTable').querySelector('tbody');
  const closedBody = $('closedTable').querySelector('tbody');
  openBody.innerHTML = '';
  closedBody.innerHTML = '';

  for (const t of state.data.openTickets || []) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${t.ticketNo || '-'}</td><td>${t.ticketTypeLabel}</td><td>${t.ownerTag || t.ownerId}</td><td>${t.channelName}</td><td>${fmt(t.createdAt)}</td>`;
    openBody.appendChild(tr);
  }

  for (const t of state.data.closedTickets || []) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${t.ticketNo || '-'}</td><td>${t.ticketTypeLabel}</td><td>${t.ownerTag || t.ownerId}</td><td>${fmt(t.closedAt)}</td><td>${t.closeReason || '-'}</td>`;
    closedBody.appendChild(tr);
  }
}

async function loadGuilds() {
  const data = await api('/api/guilds');
  fillSelect($('guild'), data.guilds);
  if (!state.guildId && data.guilds[0]) {
    state.guildId = data.guilds[0].id;
    $('guild').value = state.guildId;
  }
}

async function loadData() {
  state.guildId = $('guild').value;
  if (!state.guildId) return;
  state.data = await api(`/api/guilds/${state.guildId}/data`);
  fillSelect($('memberSelect'), state.data.memberOptions || []);
  fillSelect($('roleSelect'), state.data.roleOptions || []);
  fillSelect($('embedChannel'), state.data.textChannels || []);
  $('managerSummary').textContent = `사용자: ${(state.data.managerUsers || []).map((x) => x.label).join(', ') || '없음'} | 역할: ${(state.data.managerRoles || []).map((x) => x.label).join(', ') || '없음'}`;
  renderTables();
}

async function updateManager(kind, action) {
  const id = kind === 'users' ? $('memberSelect').value : $('roleSelect').value;
  if (!id) return;
  const body = kind === 'users' ? { action, userId: id } : { action, roleId: id };
  await api(`/api/guilds/${state.guildId}/manager-${kind}`, { method: 'POST', body: JSON.stringify(body) });
  await loadData();
}

$('saveToken').addEventListener('click', async () => {
  state.token = $('token').value.trim();
  localStorage.setItem('dashboardToken', state.token);
  await loadGuilds();
  await loadData();
});

$('load').addEventListener('click', loadData);
$('guild').addEventListener('change', loadData);
$('addManagerUser').addEventListener('click', () => updateManager('users', 'add'));
$('removeManagerUser').addEventListener('click', () => updateManager('users', 'remove'));
$('addManagerRole').addEventListener('click', () => updateManager('roles', 'add'));
$('removeManagerRole').addEventListener('click', () => updateManager('roles', 'remove'));

$('sendEmbed').addEventListener('click', async () => {
  $('embedResult').textContent = '전송중...';
  try {
    const payload = {
      channelId: $('embedChannel').value,
      title: $('embedTitle').value,
      description: $('embedDesc').value,
      color: $('embedColor').value
    };
    const result = await api(`/api/guilds/${state.guildId}/embed`, { method: 'POST', body: JSON.stringify(payload) });
    $('embedResult').textContent = `전송 완료 (messageId: ${result.messageId})`;
  } catch (error) {
    $('embedResult').textContent = `실패: ${error.message}`;
  }
});

(async () => {
  if (!state.token) return;
  try {
    await loadGuilds();
    await loadData();
  } catch (_error) {}
})();
