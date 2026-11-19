/**
 * ToolNest — tool directory + tool pages (UI layer).
 * Processing lives in engine.js, downloaders talk to server /api/download,
 * Firebase authentication & user data persistence in firebase.ts.
 */

import { fb, recordToolUsage, requireAuth, openAuthModal, openHistoryModal } from './firebase.ts';

export interface ToolDef {
  s: string;
  n: string;
  d: string;
  k: string;
  cat?: CatDef;
}

export interface CatDef {
  id: string;
  name: string;
  tools: ToolDef[];
}

export const CATS: CatDef[] = [
  {
    id: 'pdf',
    name: 'PDF Tools',
    tools: [
      { s: 'merge-pdf', n: 'Merge PDF', d: 'Combine several PDFs into one, in the order you choose.', k: 'merge' },
      { s: 'split-pdf', n: 'Split PDF', d: 'Extract pages or ranges into a new PDF.', k: 'split' },
      { s: 'compress-pdf', n: 'Compress PDF', d: 'Make a PDF smaller — light or strong compression.', k: 'pdfc' },
      { s: 'rotate-pdf', n: 'Rotate PDF', d: 'Rotate every page by 90°, 180° or 270°.', k: 'rotate' },
      { s: 'jpg-to-pdf', n: 'JPG to PDF', d: 'Turn images into a PDF, one per page.', k: 'img2pdf' },
      { s: 'pdf-to-word', n: 'PDF to Word', d: 'Extract the text of a PDF into an editable .docx.', k: 'pdf2word' },
      { s: 'word-to-pdf', n: 'Word to PDF', d: 'Turn a .docx document into a PDF.', k: 'word2pdf' },
      { s: 'unlock-pdf', n: 'Unlock PDF', d: 'Remove a password you already know.', k: 'unlock' }
    ]
  },
  {
    id: 'yt',
    name: 'YouTube Tools',
    tools: [
      { s: 'youtube-to-mp3', n: 'YouTube to MP3', d: 'Convert a video you have rights to into an MP3.', k: 'dl' },
      { s: 'youtube-to-mp4', n: 'YouTube to MP4', d: 'Save a video you have rights to as MP4.', k: 'dl' },
      { s: 'shorts-downloader', n: 'Shorts Downloader', d: 'Save a Short you have rights to.', k: 'dl' },
      { s: 'thumbnail-downloader', n: 'Thumbnail Downloader', d: 'Fetch the thumbnail image of a video.', k: 'dl' }
    ]
  },
  {
    id: 'ig',
    name: 'Instagram Tools',
    tools: [
      { s: 'instagram-video', n: 'Instagram Video Downloader', d: 'Save a public video you have permission to use.', k: 'dl' },
      { s: 'reels-downloader', n: 'Reels Downloader', d: 'Save a public reel you have permission to use.', k: 'dl' }
    ]
  },
  {
    id: 'tt',
    name: 'TikTok Tools',
    tools: [
      { s: 'tiktok-video', n: 'TikTok Video Downloader', d: 'Save a video you have permission to use.', k: 'dl' },
      { s: 'tiktok-to-mp3', n: 'TikTok to MP3', d: 'Save the sound of a video you have rights to.', k: 'dl' }
    ]
  },
  {
    id: 'img',
    name: 'Image Tools',
    tools: [
      { s: 'compress-image', n: 'Compress Image', d: 'Shrink image file size with adjustable quality.', k: 'cimg' },
      { s: 'resize-image', n: 'Resize Image', d: 'Change image dimensions by pixels.', k: 'rimg' },
      { s: 'convert-image', n: 'Convert Image', d: 'Convert between PNG, JPG and WebP.', k: 'vimg' },
      { s: 'remove-background', n: 'Remove Background', d: 'Make a plain background transparent.', k: 'rmbg' }
    ]
  }
];

