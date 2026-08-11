const http = require('node:http');
const { readFile, mkdir, rm, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { homedir } = require('node:os');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, NoSubscriberBehavior, StreamType, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const { Client, GatewayIntentBits } = require('discord.js');
const textToSpeech = require('@google-cloud/text-to-speech');
const { Translate } = require('@google-cloud/translate').v2;
const { LiveChat } = require('youtube-chat');
const { extractYouTubeVideoId } = require('./youtube-url');

const host = '127.0.0.1';
const port = Number(process.env.PORT ?? 3210);
const prefix = '/buzz';
const appDataDirectory = path.join(process.env.APPDATA ?? homedir(), 'buzz');
const settingsPath = path.join(appDataDirectory, 'settings.json');
const voicePreferencesPath = path.join(appDataDirectory, 'youtube-voice-preferences.json');
const legacySettingsPaths = [
  path.join(process.env.APPDATA ?? homedir(), 'buzz', 'config.json'),
  path.join(process.env.APPDATA ?? homedir(), 'Electron', 'config.json'),
  path.join(process.env.APPDATA ?? homedir(), 'electron', 'config.json'),
  path.join(process.env.LOCALAPPDATA ?? homedir(), 'buzz', 'config.json'),
  path.join(process.env.LOCALAPPDATA ?? homedir(), 'Electron', 'config.json'),
];
const audioDirectory = path.join(appDataDirectory, 'audio');
const publicDirectory = path.join(__dirname, 'public');
const defaultVoices = {
  'ja-JP': 'ja-JP-Chirp3-HD-Aoede',
  'en-US': 'en-US-Chirp3-HD-Aoede',
  'cmn-CN': 'cmn-CN-Chirp3-HD-Aoede',
  'ru-RU': 'ru-RU-Chirp3-HD-Aoede',
};

const discordClient = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const events = new Set();
const audioQueue = [];
let settings = { discordBotToken: '', credentialsPath: '', gcpProjectId: '' };
let textToSpeechClient;
let translateClient;
let connection;
let player;
let liveChat;
let isPlaying = false;
let youtubeVoicePreferences = {};

function emit(type, data) {
  const message = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const response of events) response.write(message);
}

async function readJson(filePath) {
  try { return JSON.parse(await readFile(filePath, 'utf8')); } catch { return {}; }
}

async function loadSettings() {
  const savedSettings = await readJson(settingsPath);
  const legacySettings = Object.assign({}, ...(await Promise.all(legacySettingsPaths.map(readJson))));
  const migratedSettings = {
    discordBotToken: legacySettings.discord_bot_token,
    credentialsPath: legacySettings.text_to_speech_api_key_path,
    gcpProjectId: legacySettings.gcp_project_id,
  };
  settings = { ...settings, ...migratedSettings, ...savedSettings };
  if (Object.values(migratedSettings).some(Boolean) && Object.keys(savedSettings).length === 0) await saveSettings(settings);
}

async function loadVoicePreferences() {
  youtubeVoicePreferences = await readJson(voicePreferencesPath);
}

async function saveVoicePreferences() {
  await mkdir(appDataDirectory, { recursive: true });
  await writeFile(voicePreferencesPath, JSON.stringify(youtubeVoicePreferences, null, 2), 'utf8');
}

