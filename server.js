'use strict';
const express = require('express');
const cors = require('cors');
const https = require('https');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 7000;

app.use(cors());

const manifest = {
  id: 'org.stremio.daddylivehd',
  version: '1.0.0',
  name: 'DaddyLiveHD',
  description: 'Live Sports Streaming via Smart Proxy',
  resources: ['catalog', 'meta', 'stream'],
  types: ['tv'],
  catalogs: [{ type: 'tv', id: 'dlhd_channels', name: 'Live Channels' }],
  idPrefixes: ['dlhd_']
};

let cachedChannels = [];

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cleanChannel(channel) {
  const id = String(channel.id || '').trim();
  const name = String(channel.name || id.replace(/^dlhd_/, '')).trim();
  if (!id) return null;
  return {
    id,
    type: 'tv',
    name,
    poster: channel.poster || '',
    logo: channel.logo || channel.poster || '',
    genres: ['Live Sports']
  };
}

function loadChannels() {
  const paths = [
    path.join(__dirname, 'channels.json'),
    path.join(__dirname, 'data', 'channels.json'),
    path.join(process.cwd(), 'channels.json'),
    path.join(process.cwd(), 'data', 'channels.json')
  ];

  for (const filePath of paths) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (!Array.isArray(parsed)) continue;
      const cleaned = parsed.map(cleanChannel).filter(Boolean);
      if (cleaned.length > 0) {
        cachedChannels = cleaned;
        console.log(`Loaded ${cachedChannels.length} channels from ${filePath}`);
        return cachedChannels;
      }
    } catch (error) {
      console.error(`Error loading ${filePath}:`, error.message);
    }
  }

  console.warn('No channels.json found, using empty catalog');
  return [];
}

function getChannels() {
  return cachedChannels.length > 0 ? cachedChannels : loadChannels();
}

function getChannel(id) {
  return getChannels().find((ch) => ch.id === id);
}

function absoluteBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  return `${proto}://${req.get('host')}`;
}

function encodeUrl(targetUrl) {
  return Buffer.from(targetUrl).toString('base64url');
}

function decodeUrl(encoded) {
  return Buffer.from(encoded, 'base64url').toString('utf8');
}

function proxiedUrl(req, targetUrl) {
  return `${absoluteBaseUrl(req)}/segment/${encodeUrl(targetUrl)}`;
}

function channelSummary(channel) {
  return {
    id: channel.id,
    type: 'tv',
    name: channel.name,
    poster: channel.poster,
    logo: channel.logo || channel.poster,
    description: `${channel.name} live sports channel`,
    genres: channel.genres || ['Live Sports']
  };
}

function headers() {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://dlhd.pk/',
    'Accept': '*/*'
  };
}

function httpsGetText(targetUrl) {
  return new Promise((resolve, reject) => {
    https.get(targetUrl, { headers: headers() }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        return resolve({ redirectedTo: response.headers.location, body: '' });
      }
      let body = '';
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({
        statusCode: response.statusCode,
        headers: response.headers,
        body
      }));
    }).on('error', reject);
  });
}

async function discoverStreamUrl(channel) {
  const channelId = channel.id.replace(/^dlhd_/, '');
  const daddyPhpUrl = `https://donis.jimpenopisonline.online/premiumtv/daddy.php?id=${channelId}`;
  
  try {
    const response = await httpsGetText(daddyPhpUrl);
    
    // Extract base64 encoded stream URL from the response
    const base64Match = response.body.match(/window\.atob\('([^']+)'\)/);
    if (base64Match && base64Match[1]) {
      const decodedUrl = Buffer.from(base64Match[1], 'base64').toString('utf8');
      return decodedUrl;
    }
    
    // Fallback: try to find it in a different format
    const srcMatch = response.body.match(/source:\s*window\.atob\('([^']+)'\)/);
    if (srcMatch && srcMatch[1]) {
      const decodedUrl = Buffer.from(srcMatch[1], 'base64').toString('utf8');
      return decodedUrl;
    }
  } catch (error) {
    console.error(`Error discovering stream for ${channel.id}:`, error.message);
  }
  
  // Fallback: construct a direct URL (may not work if the format changes)
  return `https://dlhd.pk/stream/stream-${channelId}.php`;
}