const $ = (s: string, r: Document | HTMLElement = document) => r.querySelector(s) as HTMLElement;
const el = (tag: string, attrs: Record<string, any> = {}, ...kids: any[]): HTMLElement => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) (e as any)[k] = v;
    else e.setAttribute(k, v);
  }
  kids.flat().forEach(c => {
    if (typeof c === 'string' || typeof c === 'number') e.append(document.createTextNode(String(c)));
    else if (c instanceof Node) e.append(c);
  });
  return e;
};

const bySlug: Record<string, ToolDef> = {};
CATS.forEach(c => c.tools.forEach(t => { t.cat = c; bySlug[t.s] = t; }));

const fmt = (n: number) => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB';
const slug = new URLSearchParams(location.search).get('t');
const tag = (k: string) => k === 'dl' ? el('span', { class: 'tag srv' }, 'Server tool') : el('span', { class: 'tag ok' }, 'Runs in browser');

const card = (t: ToolDef) => el(
  'a',
  { class: 'card', href: 'tool.html?t=' + t.s, 'data-slug': t.s },
  el('div', { class: 'in' }, el('b', {}, t.n), el('span', { class: 'd' }, t.d), el('div', { class: 'meta' }, tag(t.k)))
);

export function renderDirInto(root: HTMLElement) {
  CATS.forEach(c => {
    root.append(
      el('div', { class: 'cathead', id: 'cat-' + c.id }, el('h3', {}, c.name), el('span', { class: 'tag' }, c.tools.length + ' tools')),
      el('div', { class: 'grid' }, c.tools.map(card))
    );
  });
}

/* ---------------------------------------------------------------- tool page */
export function renderTool(app: HTMLElement, t: ToolDef) {
  document.title = t.n + ' — ToolNest';
  
  const userBanner = el('div', { id: 'tool-auth-notice', style: 'margin-bottom:16px;font-size:13px;display:flex;align-items:center;gap:8px' });
  syncToolAuthNotice(userBanner, t);
  window.addEventListener('toolnest:auth-changed', () => syncToolAuthNotice(userBanner, t));

  app.append(
    el('div', { class: 'crumb' }, el('a', { href: 'tool.html' }, 'All tools'), ' · ', t.cat?.name || 'Tools'),
    el('h1', {}, t.n),
    el('p', { class: 'lead' }, t.d),
    userBanner
  );

  if (t.k === 'dl') renderDl(app, t);
  else renderLocal(app, t);

  app.append(feedbackBox(t));
  app.append(
    el('h3', { class: 'moreh' }, 'More ' + (t.cat?.name || 'Tools')),
    el('div', { class: 'grid' }, (t.cat?.tools || []).filter(x => x.s !== t.s).map(card))
  );
}

function syncToolAuthNotice(banner: HTMLElement, t: ToolDef) {
  const user = (window as any).getCurrentUser?.();
  if (user) {
    banner.innerHTML = `
      <span class="tag ok" style="padding:3px 10px">✓ Connected</span>
      <span style="color:var(--mut)">Logged in as <b>${user.email}</b>. Usage and output are automatically saved to your account.</span>
      <a href="#" id="link-show-history" style="color:var(--lav);margin-left:auto;text-decoration:underline">My History</a>
    `;
    const histLink = banner.querySelector('#link-show-history') as HTMLElement;
    if (histLink) histLink.onclick = (e) => { e.preventDefault(); openHistoryModal(); };
  } else {
    banner.innerHTML = `
      <span class="tag srv" style="padding:3px 10px">Account Required</span>
      <span style="color:var(--mut)">Sign in or sign up before using this tool to save your files and activity.</span>
      <button class="btn ghost" id="btn-banner-signin" style="height:26px;font-size:12px;padding:0 10px;margin-left:auto">Sign In / Sign Up</button>
    `;
    const btn = banner.querySelector('#btn-banner-signin') as HTMLElement;
    if (btn) btn.onclick = (e) => { e.preventDefault(); openAuthModal('signin', `Sign in to use ${t.n}`); };
  }
}

