const assert = require('node:assert/strict');
const { extractYouTubeChannel } = require('./youtube-channel');

assert.deepEqual(extractYouTubeChannel('@GoogleDevelopers'), { handle: '@GoogleDevelopers' });
assert.deepEqual(extractYouTubeChannel('https://www.youtube.com/@GoogleDevelopers'), { handle: '@GoogleDevelopers' });
assert.deepEqual(extractYouTubeChannel('UC_x5XG1OV2P6uZZ5FSM9Ttw'), { channelId: 'UC_x5XG1OV2P6uZZ5FSM9Ttw' });
assert.throws(() => extractYouTubeChannel('https://example.com/@GoogleDevelopers'), /YouTube/);
