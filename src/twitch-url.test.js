const assert = require('node:assert/strict');
const { extractTwitchChannelName } = require('./twitch-url');

for (const value of [
  'shroud',
  'https://www.twitch.tv/shroud',
  'https://twitch.tv/shroud?ref=example',
  'm.twitch.tv/Shroud',
]) assert.equal(extractTwitchChannelName(value), 'shroud');

assert.throws(() => extractTwitchChannelName('https://example.com/shroud'), /Twitch/);
assert.throws(() => extractTwitchChannelName('https://twitch.tv/videos/123'), /チャンネル名/);