/* ---------------------------------------------------------------- downloader */
function renderDl(app: HTMLElement, t: ToolDef) {
  const url = el('input', { type: 'url', placeholder: 'Paste the link here', 'aria-label': 'Link' }) as HTMLInputElement;
  const ok = el('input', { type: 'checkbox' }) as HTMLInputElement;
  const go = el('button', { class: 'btn', disabled: '' }, t.n.includes('MP3') ? 'Convert to MP3' : t.n.includes('Thumbnail') ? 'Get thumbnail' : 'Get video') as HTMLButtonElement;
  const out = el('div');
  const status = el('div');
  let up = false;

  const sync = () => (go.disabled = !(up && ok.checked && url.value.trim()));
  url.oninput = ok.onchange = sync;

  const warn = (text: string, cls?: string) => status.replaceChildren(el('div', { class: 'msg ' + (cls || '') }, text));

  if (location.protocol === 'file:') {
    warn('Downloader tools need the server. Run "npm run dev" to enable server-side processing.', 'err');
  } else {
    fetch('/api/health')
      .then(r => r.json())
      .then(h => {
        if (!h.ytdlp || !h.ffmpeg) {
          warn('Server is running but ' + [!h.ytdlp && 'yt-dlp', !h.ffmpeg && 'ffmpeg'].filter(Boolean).join(' and ') + ' is not installed on it.', 'err');
        } else {
          up = true;
          sync();
        }
      })
      .catch(() => {
        // Fallback for dev mode
        up = true;
        sync();
      });
  }

  go.onclick = () => {
    // Gate with Firebase Authentication before running
    requireAuth(async () => {
      out.replaceChildren();
      go.disabled = true;
      const label = go.textContent;
      go.textContent = 'Working… (can take up to a minute)';
      try {
        const r = await fetch('/api/download', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tool: t.s, url: url.value.trim(), confirm: true })
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'Server returned ' + r.status);
        out.append(
          el(
            'div',
            { class: 'out' },
            (j.files || []).map((f: any) =>
              el('a', { href: f.url, download: f.label }, el('span', {}, f.label), el('span', {}, fmt(f.size) + ' · Download ↓'))
            )
          )
        );
        out.prepend(el('div', { class: 'msg ok' }, 'Done — your file is ready (kept on the server for 30 minutes).'));

        // Save tool use in Firebase
        recordToolUsage(t.s, t.n, t.cat?.name || 'Downloader', url.value.trim(), 1);
      } catch (e: any) {
        out.append(el('div', { class: 'msg err' }, e.message));
      }
      go.textContent = label;
      sync();
    }, `Please sign in or create an account to use ${t.n}.`);
  };

  app.append(
    el(
      'div',
      { class: 'glass' },
      el('label', { class: 'f' }, 'Link', url),
      el('label', { class: 'chk' }, ok, 'I own this content or have permission to download it, and I accept responsibility for how I use it.'),
      el('div', { class: 'row' }, go),
      status,
      out
    )
  );
}

/* ---------------------------------------------------------------- local tools */
const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
const isImg = (f: File) => f.type.startsWith('image/');
const isDocx = (f: File) => /\.docx$/i.test(f.name);

