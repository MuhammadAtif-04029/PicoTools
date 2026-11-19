/* PicoTools server — serves the website and powers the downloader tools.
   Zero npm dependencies. Needs `yt-dlp` and `ffmpeg` on the machine (see README).
     node server.js            -> http://localhost:3000
   Env: PORT, YTDLP (path to yt-dlp), FFMPEG (path to ffmpeg), MAX_MB, KEEP_MIN, RATE_PER_MIN      */
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const BUILD = 'glass-view-3';
const PORT = +process.env.PORT || 3000;
const ROOT = __dirname;
const YTDLP = process.env.YTDLP || 'yt-dlp';
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const MAX_MB = +process.env.MAX_MB || 300;
const RATE = +process.env.RATE_PER_MIN || 10; // downloads per minute per IP
const KEEP_MS = (+process.env.KEEP_MIN || 30) * 60 * 1000;
const TMP = path.join(os.tmpdir(), 'picotools-dl');
fs.mkdirSync(TMP, { recursive: true });

const HOSTS = {
  youtube: ['youtube.com', 'youtu.be', 'music.youtube.com'],
  instagram: ['instagram.com'],
  tiktok: ['tiktok.com']
};
/* tool slug -> platform + what to produce */
const TOOLS = {
  'youtube-to-mp3': { p: 'youtube', m: 'audio' },
  'youtube-to-mp4': { p: 'youtube', m: 'video' },
  'shorts-downloader': { p: 'youtube', m: 'video' },
  'thumbnail-downloader': { p: 'youtube', m: 'thumbnail' },
  'instagram-video': { p: 'instagram', m: 'video' },
  'reels-downloader': { p: 'instagram', m: 'video' },
  'tiktok-video': { p: 'tiktok', m: 'video' },
  'tiktok-to-mp3': { p: 'tiktok', m: 'audio' }
};
const MODE_ARGS = {
  audio: ['-x', '--audio-format', 'mp3', '--audio-quality', '0'],
  video: ['-f', 'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/b[ext=mp4]/b', '--merge-output-format', 'mp4'],
  thumbnail: ['--skip-download', '--write-thumbnail', '--convert-thumbnails', 'jpg']
};
const MIME = { '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.png': 'image/png', '.webm': 'video/webm', '.m4a': 'audio/mp4' };
const STATIC = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const NEVER_SERVE = new Set(['server.js']);

const bin = (cmd, arg = '--version') => { try { return spawnSync(cmd, [arg], { timeout: 8000 }).status === 0; } catch (e) { return false; } };
const have = { ytdlp: bin(YTDLP), ffmpeg: bin(FFMPEG, '-version') };
console.log(`yt-dlp: ${have.ytdlp ? 'found' : 'MISSING'} · ffmpeg: ${have.ffmpeg ? 'found' : 'MISSING'}`);

const send = (res, code, obj) => { const b = JSON.stringify(obj); res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b), 'X-Content-Type-Options': 'nosniff' }); res.end(b); };

/* very small per-IP rate limit + concurrency cap */
const hits = new Map(); let active = 0;
function limited(ip) {
  const now = Date.now(), arr = (hits.get(ip) || []).filter(t => now - t < 60000);
  arr.push(now); hits.set(ip, arr); return arr.length > RATE;
}
setInterval(() => { const now = Date.now(); for (const [ip, a] of hits) if (!a.some(t => now - t < 60000)) hits.delete(ip); }, 60000).unref();

function friendly(stderr) {
  const s = stderr.toLowerCase();
  if (s.includes('sign in to confirm') || s.includes('not a bot')) return 'YouTube is asking this server to prove it is not a bot. This happens on many cloud servers; running PicoTools on your own computer/home connection usually works.';
  if (s.includes('private video') || s.includes('login required') || s.includes('log in') || s.includes('rate-limit reached')) return 'This content is private or needs a login, so it cannot be downloaded.';
  if (s.includes('unsupported url')) return 'That link is not supported. Paste a direct link to a single video or post.';
  if (s.includes('video unavailable') || s.includes('not available') || s.includes('has been removed')) return 'That video is unavailable.';
  if (s.includes('larger than max-filesize') || s.includes('max-filesize')) return `That file is larger than the ${MAX_MB} MB limit.`;
  if (s.includes('ffmpeg') && s.includes('not found')) return 'ffmpeg is not installed on the server.';
  if (s.includes('unable to download') || s.includes('name resolution') || s.includes('timed out') || s.includes('connection')) return 'The server could not reach that site right now. Try again in a moment.';
  return 'Could not download this link. Check that it is a public, single video/post and try again.';
}

