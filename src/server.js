const http = require('node:http');
const { readFile, mkdir, rm, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { homedir } = require('node:os');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, NoSubscriberBehavior, StreamType, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const { Client, GatewayIntentBits } = require('discord.js');
const textToSpeech = require('@google-cloud/text-to-speech');
const { Translate } = require('@google-cloud/translate').v2;
const { LiveChat } = require('youtube-chat');
const WebSocket = require('ws');
const { extractYouTubeVideoId } = require('./youtube-url');
const { extractYouTubeChannel } = require('./youtube-channel');
const { extractTwitchChannelName } = require('./twitch-url');

const host = '127.0.0.1';
const port = Number(process.env.PORT ?? 3210);
const prefix = '/buzz';
const appDataDirectory = path.join(process.env.APPDATA ?? homedir(), 'buzz');
const settingsPath = path.join(appDataDirectory, 'settings.json');
const voicePreferencesPath = path.join(appDataDirectory, 'youtube-voice-preferences.json');
const visitorProfilesPath = path.join(__dirname, '..', 'data', 'visitor-profiles.json');
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

const events = new Set();
const audioQueue = [];
let settings = { discordBotToken: '', credentialsPath: '', gcpProjectId: '', youtubeApiKey: '', youtubeChannel: '', twitchBotUsername: '', twitchOAuthToken: '', twitchClientId: '', twitchChannel: '' };
let discordClient = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
let textToSpeechClient;
let translateClient;
let connection;
let player;
let liveChat;
let twitchChat;
let isPlaying = false;
let youtubeVoicePreferences = {};
let visitorProfiles = {};
let visitorWrite = Promise.resolve();
let youtubeBroadcastId;
let twitchBroadcastId;
let connectionStatuses = {
  discord: { state: 'idle', detail: '未接続' },
  youtube: { state: 'idle', detail: '未接続' },
  twitch: { state: 'idle', detail: '未接続' },
};

function emit(type, data) {
  const message = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const response of events) response.write(message);
}

function setConnectionStatus(name, state, detail) {
  connectionStatuses[name] = { state, detail };
  emit('connections', connectionStatuses);
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

async function loadVisitorProfiles() {
  visitorProfiles = await readJson(visitorProfilesPath);
}

function saveVisitorProfiles() {
  visitorWrite = visitorWrite.then(async () => {
    await mkdir(appDataDirectory, { recursive: true });
    await writeFile(visitorProfilesPath, JSON.stringify(visitorProfiles, null, 2), 'utf8');
  });
  return visitorWrite;
}

async function recordVisitor({ platform, authorId, authorName, text, broadcastId }) {
  const now = new Date().toISOString();
  const key = `${platform}:${authorId}`;
  const previous = visitorProfiles[key];
  const visits = previous?.visits ?? {};
  if (!visits[broadcastId]) visits[broadcastId] = { firstSeenAt: now, lastSeenAt: now };
  else visits[broadcastId].lastSeenAt = now;
  visitorProfiles[key] = {
    platform,
    authorId,
    authorName,
    firstSeenAt: previous?.firstSeenAt ?? now,
    lastSeenAt: now,
    commentCount: (previous?.commentCount ?? 0) + 1,
    visitCount: Object.keys(visits).length,
    visits,
    memo: previous?.memo ?? '',
  };
  await saveVisitorProfiles();
  return { key, ...visitorProfiles[key], text, receivedAt: now };
}

function localDate(value) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date(value));
}

function listVisitorProfiles() {
  return Object.entries(visitorProfiles)
    .map(([key, profile]) => ({ key, ...profile }))
    .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt));
}

function listTodayVisitorProfiles() {
  const today = localDate(new Date());
  return listVisitorProfiles().filter((profile) => localDate(profile.lastSeenAt) === today);
}

async function setVisitorMemo(key, memo) {
  if (!visitorProfiles[key]) throw new Error('投稿者が見つかりません。');
  visitorProfiles[key].memo = String(memo ?? '').slice(0, 500);
  await saveVisitorProfiles();
  return { key, ...visitorProfiles[key] };
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

function destroyVoiceConnection() {
  if (!connection) return;
  if (connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
  connection = undefined;
}

function createDiscordClient() {
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
  client.once('clientReady', () => setConnectionStatus('discord', 'ready', `ログイン済み: ${client.user.tag}`));
  client.on('error', (error) => { console.error('Discord error:', error); setConnectionStatus('discord', 'error', '接続エラー'); });
  client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.content.toLowerCase().startsWith(prefix)) return;
    try { await message.reply(await runCommand(message.content, message)); } catch (error) { await message.reply(`エラー: ${error.message}`); }
  });
  return client;
}