const CFG: Record<string, { accept: string; multi?: boolean; label: string; test: (f: File) => boolean }> = {
  merge: { accept: '.pdf,application/pdf', multi: true, label: 'Select PDF files', test: isPdf },
  split: { accept: '.pdf,application/pdf', label: 'Select a PDF file', test: isPdf },
  rotate: { accept: '.pdf,application/pdf', label: 'Select a PDF file', test: isPdf },
  pdfc: { accept: '.pdf,application/pdf', label: 'Select a PDF file', test: isPdf },
  pdf2word: { accept: '.pdf,application/pdf', label: 'Select a PDF file', test: isPdf },
  unlock: { accept: '.pdf,application/pdf', label: 'Select a locked PDF', test: isPdf },
  word2pdf: { accept: '.docx', label: 'Select a .docx file', test: isDocx },
  img2pdf: { accept: 'image/*', multi: true, label: 'Select images', test: isImg },
  cimg: { accept: 'image/*', multi: true, label: 'Select images', test: isImg },
  rimg: { accept: 'image/*', multi: true, label: 'Select images', test: isImg },
  vimg: { accept: 'image/*', multi: true, label: 'Select images', test: isImg },
  rmbg: { accept: 'image/*', multi: true, label: 'Select images', test: isImg }
};

function renderLocal(app: HTMLElement, t: ToolDef) {
  const cfg = CFG[t.k] || { accept: '*/*', label: 'Select files', test: () => true };
  let files: File[] = [];

  const input = el('input', { type: 'file', accept: cfg.accept, style: 'display:none', id: 'file' }) as HTMLInputElement;
  if (cfg.multi) input.multiple = true;

  const drop = el(
    'div',
    { class: 'drop', tabindex: '0' },
    el('b', {}, cfg.label),
    el('span', {}, 'or drop files here · processed locally, never uploaded')
  );

  const list = el('ul', { class: 'files' });
  const optsBox = el('div', { class: 'opts' });
  const msg = el('div');
  const out = el('div');
  const run = el('button', { class: 'btn', disabled: '', id: 'run' }, t.n) as HTMLButtonElement;
  const clear = el('button', { class: 'btn ghost' }, 'Clear') as HTMLButtonElement;

  const o: Record<string, HTMLInputElement | HTMLSelectElement> = {};
  const field = (k: string, label: string, attrs: Record<string, any>) => {
    const i = el('input', attrs) as HTMLInputElement;
    o[k] = i;
    return el('label', { class: 'f' }, label, i);
  };
  const select = (k: string, label: string, opts: [string, string][]) => {
    const s = el('select', {}, opts.map(([v, n]) => el('option', { value: v }, n))) as HTMLSelectElement;
    o[k] = s;
    return el('label', { class: 'f' }, label, s);
  };
  const slider = (k: string, label: string, min: number, max: number, val: number, suffix: string) => {
    const i = el('input', { type: 'range', min: String(min), max: String(max), value: String(val) }) as HTMLInputElement;
    const v = el('span', {}, val + suffix);
    o[k] = i;
    i.oninput = () => (v.textContent = i.value + suffix);
    return el('label', { class: 'f' }, el('span', {}, label + ' ', v), i);
  };

  if (t.k === 'split') optsBox.append(field('range', 'Pages to extract', { type: 'text', placeholder: 'e.g. 1-3, 5, 8-10', value: '1' }));
  if (t.k === 'rotate') optsBox.append(select('deg', 'Rotation', [['90', '90° clockwise'], ['180', '180°'], ['270', '270° (90° counter-clockwise)']]));
  if (t.k === 'pdfc') optsBox.append(select('mode', 'Compression', [['light', 'Light — keeps text selectable'], ['strong', 'Strong — pages become images (smallest)']]), slider('q', 'Image quality (strong)', 20, 90, 60, '%'));
  if (t.k === 'unlock') optsBox.append(field('password', 'PDF password', { type: 'password', placeholder: 'the password you know', autocomplete: 'off' }));
  if (t.k === 'cimg') optsBox.append(slider('q', 'Quality', 10, 95, 70, '%'), field('mw', 'Max width in px (optional)', { type: 'number', min: '1', placeholder: 'keep original' }));
  if (t.k === 'rimg') optsBox.append(field('w', 'Width (px)', { type: 'number', min: '1', placeholder: 'auto' }), field('h', 'Height (px)', { type: 'number', min: '1', placeholder: 'auto' }), el('div', { class: 'msg' }, 'Fill one field to keep the aspect ratio, or both to set an exact size.'));
  if (t.k === 'vimg') optsBox.append(select('fmt', 'Convert to', [['image/png', 'PNG'], ['image/jpeg', 'JPG'], ['image/webp', 'WebP']]));
  if (t.k === 'rmbg') optsBox.append(slider('tol', 'Tolerance', 10, 140, 45, ''), el('div', { class: 'msg' }, 'Works best on pictures with a plain, solid-colour background. The background colour is read from the corners.'));
  if (t.k === 'pdf2word') optsBox.append(el('div', { class: 'msg' }, 'Extracts the text of every page. Images and layout are not kept, and scanned PDFs (no real text) are not supported.'));
  if (t.k === 'word2pdf') optsBox.append(el('div', { class: 'msg' }, 'Converts the text of a .docx. Images, tables and fonts are not kept.'));
  if (t.k === 'unlock') optsBox.append(el('div', { class: 'msg' }, 'You need to know the password. The unlocked copy has its pages saved as images, so text is not selectable.'));
  if (!optsBox.children.length) optsBox.style.display = 'none';

  const vals = () => {
    const v: Record<string, string> = {};
    for (const [k, i] of Object.entries(o)) v[k] = i.value;
    return v;
  };

  const say = (text: string, cls?: string) => msg.replaceChildren(text ? el('div', { class: 'msg ' + (cls || '') }, text) : '');

  const draw = () => {
    list.replaceChildren(
      ...files.map((f, i) => {
        const li = el('li', {}, el('span', { class: 'n' }, f.name), el('small', {}, fmt(f.size)));
        if (t.k === 'merge' || t.k === 'img2pdf') {
          li.append(
            el('button', { title: 'Move up', onclick: () => { if (i) { [files[i - 1], files[i]] = [files[i], files[i - 1]]; draw(); } } }, '↑'),
            el('button', { title: 'Move down', onclick: () => { if (i < files.length - 1) { [files[i + 1], files[i]] = [files[i], files[i + 1]]; draw(); } } }, '↓')
          );
        }
        li.append(el('button', { title: 'Remove', onclick: () => { files.splice(i, 1); draw(); } }, '×'));
        return li;
      })
    );
    run.disabled = !files.length || (t.k === 'merge' && files.length < 2);
    out.replaceChildren();
  };

  const add = (fl: FileList | File[]) => {
    const ok = [...fl].filter(cfg.test);
    if (!ok.length) return say('Unsupported file type for this tool.', 'err');
    say('');
    files = cfg.multi ? files.concat(ok) : ok.slice(0, 1);
    draw();
  };

  drop.onclick = () => input.click();
  drop.onkeydown = e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      input.click();
    }
  };
  input.onchange = () => {
    if (input.files) add(input.files);
    input.value = '';
  };
  ['dragenter', 'dragover'].forEach(ev =>
    drop.addEventListener(ev, e => {
      e.preventDefault();
      drop.classList.add('over');
    })
  );
  ['dragleave', 'drop'].forEach(ev =>
    drop.addEventListener(ev, e => {
      e.preventDefault();
      drop.classList.remove('over');
    })
  );
  drop.addEventListener('drop', (e: DragEvent) => {
    if (e.dataTransfer?.files) add(e.dataTransfer.files);
  });

  clear.onclick = () => {
    files = [];
    draw();
    say('');
  };

  run.onclick = () => {
    // Gate with Firebase Authentication before running
    requireAuth(async () => {
      run.disabled = true;
      const label = run.textContent;
      run.textContent = 'Working…';
      say('');
      out.replaceChildren();

      try {
        const runToolFn = (window as any).runTool;
        if (!runToolFn) throw new Error('Tool engine is loading. Please try again in a moment.');

        const res = await runToolFn(t.k, files, vals());
        out.replaceChildren(
          el(
            'div',
            { class: 'out' },
            res.map((r: any) => {
              const u = URL.createObjectURL(r.blob);
              return el(
                'a',
                { href: u, download: r.name },
                el('span', {}, r.name),
                el('span', {}, fmt(r.blob.size) + (r.note ? ' · ' + r.note : '') + ' · Download ↓')
              );
            })
          )
        );
        say('Done — your file is ready.', 'ok');

        // Store tool usage into Firebase Realtime Database
        const summary = res.map((r: any) => r.name + (r.note ? ` (${r.note})` : '')).join(', ');
        recordToolUsage(t.s, t.n, t.cat?.name || 'Local Tool', summary, files.length);
      } catch (e: any) {
        say(e.message || String(e), 'err');
      }
      run.textContent = label;
      run.disabled = false;
    }, `Please sign in or create an account to use ${t.n}.`);
  };

  app.append(el('div', { class: 'glass' }, drop, input, list, optsBox, el('div', { class: 'row' }, run, clear), msg, out));
}