function renderWatchPage(req) {
  const baseUrl = absoluteBaseUrl(req);
  const channels = getChannels().map((channel) => ({
    id: channel.id,
    name: channel.name,
    poster: channel.poster || channel.logo || '',
    genres: channel.genres || ['Live Sports'],
    playUrl: `${baseUrl}/play/${channel.id}/index.m3u8`
  }));
  const channelData = JSON.stringify(channels).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>DaddyLiveHD Smart Proxy</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0a0e27; color: #fff; }
    .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
    header { text-align: center; margin-bottom: 30px; }
    h1 { font-size: 28px; margin-bottom: 10px; }
    .status { font-size: 14px; color: #888; margin-bottom: 20px; }
    .status a { color: #0066ff; text-decoration: none; }
    .status a:hover { text-decoration: underline; }
    .search-box { margin-bottom: 20px; }
    input[type="text"] { width: 100%; padding: 12px; font-size: 16px; border: 1px solid #333; border-radius: 4px; background: #1a1f3a; color: #fff; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 15px; margin-bottom: 30px; }
    .channel { background: #1a1f3a; border: 1px solid #333; border-radius: 4px; cursor: pointer; overflow: hidden; transition: all 0.2s; }
    .channel:hover { border-color: #0066ff; transform: translateY(-2px); }
    .channel.active { border-color: #0066ff; background: #0f1426; }
    .channel img { width: 100%; height: 100px; object-fit: cover; }
    .channel strong { display: block; padding: 10px; font-size: 14px; text-align: center; }
    .channel span { display: block; padding: 0 10px 10px; font-size: 12px; color: #888; text-align: center; }
    .player-section { background: #1a1f3a; border: 1px solid #333; border-radius: 4px; padding: 20px; }
    video { width: 100%; max-height: 600px; background: #000; border-radius: 4px; }
    .controls { margin-top: 15px; display: flex; gap: 10px; }
    button { padding: 10px 20px; background: #0066ff; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; }
    button:hover { background: #0052cc; }
    .info { margin-top: 15px; font-size: 14px; color: #888; }
    .empty { text-align: center; padding: 40px; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>DaddyLiveHD Smart Proxy</h1>
      <div class="status"><span id="count"></span> channels · Version 1.0.0 · <a class="xboxLink" href="/xbox">Xbox Mode</a></div>
    </header>
    <div class="search-box">
      <input type="text" id="search" placeholder="Search channels...">
    </div>
    <div class="grid" id="grid"></div>
    <div class="empty" id="empty" style="display: none;">No channels found</div>
    <div class="player-section" id="playerSection" style="display: none;">
      <h2 id="nowTitle" style="margin-bottom: 10px;"></h2>
      <video id="video" controls autoplay mute></video>
      <div class="controls">
        <button id="playBtn" type="button">Play</button>
        <a id="openLink" href="#" target="_blank" style="display: none;">
          <button type="button">Open Stream</button>
        </a>
      </div>
      <div class="info" id="nowText"></div>
    </div>
  </div>
  <script>
    const channels = ${channelData};
    const grid = document.getElementById('grid');
    const search = document.getElementById('search');
    const count = document.getElementById('count');
    const empty = document.getElementById('empty');
    const video = document.getElementById('video');
    const playerSection = document.getElementById('playerSection');
    const playBtn = document.getElementById('playBtn');
    const openLink = document.getElementById('openLink');
    const nowTitle = document.getElementById('nowTitle');
    const nowText = document.getElementById('nowText');
    let activeId = null;

    count.textContent = channels.length;

    function play(channel) {
      activeId = channel.id;
      video.src = channel.playUrl;
      const maybePromise = video.play();
      if (maybePromise && typeof maybePromise.catch === 'function') {
        maybePromise.catch(() => {});
      }
      nowTitle.textContent = channel.name;
      nowText.textContent = 'If playback does not begin, tap Play in the video controls or use Open Stream.';
      openLink.href = channel.playUrl;
      openLink.style.display = 'inline-block';
      playerSection.style.display = 'block';
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function render() {
      const q = search.value.trim().toLowerCase();
      const visible = channels.filter((channel) => channel.name.toLowerCase().includes(q));
      grid.innerHTML = '';
      empty.style.display = visible.length ? 'none' : 'block';
      for (const channel of visible) {
        const button = document.createElement('button');
        button.className = 'channel' + (channel.id === activeId ? ' active' : '');
        button.type = 'button';
        button.onclick = () => play(channel);
        const img = document.createElement('img');
        img.loading = 'lazy';
        img.alt = '';
        img.src = channel.poster || '';
        img.onerror = () => { img.style.display = 'none'; };
        const name = document.createElement('strong');
        name.textContent = channel.name;
        const genre = document.createElement('span');
        genre.textContent = (channel.genres && channel.genres[0]) || 'Live Sports';
        button.appendChild(img);
        button.appendChild(name);
        button.appendChild(genre);
        grid.appendChild(button);
      }
    }

    search.addEventListener('input', render);
    render();
  </script>
</body>
</html>`;
}

function renderXboxPage(req) {
  const baseUrl = absoluteBaseUrl(req);
  const channels = getChannels().map((channel) => ({
    id: channel.id,
    name: channel.name,
    poster: channel.poster || channel.logo || '',
    playUrl: `${baseUrl}/play/${channel.id}/index.m3u8`
  }));
  const channelData = JSON.stringify(channels).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>DaddyLiveHD Xbox Mode</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0a0e27; color: #fff; }
    .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
    h1 { font-size: 32px; margin-bottom: 20px; text-align: center; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
    .channel { background: #1a1f3a; border: 2px solid #333; border-radius: 8px; cursor: pointer; overflow: hidden; transition: all 0.2s; padding: 15px; text-align: center; }
    .channel:focus { outline: none; border-color: #0066ff; }
    .channel:hover { border-color: #0066ff; transform: scale(1.05); }
    .channel img { width: 100%; height: 120px; object-fit: cover; margin-bottom: 10px; border-radius: 4px; }
    .channel strong { display: block; font-size: 18px; margin-bottom: 5px; }
    .player-section { background: #1a1f3a; border: 2px solid #333; border-radius: 8px; padding: 20px; }
    video { width: 100%; max-height: 600px; background: #000; border-radius: 4px; margin-bottom: 20px; }
    .controls { display: flex; gap: 15px; flex-wrap: wrap; }
    button { padding: 15px 30px; background: #0066ff; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 18px; }
    button:hover { background: #0052cc; }
    button:focus { outline: 2px solid #0066ff; }
    .info { margin-top: 15px; font-size: 16px; color: #888; }
  </style>
</head>
<body>
  <div class="container">
    <h1>DaddyLiveHD Xbox Mode</h1>
    <div class="grid" id="grid"></div>
    <div class="player-section" id="playerSection" style="display: none;">
      <h2 id="nowTitle" style="margin-bottom: 10px;"></h2>
      <video id="video" controls autoplay mute></video>
      <div class="controls">
        <button id="playBtn" type="button">Play</button>
        <button id="copyUrl" class="action" type="button">Copy Stream URL</button>
        <a id="openLink" href="#" target="_blank">
          <button type="button">Open Stream</button>
        </a>
      </div>
      <div class="info" id="nowText"></div>
    </div>
  </div>
  <script>
    const channels = ${channelData};
    const grid = document.getElementById('grid');
    const video = document.getElementById('video');
    const playerSection = document.getElementById('playerSection');
    const playBtn = document.getElementById('playBtn');
    const copyUrl = document.getElementById('copyUrl');
    const openLink = document.getElementById('openLink');
    const nowTitle = document.getElementById('nowTitle');
    const nowText = document.getElementById('nowText');
    let activeId = null;
    let currentUrl = '';

    for (const channel of channels) {
      const button = document.createElement('button');
      button.className = 'channel';
      button.type = 'button';
      button.onclick = () => play(channel);
      const img = document.createElement('img');
      img.alt = '';
      img.src = channel.poster || '';
      img.onerror = () => { img.style.display = 'none'; };
      const name = document.createElement('strong');
      name.textContent = channel.name;
      button.appendChild(img);
      button.appendChild(name);
      grid.appendChild(button);
    }

    function play(channel) {
      activeId = channel.id;
      currentUrl = channel.playUrl;
      video.src = channel.playUrl;
      const maybePromise = video.play();
      if (maybePromise && typeof maybePromise.catch === 'function') {
        maybePromise.catch(() => {});
      }
      nowTitle.textContent = channel.name;
      nowText.textContent = 'Press Play to start streaming.';
      openLink.href = channel.playUrl;
      playerSection.style.display = 'block';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    copyUrl.addEventListener('click', () => {
      if (currentUrl) {
        navigator.clipboard.writeText(currentUrl).then(() => {
          copyUrl.textContent = 'Copied!';
          setTimeout(() => { copyUrl.textContent = 'Copy Stream URL'; }, 1200);
        });
      }
    });
  </script>
</body>
</html>`;
}

app.get('/', (req, res) => {
  res.json({
    name: manifest.name,
    version: manifest.version,
    channelCount: getChannels().length,
    webPlayer: absoluteBaseUrl(req) + '/watch',
    xboxPlayer: absoluteBaseUrl(req) + '/xbox',
    manifest: absoluteBaseUrl(req) + '/manifest.json'
  });
});

app.get('/watch', (req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.send(renderWatchPage(req));
});

app.get('/xbox', (req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.send(renderXboxPage(req));
});

app.get('/manifest.json', (req, res) => res.json(manifest));

app.get('/catalog/tv/dlhd_channels.json', (req, res) => {
  const metas = getChannels().map(channelSummary);
  res.json({ metas });
});

app.get('/meta/tv/:id.json', (req, res) => {
  const channel = getChannel(req.params.id);
  if (!channel) return res.json({ meta: null });
  res.json({
    meta: {
      ...channelSummary(channel),
      background: channel.poster,
      runtime: 'Live',
      videos: [{ id: channel.id, title: 'Live Sports' }]
    }
  });
});

app.get('/stream/tv/:id.json', (req, res) => {
  const channel = getChannel(req.params.id);
  if (!channel) return res.json({ streams: [] });
  res.json({
    streams: [{
      name: 'Smart Relay',
      title: channel.name,
      url: absoluteBaseUrl(req) + '/play/' + channel.id + '/index.m3u8',
      behaviorHints: { notWebReady: false }
    }]
  });
});

app.get('/play/:id/index.m3u8', async (req, res) => {
  const channel = getChannel(req.params.id);
  if (!channel) return res.status(404).send('Channel Not Found');
  try {
    const realStreamUrl = await discoverStreamUrl(channel);
    const playlist = await httpsGetText(realStreamUrl);
    if (!playlist.body || !playlist.body.includes('#EXTM3U')) {
      return res.status(502).type('text/plain').send('Could not load playlist');
    }
    const rewritten = playlist.body.split(/\r?\n/).map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;
      const target = new URL(trimmed, realStreamUrl).href;
      return proxiedUrl(req, target);
    }).join('\n');
    res.set('Content-Type', 'application/vnd.apple.mpegurl');
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.send(rewritten);
  } catch (error) {
    res.status(500).type('text/plain').send('Discovery Failed: ' + error.message);
  }
});

app.get('/segment/:encoded', (req, res) => {
  let targetUrl;
  try {
    targetUrl = decodeUrl(req.params.encoded);
  } catch (error) {
    return res.status(400).send('Bad segment URL');
  }
  https.get(targetUrl, { headers: headers() }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 200, {
      ...proxyRes.headers,
      'Access-Control-Allow-Origin': '*'
    });
    proxyRes.pipe(res);
  }).on('error', (error) => res.status(500).send(error.message));
});

loadChannels();
app.listen(PORT, '0.0.0.0', () => console.log('DaddyLiveHD Smart Proxy v1.0.0 live on ' + PORT));
module.exports = app;