async function restartDiscord() {
  if (!settings.discordBotToken) throw new Error('Discord Bot Token を設定してください。');
  destroyVoiceConnection();
  if (discordClient) discordClient.destroy();
  discordClient = createDiscordClient();
  setConnectionStatus('discord', 'connecting', '再接続中');
  await discordClient.login(settings.discordBotToken);
}

async function joinVoice(message) {
  const channel = message.member?.voice?.channel;
  if (!channel) throw new Error('先にボイスチャンネルへ参加してください。');
  if (!channel.joinable || !channel.speakable) throw new Error('このボイスチャンネルには参加または発話できません。');
  destroyVoiceConnection();
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
    case 'shutdown': case 'exit': destroyVoiceConnection(); return 'ボイスチャンネルから退出しました。';
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

function decodeTwitchTag(value = '') {
  return value.replace(/\\\\s/g, ' ').replace(/\\\\:/g, ';').replace(/\\\\\\\\/g, '\\').replace(/\\\\r/g, '\r').replace(/\\\\n/g, '\n');
}

function decodeTwitchTagValue(value = '') {
  const escapes = { s: ' ', ':': ';', r: '\r', n: '\n' };
  const slash = String.fromCharCode(92);
  let decoded = '';
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== slash || index + 1 === value.length) { decoded += value[index]; continue; }
    const character = value[index + 1];
    decoded += character === slash ? slash : (escapes[character] ?? character);
    index += 1;
  }
  return decoded;
}