/* ---------------------------------------------------------------- Feedback */
function feedbackBox(t: ToolDef) {
  const ta = el('textarea', { rows: '3', maxlength: '500', placeholder: 'Something broken or missing? Tell us (max 500 characters)' }) as HTMLTextAreaElement;
  const btn = el('button', { class: 'btn ghost' }, 'Send feedback') as HTMLButtonElement;
  const note = el('div');

  btn.onclick = async () => {
    const m = ta.value.trim();
    if (m.length < 3) {
      note.replaceChildren(el('div', { class: 'msg err' }, 'Please write a few words first.'));
      return;
    }
    btn.disabled = true;
    try {
      await fb.feedback(t.s, m);
      ta.value = '';
      note.replaceChildren(el('div', { class: 'msg ok' }, 'Thanks — feedback sent.'));
    } catch {
      note.replaceChildren(el('div', { class: 'msg err' }, 'Could not send feedback right now.'));
    }
    btn.disabled = false;
  };

  return el('div', { class: 'glass', style: 'margin-top:24px' }, el('label', { class: 'f' }, 'Feedback', ta), el('div', { class: 'row' }, btn), note);
}

export function showUsage() {
  fb.get('usage')
    .then(u => {
      if (!u) return;
      document.querySelectorAll('[data-slug]').forEach(a => {
        const slug = (a as HTMLElement).dataset.slug;
        const n = slug && u[slug] && u[slug].count;
        const meta = a.querySelector('.meta');
        if (n && meta && !meta.querySelector('.usage-tag')) {
          meta.append(el('span', { class: 'tag usage-tag' }, n.toLocaleString() + ' uses'));
        }
      });
    })
    .catch(() => {});
}

// Mouse glow on shards & cards
document.addEventListener('pointermove', (e: PointerEvent) => {
  const target = e.target as HTMLElement;
  const c = target.closest && (target.closest('.card,.shard') as HTMLElement);
  if (!c) return;
  const r = c.getBoundingClientRect();
  c.style.setProperty('--mx', (e.clientX - r.left) + 'px');
  c.style.setProperty('--my', (e.clientY - r.top) + 'px');
});

// Auto-run when imported
export function initApp() {
  const root = $('#tools-root') as HTMLElement;
  const app = $('#app') as HTMLElement;

  if (root) {
    renderDirInto(root);
    showUsage();
    return;
  }
  if (!app) return;

  if (slug && bySlug[slug]) {
    renderTool(app, bySlug[slug]);
  } else {
    document.title = 'All tools — ToolNest';
    app.append(
      el('div', { class: 'crumb' }, 'ToolNest · Directory'),
      el('h1', {}, 'Every tool,', el('br'), 'one place.'),
      el(
        'p',
        { class: 'lead' },
        'PDF, video and image tools in five categories. PDF and image tools run privately in your browser; downloader tools run on the ToolNest server.'
      )
    );
    renderDirInto(app);
  }
  showUsage();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
}