const chirpVoiceChoices = {
  achernar: { label: 'Achernar（女性）', speaker: 'Achernar' },
  achird: { label: 'Achird（男性）', speaker: 'Achird' },
  algenib: { label: 'Algenib（男性）', speaker: 'Algenib' },
  algieba: { label: 'Algieba（男性）', speaker: 'Algieba' },
  alnilam: { label: 'Alnilam（男性）', speaker: 'Alnilam' },
  aoede: { label: 'Aoede（女性）', speaker: 'Aoede' },
  autonoe: { label: 'Autonoe（女性）', speaker: 'Autonoe' },
  callirrhoe: { label: 'Callirrhoe（女性）', speaker: 'Callirrhoe' },
  charon: { label: 'Charon（男性）', speaker: 'Charon' },
  despina: { label: 'Despina（女性）', speaker: 'Despina' },
  enceladus: { label: 'Enceladus（男性）', speaker: 'Enceladus' },
  erinome: { label: 'Erinome（女性）', speaker: 'Erinome' },
  fenrir: { label: 'Fenrir（男性）', speaker: 'Fenrir' },
  gacrux: { label: 'Gacrux（女性）', speaker: 'Gacrux' },
  iapetus: { label: 'Iapetus（男性）', speaker: 'Iapetus' },
  kore: { label: 'Kore（女性）', speaker: 'Kore' },
  laomedeia: { label: 'Laomedeia（女性）', speaker: 'Laomedeia' },
  leda: { label: 'Leda（女性）', speaker: 'Leda' },
  orus: { label: 'Orus（男性）', speaker: 'Orus' },
  pulcherrima: { label: 'Pulcherrima（女性）', speaker: 'Pulcherrima' },
  puck: { label: 'Puck（男性）', speaker: 'Puck' },
  rasalgethi: { label: 'Rasalgethi（男性）', speaker: 'Rasalgethi' },
  sadachbia: { label: 'Sadachbia（男性）', speaker: 'Sadachbia' },
  sadaltager: { label: 'Sadaltager（男性）', speaker: 'Sadaltager' },
  schedar: { label: 'Schedar（男性）', speaker: 'Schedar' },
  sulafat: { label: 'Sulafat（女性）', speaker: 'Sulafat' },
  umbriel: { label: 'Umbriel（男性）', speaker: 'Umbriel' },
  vindemiatrix: { label: 'Vindemiatrix（女性）', speaker: 'Vindemiatrix' },
  zephyr: { label: 'Zephyr（女性）', speaker: 'Zephyr' },
  zubenelgenubi: { label: 'Zubenelgenubi（男性）', speaker: 'Zubenelgenubi' },
};
const voiceAliases = { female: 'aoede', male: 'achird' };

function normalizeVoiceChoice(value) {
  const normalized = value?.toLowerCase();
  return voiceAliases[normalized] ?? normalized;
}

function getYouTubeVoiceName(channelId, languageCode) {
  const preference = youtubeVoicePreferences[channelId];
  const definition = preference && chirpVoiceChoices[normalizeVoiceChoice(preference.profile)];
  const locale = normaliseLanguageCode(languageCode);
  return definition && defaultVoices[locale] ? `${locale}-Chirp3-HD-${definition.speaker}` : undefined;
}

async function setYouTubeVoicePreference(channelId, profile) {
  if (profile === 'default') delete youtubeVoicePreferences[channelId];
  else youtubeVoicePreferences[channelId] = { profile, updatedAt: new Date().toISOString() };
  await saveVoicePreferences();
}

async function saveSettings(nextSettings) {
  settings = { ...settings, ...nextSettings };
  await mkdir(appDataDirectory, { recursive: true });
  await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
}

async function configureGoogleCloud() {
  if (!settings.credentialsPath) throw new Error('サービス アカウント JSON の絶対パスを入力してください。');
  process.env.GOOGLE_APPLICATION_CREDENTIALS = settings.credentialsPath;
  textToSpeechClient = new textToSpeech.TextToSpeechClient();
  translateClient = new Translate();
}

function normaliseLanguageCode(code) {
  return ({ ja: 'ja-JP', en: 'en-US', zh: 'cmn-CN', 'zh-CN': 'cmn-CN', 'zh-TW': 'cmn-TW', ru: 'ru-RU' })[code] ?? code;
}

function createPlayer() {
  const audioPlayer = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
  const advanceQueue = async () => {
    const completed = audioQueue.shift();
    if (completed) await rm(completed, { force: true });
    isPlaying = false;
    await playNextAudio();
  };
  audioPlayer.on(AudioPlayerStatus.Idle, advanceQueue);
  audioPlayer.on('error', (error) => { console.error('Audio player error:', error); advanceQueue().catch(console.error); });
  return audioPlayer;
}

async function playNextAudio() {
  if (isPlaying || !player || audioQueue.length === 0) return;
  isPlaying = true;
  const resource = createAudioResource(audioQueue[0], { inputType: StreamType.Arbitrary, inlineVolume: true });
  resource.volume.setVolume(0.3);
  player.play(resource);
}

