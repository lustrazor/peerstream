const NodeMediaServer = require('node-media-server');
const path = require('path');
const { execSync } = require('child_process');

// Get ffmpeg path
let ffmpegPath;
try {
  ffmpegPath = execSync('which ffmpeg').toString().trim();
} catch (e) {
  ffmpegPath = process.platform === 'darwin' ? '/opt/homebrew/bin/ffmpeg' : '/usr/bin/ffmpeg';
}

console.log('Using FFmpeg path:', ffmpegPath);

const config = {
  rtmp: {
    port: 1935,
    chunk_size: 60000,
    gop_cache: true,
    ping: 30,
    ping_timeout: 60
  },
  http: {
    port: 8000,
    allow_origin: '*',
    mediaroot: path.join(__dirname, '../media'),
  },
  trans: {
    ffmpeg: ffmpegPath,
    tasks: [
      {
        app: 'live',
        hls: true,
        hlsFlags: '[hls_time=2:hls_list_size=3:hls_flags=delete_segments+append_list]',
        hlsKeep: true,
        hlsOptions: '-c:v copy -c:a aac -ac 2 -ar 44100 -b:a 128k',
        mp4: false,
        mp4Flags: '[movflags=faststart]',
      }
    ]
  },
  auth: {
    api: false,
    play: false,
    publish: false
  },
  logType: 3
};

// Ensure media directory exists and is writable
const mediaPath = path.join(__dirname, '../media');
const fs = require('fs');

if (!fs.existsSync(mediaPath)) {
  fs.mkdirSync(mediaPath, { recursive: true });
}

// Test write permissions
try {
  const testFile = path.join(mediaPath, 'test.txt');
  fs.writeFileSync(testFile, 'test');
  fs.unlinkSync(testFile);
  console.log('Media directory is writable:', mediaPath);
} catch (e) {
  console.error('Error: Media directory is not writable:', mediaPath);
  console.error(e);
}

const nms = new NodeMediaServer(config);

// Add more detailed logging
nms.on('preConnect', (id, args) => {
  console.log('[NodeEvent on preConnect]', `id=${id}`, `args=${JSON.stringify(args)}`);
});

nms.on('postConnect', (id, args) => {
  console.log('[NodeEvent on postConnect]', `id=${id}`, `args=${JSON.stringify(args)}`);
});

nms.on('doneConnect', (id, args) => {
  console.log('[NodeEvent on doneConnect]', `id=${id}`, `args=${JSON.stringify(args)}`);
});

nms.on('prePublish', (id, StreamPath, args) => {
  console.log('[NodeEvent on prePublish]', `id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`);
});

nms.on('postPublish', (id, StreamPath, args) => {
  console.log('[NodeEvent on postPublish]', `id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`);
  console.log('Stream should be available at:', `http://127.0.0.1:8000${StreamPath}/index.m3u8`);
});

nms.on('donePublish', (id, StreamPath, args) => {
  console.log('[NodeEvent on donePublish]', `id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`);
});

nms.on('prePlay', (id, StreamPath, args) => {
  console.log('[NodeEvent on prePlay]', `id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`);
});

nms.on('postPlay', (id, StreamPath, args) => {
  console.log('[NodeEvent on postPlay]', `id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`);
});

module.exports = nms; 