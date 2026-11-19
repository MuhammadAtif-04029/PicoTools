import type { Plugin } from 'vite';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { spawn, spawnSync } from 'child_process';

const YTDLP = process.env.YTDLP || 'yt-dlp';
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const MAX_MB = +(process.env.MAX_MB || 300);
const KEEP_MS = +(process.env.KEEP_MIN || 30) * 60 * 1000;
const TMP = path.join(os.tmpdir(), 'toolnest-dl');

try {
  fs.mkdirSync(TMP, { recursive: true });
} catch {}

const bin = (cmd: string, arg = '--version') => {
  try {
    return spawnSync(cmd, [arg], { timeout: 8000 }).status === 0;
  } catch {
    return false;
  }
};

const have = { ytdlp: bin(YTDLP), ffmpeg: bin(FFMPEG, '-version') };

const HOSTS: Record<string, string[]> = {
  youtube: ['youtube.com', 'youtu.be', 'music.youtube.com'],
  instagram: ['instagram.com'],
  tiktok: ['tiktok.com']
};

const TOOLS: Record<string, { p: string; m: string }> = {
  'youtube-to-mp3': { p: 'youtube', m: 'audio' },
  'youtube-to-mp4': { p: 'youtube', m: 'video' },
  'shorts-downloader': { p: 'youtube', m: 'video' },
  'thumbnail-downloader': { p: 'youtube', m: 'thumbnail' },
  'instagram-video': { p: 'instagram', m: 'video' },
  'reels-downloader': { p: 'instagram', m: 'video' },
  'tiktok-video': { p: 'tiktok', m: 'video' },
  'tiktok-to-mp3': { p: 'tiktok', m: 'audio' }
};

const MODE_ARGS: Record<string, string[]> = {
  audio: ['-x', '--audio-format', 'mp3', '--audio-quality', '0'],
  video: ['-f', 'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/b[ext=mp4]/b', '--merge-output-format', 'mp4'],
  thumbnail: ['--skip-download', '--write-thumbnail', '--convert-thumbnails', 'jpg']
};

const MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webm': 'video/webm',
  '.m4a': 'audio/mp4'
};

const sendJson = (res: any, code: number, obj: any) => {
  const b = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(b),
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(b);
};

export function downloaderPlugin(): Plugin {
  return {
    name: 'toolnest-downloader',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url || '/', 'http://localhost');
        const p = url.pathname;

        if (req.method === 'GET' && p === '/api/health') {
          return sendJson(res, 200, { ok: true, ...have });
        }

        if (req.method === 'POST' && p === '/api/download') {
          let raw = '';
          req.on('data', chunk => {
            raw += chunk;
            if (raw.length > 8192) {
              res.writeHead(413, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Request payload too large' }));
              req.destroy();
            }
          });

          req.on('end', async () => {
            try {
              const body = JSON.parse(raw);
              const tool = TOOLS[body.tool];
              if (!tool) return sendJson(res, 400, { error: 'Unknown tool.' });
              if (body.confirm !== true) {
                return sendJson(res, 400, { error: 'Please confirm you own the content or have permission to download it.' });
              }

              let u: URL;
              try {
                u = new URL(String(body.url).trim());
              } catch {
                return sendJson(res, 400, { error: 'That is not a valid link.' });
              }
              if (!/^https?:$/.test(u.protocol)) return sendJson(res, 400, { error: 'That is not a valid link.' });

              const host = u.hostname.toLowerCase().replace(/^www\./, '');
              if (!HOSTS[tool.p].some(h => host === h || host.endsWith('.' + h))) {
                return sendJson(res, 400, { error: `This tool only accepts ${tool.p[0].toUpperCase() + tool.p.slice(1)} links.` });
              }

              if (!have.ytdlp) {
                return sendJson(res, 503, {
                  error: 'yt-dlp is not installed on this cloud environment. PDF and Image tools run 100% locally in your browser.'
                });
              }

              const id = crypto.randomBytes(8).toString('hex');
              const dir = path.join(TMP, id);
              fs.mkdirSync(dir, { recursive: true });

              const args = [
                '--no-playlist',
                '--no-warnings',
                '--restrict-filenames',
                '--max-filesize',
                MAX_MB + 'M',
                '--socket-timeout',
                '20',
                '--ffmpeg-location',
                FFMPEG === 'ffmpeg' ? 'ffmpeg' : FFMPEG,
                '-o',
                path.join(dir, '%(title).80B.%(ext)s'),
                ...MODE_ARGS[tool.m],
                '--',
                u.toString()
              ];
              if (FFMPEG === 'ffmpeg') args.splice(args.indexOf('--ffmpeg-location'), 2);

              const pProc = spawn(YTDLP, args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
              let err = '';
              const timer = setTimeout(() => {
                pProc.kill('SIGKILL');
              }, 180000);

              pProc.stderr.on('data', d => {
                err = (err + d).slice(-4000);
              });
              pProc.on('close', code => {
                clearTimeout(timer);
                const files = fs.readdirSync(dir).filter(f => /\.(mp3|mp4|jpg|png|webm|m4a)$/i.test(f));
                if (code !== 0 || !files.length) {
                  fs.rmSync(dir, { recursive: true, force: true });
                  return sendJson(res, 422, {
                    error: err.toLowerCase().includes('bot')
                      ? 'Service requested bot verification.'
                      : 'Could not download media from that link.'
                  });
                }
                sendJson(res, 200, {
                  title: files[0].replace(/\.[^.]+$/, ''),
                  files: files.map(f => ({
                    label: f,
                    size: fs.statSync(path.join(dir, f)).size,
                    url: `/files/${id}/${encodeURIComponent(f)}`
                  }))
                });
              });
            } catch {
              sendJson(res, 400, { error: 'Bad request.' });
            }
          });
          return;
        }

        if (req.method === 'GET' && p.startsWith('/files/')) {
          const [, , id, name] = p.split('/');
          if (!/^[a-f0-9]{16}$/.test(id || '') || !name || name !== path.basename(name)) {
            res.writeHead(404);
            return res.end('Not found');
          }
          const filePath = path.join(TMP, id, name);
          if (!fs.existsSync(filePath)) {
            res.writeHead(404);
            return res.end('Not found');
          }
          const st = fs.statSync(filePath);
          res.writeHead(200, {
            'Content-Type': MIME[path.extname(name).toLowerCase()] || 'application/octet-stream',
            'Content-Length': st.size,
            'Content-Disposition': `attachment; filename="${path.basename(filePath).replace(/"/g, '')}"`,
            'Cache-Control': 'no-store'
          });
          return fs.createReadStream(filePath).pipe(res);
        }

        next();
      });
    }
  };
}
