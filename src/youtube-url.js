const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

function extractYouTubeVideoId(input) {
  const value = input.trim();
  if (VIDEO_ID_PATTERN.test(value)) return value;

  let url;
  try {
    url = new URL(value.startsWith('http') ? value : `https://${value}`);
  } catch {
    throw new Error('YouTube のURLまたは11文字のライブIDを入力してください。');
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (!['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(host)) {
    throw new Error('YouTube のURLを入力してください。');
  }

  const candidate = host === 'youtu.be'
    ? url.pathname.split('/').filter(Boolean)[0]
    : url.searchParams.get('v') ?? url.pathname.match(/^\/(?:live|embed|shorts)\/([^/?#]+)/)?.[1];

  if (!candidate || !VIDEO_ID_PATTERN.test(candidate)) {
    throw new Error('このURLから動画IDを取得できません。watch、youtu.be、live、embed形式のURLを入力してください。');
  }
  return candidate;
}

module.exports = { extractYouTubeVideoId };
