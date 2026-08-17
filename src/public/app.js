const $ = (id) => document.getElementById(id);
const settingIds = ['discordBotToken', 'gcpProjectId', 'credentialsPath', 'youtubeApiKey', 'youtubeChannel', 'twitchBotUsername', 'twitchOAuthToken', 'twitchClientId', 'twitchChannel'];
const recentComments = [];

function setStatus(message, isError = false) {
  $('status').textContent = message;
  $('status').dataset.error = String(isError);
}

async function api(url, options = {}) {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}

function currentSettings() { return Object.fromEntries(settingIds.map((id) => [id, $(id).value.trim()])); }
function showTab(name) {
  document.querySelectorAll('.tab-panel').forEach((panel) => { panel.hidden = panel.id !== name; });
  document.querySelectorAll('.tab-button').forEach((button) => { button.setAttribute('aria-selected', String(button.dataset.tab === name)); });
}
function renderConnections(connections) {
  for (const [name, value] of Object.entries(connections)) {
    const detail = $(`${name}Connection`);
    if (!detail) continue;
    detail.textContent = value.detail;
    detail.closest('.connection-card').dataset.state = value.state;
  }
}
function formatDate(value) { return new Date(value).toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' }); }
function renderVisitors(visitors, containerId = 'visitors') {
  const container = $(containerId);
  container.replaceChildren();
  if (visitors.length === 0) { container.innerHTML = '<p class="empty-message">まだ投稿者データはありません。</p>'; return; }
  visitors.slice(0, 60).forEach((visitor) => {
    const card = document.createElement('article');
    card.className = 'visitor-card';
    const title = document.createElement('h3'); title.textContent = `${visitor.authorName} · ${visitor.platform}`;
    const info = document.createElement('p'); info.className = 'visitor-info'; info.textContent = `訪問 ${visitor.visitCount ?? 0} 配信　コメント ${visitor.commentCount} 件　初回: ${formatDate(visitor.firstSeenAt)}　最終: ${formatDate(visitor.lastSeenAt)}`;
    const memo = document.createElement('textarea'); memo.rows = 2; memo.value = visitor.memo; memo.placeholder = 'この人へのメモ'; memo.setAttribute('aria-label', `${visitor.authorName} のメモ`);
    const save = document.createElement('button'); save.type = 'button'; save.className = 'secondary memo-save'; save.textContent = 'メモを保存';
    save.addEventListener('click', async () => {
      try { await api('/api/visitors/memo', { method: 'PUT', body: JSON.stringify({ key: visitor.key, memo: memo.value }) }); await loadVisitors(); setStatus(`${visitor.authorName} のメモを保存しました。`); } catch (error) { setStatus(error.message, true); }
    });
    card.append(title, info, memo, save); container.append(card);
  });
}
async function loadVisitors() {
  const [visitors, todayVisitors] = await Promise.all([api('/api/visitors'), api('/api/visitors/today')]);
  renderVisitors(visitors, 'visitors');
  renderVisitors(todayVisitors, 'todayVisitors');
}
function showVisitorView(name) {
  ['comments', 'today', 'visitors'].forEach((view) => { $(`${view}View`).hidden = view !== name; });
  document.querySelectorAll('.sub-tab').forEach((button) => button.setAttribute('aria-selected', String(button.dataset.view === name)));
}
function renderComments() {
  const container = $('chat');
  container.replaceChildren();
  if (recentComments.length === 0) { container.innerHTML = '<p class="empty-message">コメントを待機中</p>'; return; }
  recentComments.forEach((comment) => {
    const item = document.createElement('article'); item.className = 'comment-item';
    const meta = document.createElement('span'); meta.textContent = `${comment.visitor.platform} · ${comment.visitor.authorName} · ${formatDate(comment.visitor.receivedAt)}`;
    const text = document.createElement('p'); text.textContent = comment.visitor.text;
    item.append(meta, text); container.append(item);
  });
}
async function saveSettings() {
  await api('/api/settings', { method: 'PUT', body: JSON.stringify(currentSettings()) });
  setStatus('設定を保存しました。');
}
async function loadSettings() {
  const settings = await api('/api/settings');
  settingIds.forEach((id) => { $(id).value = settings[id] ?? ''; });
  renderConnections(await api('/api/connections'));
  await loadVisitors();
  setStatus('準備完了');
}

document.querySelectorAll('.tab-button').forEach((button) => button.addEventListener('click', () => showTab(button.dataset.tab)));
document.querySelectorAll('.sub-tab').forEach((button) => button.addEventListener('click', () => showVisitorView(button.dataset.view)));
$('saveSettings').addEventListener('click', () => saveSettings().catch((error) => setStatus(error.message, true)));
$('showToken').addEventListener('change', (event) => {
  const type = event.target.checked ? 'text' : 'password';
  ['discordBotToken', 'youtubeApiKey', 'twitchOAuthToken'].forEach((id) => { $(id).type = type; });
});
$('startAll').addEventListener('click', async () => {
  try {
    await saveSettings();
    setStatus('接続を開始しています…');
    setStatus((await api('/api/start', { method: 'POST' })).message);
  } catch (error) { setStatus(error.message, true); }
});
$('commandForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try { setStatus((await api('/api/command', { method: 'POST', body: JSON.stringify({ command: $('command').value.trim() }) })).message); } catch (error) { setStatus(error.message, true); }
});

const events = new EventSource('/events');
events.addEventListener('chat', (event) => {
  const comment = JSON.parse(event.data);
  if (comment.type !== 'comment') return;
  recentComments.unshift(comment);
  recentComments.splice(12);
  renderComments();
  loadVisitors().catch(console.error);
});
events.addEventListener('connections', (event) => renderConnections(JSON.parse(event.data)));
events.addEventListener('status', (event) => { const status = JSON.parse(event.data); setStatus(status.message, status.isError); });
loadSettings().catch((error) => setStatus(error.message, true));