function parseTwitchChatMessage(line) {
  const match = line.match(/^(?:@([^ ]+) )?:([^! ]+)!.* PRIVMSG #[^ ]+ :(.*)$/);
  if (!match) return undefined;
  const tags = Object.fromEntries((match[1] ?? '').split(';').filter(Boolean).map((entry) => {
    const separator = entry.indexOf('=');
    return [entry.slice(0, separator), decodeTwitchTagValue(entry.slice(separator + 1))];
  }));
  return { authorId: tags['user-id'] || match[2], authorName: tags['display-name'] || match[2], text: match[3].trim() };
}

function stopTwitch() {
  if (!twitchChat) return;
  twitchChat.removeAllListeners();
  twitchChat.close();
  twitchChat = undefined;
  setConnectionStatus('twitch', 'idle', '停止中');
}

async function findTwitchBroadcastId(channelName) {
  if (!settings.twitchClientId) return `session-${Date.now()}`;
  const response = await fetch(`https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(channelName)}`, {
    headers: { 'Client-Id': settings.twitchClientId, Authorization: `Bearer ${settings.twitchOAuthToken.replace(/^oauth:/i, '')}` },
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message ?? 'Twitch 配信情報を取得できません。');
  return payload.data?.[0]?.id ?? `offline-${localDate(new Date())}`;
}

async function startTwitch(channelUrlOrName) {
  if (!channelUrlOrName) throw new Error('Twitch のチャンネル URL またはチャンネル名を入力してください。');
  if (!settings.twitchBotUsername || !settings.twitchOAuthToken) {
    throw new Error('Twitch Bot ユーザー名と OAuth Token を設定してください。');
  }
  if (!textToSpeechClient) await configureGoogleCloud();
  const channelName = extractTwitchChannelName(channelUrlOrName);
  stopTwitch();
  try { twitchBroadcastId = await findTwitchBroadcastId(channelName); } catch (error) { console.error(error); twitchBroadcastId = `session-${Date.now()}`; }

  const token = settings.twitchOAuthToken.replace(/^oauth:/i, '');
  const socket = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
  twitchChat = socket;
  setConnectionStatus('twitch', 'connecting', `#${channelName} に接続中`);
  let joined = false;
  const joinChannel = () => {
    if (joined) return;
    joined = true;
    socket.send(`JOIN #${channelName}`);
    setConnectionStatus('twitch', 'ready', `接続中: #${channelName}`);
    emit('status', { message: `Twitch チャットに接続しました（#${channelName}）。`, isError: false });
  };
  socket.on('open', () => {
    socket.send(`PASS oauth:${token}`);
    socket.send(`NICK ${settings.twitchBotUsername.toLowerCase()}`);
    socket.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
  });
  socket.on('message', (data) => {
    for (const line of data.toString().split(/\r?\n/)) {
      if (line.startsWith('PING ')) { socket.send(`PONG ${line.slice(5)}`); continue; }
      if (line.includes(' 001 ')) { joinChannel(); continue; }
      if (line.includes('Login authentication failed') || line.includes('Improperly formatted auth')) {
        setConnectionStatus('twitch', 'error', '認証に失敗しました');
        emit('status', { message: 'Twitch の認証に失敗しました。Bot ユーザー名と chat:read 権限付き OAuth Token を確認してください。', isError: true });
        socket.close();
        continue;
      }
      const chatItem = parseTwitchChatMessage(line);
      if (!chatItem?.text) continue;
      const display = `${chatItem.authorName} さん、${chatItem.text}`;
      recordVisitor({ platform: 'Twitch', authorId: chatItem.authorId, authorName: chatItem.authorName, text: chatItem.text, broadcastId: twitchBroadcastId })
        .then((visitor) => emit('chat', { type: 'comment', display, visitor }))
        .catch(console.error);
      createSpeech(display, detectLanguage(chatItem.text)).catch(console.error);
    }
  });
  socket.on('error', (error) => { console.error('Twitch chat error:', error); emit('status', { message: 'Twitch への接続でエラーが発生しました。', isError: true }); });
  socket.on('close', () => {
    if (twitchChat === socket) {
      twitchChat = undefined;
      if (joined) emit('status', { message: 'Twitch チャットから切断されました。', isError: true });
    }
  });
  return `Twitch のコメント取得を開始しました（チャンネル: ${channelName}）。`;
}

async function fetchYouTubeJson(pathname, params) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${pathname}`);
  Object.entries({ ...params, key: settings.youtubeApiKey }).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message ?? 'YouTube Data API の呼び出しに失敗しました。');
  return payload;
}

async function findLiveYouTubeVideo(channelInput) {
  if (!settings.youtubeApiKey) throw new Error('YouTube Data API の API キーを設定してください。');
  const channel = extractYouTubeChannel(channelInput);
  let channelId = channel.channelId;
  if (!channelId) {
    const result = await fetchYouTubeJson('channels', { part: 'id', forHandle: channel.handle });
    channelId = result.items?.[0]?.id;
    if (!channelId) throw new Error('YouTube チャンネルが見つかりません。');
  }
  const result = await fetchYouTubeJson('search', { part: 'id', channelId, eventType: 'live', type: 'video', maxResults: '1' });
  const videoId = result.items?.[0]?.id?.videoId;
  if (videoId) return videoId;

  // search.list のライブ判定が配信開始直後に遅れる場合に備え、アップロード一覧の直近動画も確認する。
  const channelDetails = await fetchYouTubeJson('channels', { part: 'contentDetails', id: channelId });
  const uploadsPlaylistId = channelDetails.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsPlaylistId) throw new Error('YouTube チャンネルの動画一覧を取得できません。');
  const recentVideos = await fetchYouTubeJson('playlistItems', { part: 'contentDetails', playlistId: uploadsPlaylistId, maxResults: '10' });
  const videoIds = recentVideos.items.map((item) => item.contentDetails?.videoId).filter(Boolean);
  if (videoIds.length > 0) {
    const details = await fetchYouTubeJson('videos', { part: 'liveStreamingDetails', id: videoIds.join(',') });
    const liveVideo = details.items.find((item) => item.liveStreamingDetails?.actualStartTime && !item.liveStreamingDetails.actualEndTime && item.liveStreamingDetails.activeLiveChatId);
    if (liveVideo) return liveVideo.id;
  }
  throw new Error('この YouTube チャンネルは現在ライブ配信していません。');
}

async function startRegisteredYouTube() {
  if (!settings.youtubeChannel) {
    setConnectionStatus('youtube', 'idle', 'チャンネル未登録');
    return 'YouTube チャンネルは未登録です。';
  }
  setConnectionStatus('youtube', 'connecting', 'ライブ配信を検索中');
  try {
    const videoId = await findLiveYouTubeVideo(settings.youtubeChannel);
    return await startYouTube(videoId);
  } catch (error) {
    setConnectionStatus('youtube', 'idle', error.message);
    return error.message;
  }
}

async function startYouTube(liveUrlOrId) {
  if (!liveUrlOrId) throw new Error('YouTube Live のURLまたはライブIDを入力してください。');
  const liveId = extractYouTubeVideoId(liveUrlOrId);
  youtubeBroadcastId = liveId;
  if (!textToSpeechClient) await configureGoogleCloud();
  liveChat?.stop();
  liveChat = new LiveChat({ liveId });
  setConnectionStatus('youtube', 'ready', `接続中: ${liveId}`);
  liveChat.on('chat', async (chatItem) => {
    const text = chatItem.message.map((item) => item.text ?? item.alt ?? '').join('').trim();
    if (!text) return;
    const display = `${chatItem.author.name} さん、${text}`;
    const visitor = await recordVisitor({ platform: 'YouTube', authorId: chatItem.author.channelId, authorName: chatItem.author.name, text, broadcastId: youtubeBroadcastId });
    emit('chat', { type: 'comment', display, visitor });
    try {
      if (text.toLowerCase().startsWith(prefix)) await runYouTubeCommand(text, chatItem);
      else {
        const languageCode = detectLanguage(text);
        await createSpeech(display, languageCode, getYouTubeVoiceName(chatItem.author.channelId, languageCode));
      }
    } catch (error) { console.error(error); }
  });
  liveChat.on('error', (error) => { console.error(error); setConnectionStatus('youtube', 'error', '接続エラー'); });
  liveChat.start();
  return `YouTube Live のコメント取得を開始しました（ID: ${liveId}）。`;
}

discordClient.once('clientReady', () => { console.log(`Discord logged in as ${discordClient.user.tag}`); setConnectionStatus('discord', 'ready', `ログイン済み: ${discordClient.user.tag}`); });
discordClient.on('messageCreate', async (message) => {
  if (message.author.bot || !message.content.toLowerCase().startsWith(prefix)) return;
  try { await message.reply(await runCommand(message.content, message)); } catch (error) { await message.reply(`エラー: ${error.message}`); }
});

async function startAll() {
  await configureGoogleCloud();
  liveChat?.stop();
  liveChat = undefined;
  stopTwitch();
  await restartDiscord();

  const results = await Promise.allSettled([
    startRegisteredYouTube(),
    settings.twitchChannel ? startTwitch(settings.twitchChannel) : Promise.resolve('Twitch チャンネルは未登録です。'),
  ]);
  if (!settings.twitchChannel) setConnectionStatus('twitch', 'idle', 'チャンネル未登録');
  const messages = results.map((result) => result.status === 'fulfilled' ? result.value : result.reason.message);
  return messages.join(' / ');
}

async function handleApi(request, response, body) {
  const send = (status, value) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value)); };
  const payload = body ? JSON.parse(body) : {};
  if (request.url === '/api/settings' && request.method === 'GET') return send(200, settings);
  if (request.url === '/api/settings' && request.method === 'PUT') { await saveSettings(payload); return send(200, settings); }
  if (request.url === '/api/connections' && request.method === 'GET') return send(200, connectionStatuses);
  if (request.url === '/api/visitors' && request.method === 'GET') return send(200, listVisitorProfiles());
  if (request.url === '/api/visitors/today' && request.method === 'GET') return send(200, listTodayVisitorProfiles());
  if (request.url === '/api/visitors/memo' && request.method === 'PUT') return send(200, await setVisitorMemo(payload.key, payload.memo));
  if (request.url === '/api/start' && request.method === 'POST') return send(200, { message: await startAll() });
  if (request.url === '/api/discord/start' && request.method === 'POST') {
    await saveSettings(payload); await configureGoogleCloud();
    if (!settings.discordBotToken) throw new Error('Discord Bot Token を入力してください。');
    if (!discordClient.isReady()) await discordClient.login(settings.discordBotToken);
    return send(200, { message: 'Discord Bot に接続しました。Discord で /buzz join を実行してください。' });
  }
  if (request.url === '/api/youtube/start' && request.method === 'POST') return send(200, { message: await startYouTube(payload.liveUrlOrId) });
  if (request.url === '/api/twitch/start' && request.method === 'POST') return send(200, { message: await startTwitch(payload.channelUrlOrName) });
  if (request.url === '/api/command' && request.method === 'POST') return send(200, { message: await runCommand(payload.command) });
  return send(404, { error: 'Not found' });
}

function serveStatic(response, requestPath) {
  const fileName = requestPath === '/' ? 'index.html' : requestPath === '/overlay' ? 'overlay.html' : requestPath.slice(1);
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

Promise.all([loadSettings(), loadVoicePreferences(), loadVisitorProfiles()]).then(() => server.listen(port, host, () => console.log(`BUZZ is running at http://${host}:${port}`)));
process.on('SIGINT', () => { liveChat?.stop(); stopTwitch(); destroyVoiceConnection(); server.close(); });
