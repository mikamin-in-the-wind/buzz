const CHANNEL_ID_PATTERN = /^UC[A-Za-z0-9_-]{22}$/;

function extractYouTubeChannel(input) {
  const value = input.trim();
  if (CHANNEL_ID_PATTERN.test(value)) return { channelId: value };
  if (value.startsWith('@')) return { handle: value };

  let url;
  try { url = new URL(value.startsWith('http') ? value : `https://${value}`); } catch { throw new Error('YouTube チャンネル URL、@ハンドル、またはチャンネル ID を入力してください。'); }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (!['youtube.com', 'm.youtube.com'].includes(host)) throw new Error('YouTube のチャンネル URL を入力してください。');
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] === 'channel' && CHANNEL_ID_PATTERN.test(parts[1])) return { channelId: parts[1] };
  if (parts[0]?.startsWith('@')) return { handle: parts[0] };
  throw new Error('この URL から YouTube チャンネルを取得できません。@ハンドルまたは /channel/ の URL を使用してください。');
}

module.exports = { extractYouTubeChannel };