async function createSpeech(text, languageCode, voiceName) {
  if (!connection || !text.trim()) return;
  if (!textToSpeechClient) await configureGoogleCloud();
  const locale = normaliseLanguageCode(languageCode);
  const [response] = await textToSpeechClient.synthesizeSpeech({
    input: { text }, voice: { languageCode: locale, name: voiceName ?? defaultVoices[locale] }, audioConfig: { audioEncoding: 'MP3' },
  });
  if (!response.audioContent) throw new Error('音声データを取得できませんでした。');
  await mkdir(audioDirectory, { recursive: true });
  const filePath = path.join(audioDirectory, `${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`);
  await writeFile(filePath, response.audioContent);
  audioQueue.push(filePath);
  await playNextAudio();
}

async function joinVoice(message) {
  const channel = message.member?.voice?.channel;
  if (!channel) throw new Error('先にボイスチャンネルへ参加してください。');
  if (!channel.joinable || !channel.speakable) throw new Error('このボイスチャンネルには参加または発話できません。');
  connection?.destroy();
  connection = joinVoiceChannel({ channelId: channel.id, guildId: message.guild.id, adapterCreator: message.guild.voiceAdapterCreator });
  await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
  player ??= createPlayer();
  connection.subscribe(player);
  await createSpeech('BUZZ has started', 'en-US');
}

async function runCommand(commandText, message) {
  const parts = commandText.trim().split(/\s+/);
  if (parts[0]?.toLowerCase() === prefix) parts.shift();
  const [command, ...args] = parts;
  switch (command?.toLowerCase()) {
    case 'join': if (!message) throw new Error('join は Discord 上で実行してください。'); await joinVoice(message); return 'ボイスチャンネルに参加しました。';
    case 'shutdown': case 'exit': connection?.destroy(); connection = undefined; return 'ボイスチャンネルから退出しました。';
    case 'speak': case 'tts': {
      const [languageCode, ...text] = args;
      if (!languageCode || text.length === 0) throw new Error('例: /buzz speak ja-JP こんにちは');
      await createSpeech(text.join(' '), languageCode); return '読み上げをキューに追加しました。';
    }
    case 'translate': case 'tran': {
      const [sourceLanguage, targetLanguage, ...text] = args;
      if (!sourceLanguage || !targetLanguage || text.length === 0) throw new Error('例: /buzz translate en-US ja-JP hello');
      if (!translateClient) await configureGoogleCloud();
      const sourceText = text.join(' ');
      const [translated] = await translateClient.translate(sourceText, targetLanguage);
      await createSpeech(sourceText, sourceLanguage); await createSpeech(translated, targetLanguage); return translated;
    }
    case 'choice': case 'dice': {
      const candidates = args.join(' ').split(',').map((item) => item.trim()).filter(Boolean);
      if (candidates.length < 2) throw new Error('例: /buzz choice 赤,青,緑');
      const selected = candidates[Math.floor(Math.random() * candidates.length)];
      await createSpeech(`${candidates.join('、')}で抽選します。選ばれたのは、${selected}です。`, 'ja-JP'); return `${selected} を選びました。`;
    }
    default: throw new Error('利用可能なコマンド: join, shutdown, speak, translate, choice');
  }
}

async function runYouTubeCommand(commandText, chatItem) {
  const parts = commandText.trim().split(/\s+/);
  if (parts[0]?.toLowerCase() === prefix) parts.shift();
  const [command, profile] = parts;
  if (command?.toLowerCase() !== 'voice') return runCommand(commandText);

  const normalizedProfile = normalizeVoiceChoice(profile);
  if (normalizedProfile !== 'default' && !chirpVoiceChoices[normalizedProfile]) {
    throw new Error('声の変更: /buzz voice <名前>。例: /buzz voice kore。画面の一覧から30種類を選べます。');
  }

  await setYouTubeVoicePreference(chatItem.author.channelId, normalizedProfile);
  const label = normalizedProfile === 'default' ? '標準' : chirpVoiceChoices[normalizedProfile].label;
  const confirmationVoice = getYouTubeVoiceName(chatItem.author.channelId, 'ja-JP');
  await createSpeech(`${chatItem.author.name} さんの声を${label}に変更しました。`, 'ja-JP', confirmationVoice);
  emit('chat', `${chatItem.author.name}: 声を${label}に変更しました。`);
}

