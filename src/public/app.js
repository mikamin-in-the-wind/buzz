const $ = (id) => document.getElementById(id);
const settingIds = ['discordBotToken', 'gcpProjectId', 'credentialsPath'];

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

function currentSettings() {
  return Object.fromEntries(settingIds.map((id) => [id, $(id).value.trim()]));
}

async function saveSettings() {
  await api('/api/settings', { method: 'PUT', body: JSON.stringify(currentSettings()) });
  setStatus('設定を保存しました。');
}

async function loadSettings() {
  const settings = await api('/api/settings');
  settingIds.forEach((id) => { $(id).value = settings[id] ?? ''; });
  setStatus('準備完了');
}

$('saveSettings').addEventListener('click', () => saveSettings().catch((error) => setStatus(error.message, true)));
$('showToken').addEventListener('change', (event) => { $('discordBotToken').type = event.target.checked ? 'text' : 'password'; });
$('startDiscord').addEventListener('click', async () => {
  try {
    const result = await api('/api/discord/start', { method: 'POST', body: JSON.stringify(currentSettings()) });
    setStatus(result.message);
  } catch (error) { setStatus(error.message, true); }
});
$('startYouTube').addEventListener('click', async () => {
  try {
    const result = await api('/api/youtube/start', { method: 'POST', body: JSON.stringify({ liveUrlOrId: $('liveUrlOrId').value.trim() }) });
    setStatus(result.message);
  } catch (error) { setStatus(error.message, true); }
});
$('commandForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const result = await api('/api/command', { method: 'POST', body: JSON.stringify({ command: $('command').value.trim() }) });
    setStatus(result.message);
  } catch (error) { setStatus(error.message, true); }
});
new EventSource('/events').addEventListener('chat', (event) => { $('chat').value = JSON.parse(event.data); });
loadSettings().catch((error) => setStatus(error.message, true));
