const assert = require('node:assert/strict');
const { extractYouTubeVideoId } = require('./youtube-url');

const videoId = 'dQw4w9WgXcQ';
for (const value of [
  videoId,
  `https://www.youtube.com/watch?v=${videoId}`,
  `https://www.youtube.com/watch?feature=share&v=${videoId}&t=12`,
  `https://youtu.be/${videoId}?si=example`,
  `https://www.youtube.com/live/${videoId}?feature=share`,
  `https://www.youtube.com/embed/${videoId}`,
  `https://m.youtube.com/shorts/${videoId}`,
]) assert.equal(extractYouTubeVideoId(value), videoId);

assert.throws(() => extractYouTubeVideoId('https://www.youtube.com/@OpenAI'), /動画ID/);
assert.throws(() => extractYouTubeVideoId('https://example.com/watch?v=dQw4w9WgXcQ'), /YouTube/);