function detectLanguage(text) {
  if (/^[\x20-\x7E]+$/.test(text)) return 'en-US';
  if (/[\u0400-\u04FF]/.test(text)) return 'ru-RU';
  if (/[\u3040-\u30FF]/.test(text)) return 'ja-JP';
  if (/[\u4E00-\u9FFF]/.test(text)) return 'cmn-CN';
  return 'ja-JP';
}

async function startYouTube(liveUrlOrId) {
  if (!liveUrlOrId) throw new Error('YouTube Live のURLまたはライブIDを入力してください。');
  const liveId = extractYouTubeVideoId(liveUrlOrId);
  if (!textToSpeechClient) await configureGoogleCloud();
  liveChat?.stop();
  liveChat = new LiveChat({ liveId });
  liveChat.on('chat', async (chatItem) => {
    const text = chatItem.message.map((item) => item.text ?? item.alt ?? '').join('').trim();
    if (!text) return;
    const display = `${chatItem.author.name} さん、${text}`;
    emit('chat', display);
    try {
      if (text.toLowerCase().startsWith(prefix)) await runYouTubeCommand(text, chatItem);
      else {
        const languageCode = detectLanguage(text);
        await createSpeech(display, languageCode, getYouTubeVoiceName(chatItem.author.channelId, languageCode));
      }
    } catch (error) { console.error(error); }
  });
  liveChat.on('error', console.error);
  liveChat.start();
  return `YouTube Live のコメント取得を開始しました（ID: ${liveId}）。`;
}

discordClient.once('clientReady', () => console.log(`Discord logged in as ${discordClient.user.tag}`));
discordClient.on('messageCreate', async (message) => {
  if (message.author.bot || !message.content.toLowerCase().startsWith(prefix)) return;
  try { await message.reply(await runCommand(message.content, message)); } catch (error) { await message.reply(`エラー: ${error.message}`); }
});

async function handleApi(request, response, body) {
  const send = (status, value) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value)); };
  const payload = body ? JSON.parse(body) : {};
  if (request.url === '/api/settings' && request.method === 'GET') return send(200, settings);
  if (request.url === '/api/settings' && request.method === 'PUT') { await saveSettings(payload); return send(200, settings); }
  if (request.url === '/api/discord/start' && request.method === 'POST') {
    await saveSettings(payload); await configureGoogleCloud();
    if (!settings.discordBotToken) throw new Error('Discord Bot Token を入力してください。');
    if (!discordClient.isReady()) await discordClient.login(settings.discordBotToken);
    return send(200, { message: 'Discord Bot に接続しました。Discord で /buzz join を実行してください。' });
  }
  if (request.url === '/api/youtube/start' && request.method === 'POST') return send(200, { message: await startYouTube(payload.liveUrlOrId) });
  if (request.url === '/api/command' && request.method === 'POST') return send(200, { message: await runCommand(payload.command) });
  return send(404, { error: 'Not found' });
}

function serveStatic(response, requestPath) {
  const fileName = requestPath === '/' ? 'index.html' : requestPath.slice(1);
  const filePath = path.resolve(publicDirectory, fileName);
  if (!filePath.startsWith(publicDirectory)) throw new Error('Not found');
  const contentType = filePath.endsWith('.css') ? 'text/css; charset=utf-8' : filePath.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8';
  return readFile(filePath).then((file) => { response.writeHead(200, { 'Content-Type': contentType }); response.end(file); });
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.url === '/events') { response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' }); events.add(response); request.on('close', () => events.delete(response)); return; }
    let body = ''; for await (const chunk of request) body += chunk;
    if (request.url.startsWith('/api/')) return await handleApi(request, response, body);
    return await serveStatic(response, new URL(request.url, `http://${host}`).pathname);
  } catch (error) { response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify({ error: error.message })); }
});

Promise.all([loadSettings(), loadVoicePreferences()]).then(() => server.listen(port, host, () => console.log(`BUZZ is running at http://${host}:${port}`)));
process.on('SIGINT', () => { liveChat?.stop(); connection?.destroy(); server.close(); });
