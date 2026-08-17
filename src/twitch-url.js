const CHANNEL_NAME_PATTERN = /^[a-zA-Z0-9_]{4,25}$/;
const RESERVED_PATHS = new Set(['directory', 'downloads', 'jobs', 'p', 'products', 'search', 'settings', 'store', 'turbo', 'videos']);

function extractTwitchChannelName(input) {
  const value = input.trim();
  if (CHANNEL_NAME_PATTERN.test(value)) return value.toLowerCase();

  let url;
  try {
    url = new URL(value.startsWith('http') ? value : `https://${value}`);
  } catch {
    throw new Error('Twitch のチャンネル URL またはチャンネル名を入力してください。');
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'twitch.tv' && host !== 'm.twitch.tv') {
    throw new Error('Twitch の URL を入力してください。');
  }

  const channelName = url.pathname.split('/').filter(Boolean)[0];
  if (!channelName || RESERVED_PATHS.has(channelName.toLowerCase()) || !CHANNEL_NAME_PATTERN.test(channelName)) {
    throw new Error('この URL から Twitch チャンネル名を取得できません。');
  }
  return channelName.toLowerCase();
}

module.exports = { extractTwitchChannelName };