function runYtdlp(args, cwd) {
  return new Promise(resolve => {
    const p = spawn(YTDLP, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '', killed = false;
    const timer = setTimeout(() => { killed = true; p.kill('SIGKILL'); }, 180000);
    p.stderr.on('data', d => { err = (err + d).slice(-4000); });
    p.stdout.on('data', () => {});
    p.on('error', e => { clearTimeout(timer); resolve({ code: -1, err: String(e) }); });
    p.on('close', code => { clearTimeout(timer); resolve({ code: killed ? -2 : code, err }); });
  });
}

async function handleDownload(req, res) {
  const ip = req.socket.remoteAddress || '?';
  if (limited(ip)) return send(res, 429, { error: 'Too many requests. Wait a minute and try again.' });
  let raw = ''; for await (const c of req) { raw += c; if (raw.length > 4096) return send(res, 413, { error: 'Request too large.' }); }
  let body; try { body = JSON.parse(raw); } catch (e) { return send(res, 400, { error: 'Bad request.' }); }
  const tool = TOOLS[body.tool];
  if (!tool) return send(res, 400, { error: 'Unknown tool.' });
  if (body.confirm !== true) return send(res, 400, { error: 'Please confirm you own the content or have permission to download it.' });
  let u; try { u = new URL(String(body.url).trim()); } catch (e) { return send(res, 400, { error: 'That is not a valid link.' }); }
  if (!/^https?:$/.test(u.protocol)) return send(res, 400, { error: 'That is not a valid link.' });
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (!HOSTS[tool.p].some(h => host === h || host.endsWith('.' + h))) return send(res, 400, { error: `This tool only accepts ${tool.p[0].toUpperCase() + tool.p.slice(1)} links.` });
  if (!have.ytdlp || !have.ffmpeg) return send(res, 503, { error: 'Server is missing yt-dlp or ffmpeg.' });
  if (active >= 3) return send(res, 503, { error: 'Server is busy. Try again in a moment.' });

  const id = crypto.randomBytes(8).toString('hex'), dir = path.join(TMP, id);
  fs.mkdirSync(dir); active++;
  try {
    const args = ['--no-playlist', '--no-warnings', '--restrict-filenames', '--max-filesize', MAX_MB + 'M', '--socket-timeout', '20',
      '--ffmpeg-location', FFMPEG === 'ffmpeg' ? 'ffmpeg' : FFMPEG, '-o', path.join(dir, '%(title).80B.%(ext)s'), ...MODE_ARGS[tool.m], '--', u.toString()];
    if (FFMPEG === 'ffmpeg') args.splice(args.indexOf('--ffmpeg-location'), 2);
    const r = await runYtdlp(args, dir);
    const files = fs.readdirSync(dir).filter(f => /\.(mp3|mp4|jpg|png|webm|m4a)$/i.test(f));
    if (r.code !== 0 || !files.length) {
      fs.rmSync(dir, { recursive: true, force: true });
      return send(res, 422, { error: r.code === -2 ? 'Timed out (3 minutes). Try a shorter video.' : friendly(r.err) });
    }
    send(res, 200, { title: files[0].replace(/\.[^.]+$/, ''), files: files.map(f => ({ label: f, size: fs.statSync(path.join(dir, f)).size, url: `/files/${id}/${encodeURIComponent(f)}` })) });
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true }); send(res, 500, { error: 'Server error.' });
  } finally { active--; }
}

function serveFile(res, file, type, download) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    const h = { 'Content-Type': type, 'Content-Length': st.size, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' };
    if (download) h['Content-Disposition'] = `attachment; filename="${path.basename(file).replace(/"/g, '')}"`;
    res.writeHead(200, h); fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  let p; try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400); return res.end(); }
  if (req.method === 'GET' && p === '/api/health') return send(res, 200, { ok: true, ...have });
  if (req.method === 'POST' && p === '/api/download') return handleDownload(req, res).catch(() => send(res, 500, { error: 'Server error.' }));
  if (req.method === 'GET' && p.startsWith('/files/')) {
    const [, , id, name] = p.split('/');
    if (!/^[a-f0-9]{16}$/.test(id || '') || !name || name !== path.basename(name)) { res.writeHead(404); return res.end('Not found'); }
    return serveFile(res, path.join(TMP, id, name), MIME[path.extname(name).toLowerCase()] || 'application/octet-stream', true);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  /* static site: top-level whitelisted files only */
  const name = p === '/' ? 'index.html' : path.basename(p);
  const type = STATIC[path.extname(name).toLowerCase()];
  if (!type || NEVER_SERVE.has(name) || p.split('/').filter(Boolean).length > 1) { res.writeHead(404); return res.end('Not found'); }
  serveFile(res, path.join(ROOT, name), type, false);
});

/* delete old downloads */
setInterval(() => {
  const now = Date.now();
  for (const d of fs.readdirSync(TMP)) { const f = path.join(TMP, d); try { if (now - fs.statSync(f).mtimeMs > KEEP_MS) fs.rmSync(f, { recursive: true, force: true }); } catch (e) {} }
}, 5 * 60 * 1000).unref();

let port = PORT, tries = 0;
server.on('error', e => {
  if (e.code === 'EADDRINUSE' && tries < 15) {
    console.log(`Port ${port} is busy — an OLD PicoTools window is probably still running. Close it, or use the new address below.`);
    tries++; port++; server.listen(port);
  } else { console.error('Could not start the server:', e.message); process.exit(1); }
});
server.on('listening', () => {
  const url = `http://localhost:${server.address().port}`;
  console.log(`\nPicoTools (build ${BUILD}) running on ${url}\nKeep this window open while you use the site.\n`);
  if (!process.env.NO_OPEN) {
    try {
      const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
      const c = spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore' }); c.on('error', () => {}); c.unref();
    } catch (e) {}
  }
});
server.listen(port);
