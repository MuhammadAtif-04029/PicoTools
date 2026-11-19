/* PicoTools engine — every PDF/image tool, 100 % client-side.
   runTool(kind, files, opts) -> Promise<[{name, blob, note?}]>                */
const LIBS = {
  pdflib: ['PDFLib', 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js'],
  pdfjs: ['pdfjsLib', 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js'],
  jszip: ['JSZip', 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js'],
  mammoth: ['mammoth', 'https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js']
};
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
const _libLoads = {};
function lib(name) {
  const [g, url] = LIBS[name];
  if (window[g]) return Promise.resolve(window[g]);
  if (_libLoads[name]) return _libLoads[name];
  return _libLoads[name] = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = url;
    s.onload = () => { if (name === 'pdfjs') window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; res(window[g]); };
    s.onerror = () => { delete _libLoads[name]; rej(new Error('Could not load a required library. Check your internet connection.')); };
    document.head.appendChild(s);
  });
}

const base = n => n.replace(/\.[^.]+$/, '');
const blobOf = (c, type, q) => new Promise(r => c.toBlob(r, type, q));
const PDF_TYPE = 'application/pdf';
const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const ext = t => t.split('/')[1].replace('jpeg', 'jpg');

async function toCanvas(file, w, h, opaque) {
  let bmp; try { bmp = await createImageBitmap(file); } catch (e) { throw new Error('Could not read image "' + file.name + '".'); }
  const W = Math.max(1, Math.round(w || bmp.width)), H = Math.max(1, Math.round(h || bmp.height));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d', { willReadFrequently: true });
  if (opaque) { x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); }
  x.drawImage(bmp, 0, 0, W, H); return c;
}
function parseRanges(s, n) {
  const idx = [];
  for (const part of String(s).split(',')) {
    const m = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) throw new Error('Invalid range: "' + part.trim() + '". Use something like 1-3, 5');
    const a = +m[1], b = m[2] ? +m[2] : a;
    if (a < 1 || b > n || a > b) throw new Error(`Range ${part.trim()} is outside 1–${n}`);
    for (let i = a; i <= b; i++) idx.push(i - 1);
  }
  return idx;
}
async function loadPdfLibDoc(file) {
  const { PDFDocument } = await lib('pdflib');
  try { return await PDFDocument.load(await file.arrayBuffer()); }
  catch (e) { throw new Error(`Could not read "${file.name}". It may be damaged or password-protected (use Unlock PDF first).`); }
}
async function openPdfJs(file, password) {
  const pdfjs = await lib('pdfjs');
  try { return await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), password: password || undefined }).promise; }
  catch (e) {
    if (e && e.name === 'PasswordException') throw new Error(e.code === 2 ? 'Wrong password.' : 'This PDF needs a password. Enter it above.');
    throw new Error(`Could not read "${file.name}". It may be damaged.`);
  }
}
/* render every page of a pdf.js document to a JPEG-based PDF */
async function rasterize(pdf, scale, quality) {
  const { PDFDocument } = await lib('pdflib');
  const out = await PDFDocument.create();
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i), vp = page.getViewport({ scale });
    const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const jpg = await out.embedJpg(await (await blobOf(c, 'image/jpeg', quality)).arrayBuffer());
    const w = vp.width / scale, h = vp.height / scale;
    out.addPage([w, h]).drawImage(jpg, { x: 0, y: 0, width: w, height: h });
    page.cleanup();
  }
  return out;
}
const xmlEsc = s => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const latin = s => s.replace(/[‘’‚]/g, "'").replace(/[“”„]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/[•·]/g, '-').replace(/\t/g, '    ').replace(/\r/g, '').replace(/[^\n\x20-\x7E\xA0-\xFF]/g, '?');

/* ------------------------------------------------------------ tools */
const TOOLS_IMPL = {
  async merge(files) {
    const { PDFDocument } = await lib('pdflib'), out = await PDFDocument.create();
    for (const f of files) { const src = await loadPdfLibDoc(f); (await out.copyPages(src, src.getPageIndices())).forEach(p => out.addPage(p)); }
    return [{ name: 'merged.pdf', blob: new Blob([await out.save()], { type: PDF_TYPE }), note: out.getPageCount() + ' pages' }];
  },
  async split(files, o) {
    const { PDFDocument } = await lib('pdflib'), src = await loadPdfLibDoc(files[0]);
    const idx = parseRanges(o.range, src.getPageCount()), d = await PDFDocument.create();
    (await d.copyPages(src, idx)).forEach(p => d.addPage(p));
    return [{ name: base(files[0].name) + '-pages.pdf', blob: new Blob([await d.save()], { type: PDF_TYPE }), note: idx.length + ' pages' }];
  },
  async rotate(files, o) {
    const { degrees } = await lib('pdflib'), d = await loadPdfLibDoc(files[0]);
    d.getPages().forEach(p => p.setRotation(degrees((p.getRotation().angle + (+o.deg || 90)) % 360)));
    return [{ name: base(files[0].name) + '-rotated.pdf', blob: new Blob([await d.save()], { type: PDF_TYPE }) }];
  },
  async img2pdf(files) {
    const { PDFDocument } = await lib('pdflib'), d = await PDFDocument.create();
    for (const f of files) {
      let img;
      if (f.type === 'image/jpeg') img = await d.embedJpg(await f.arrayBuffer());
      else if (f.type === 'image/png') img = await d.embedPng(await f.arrayBuffer());
      else img = await d.embedPng(await (await blobOf(await toCanvas(f, 0, 0, true), 'image/png')).arrayBuffer());
      const sc = Math.min(1, 800 / Math.max(img.width, img.height)), w = img.width * sc, h = img.height * sc;
      d.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h });
    }
    return [{ name: 'images.pdf', blob: new Blob([await d.save()], { type: PDF_TYPE }), note: files.length + ' pages' }];
  },
  async pdfc(files, o) {
    const f = files[0], orig = f.size;
    let bytes;
    if (o.mode === 'strong') {
      const pdf = await openPdfJs(f), out = await rasterize(pdf, (+o.dpi || 110) / 72, (+o.q || 60) / 100);
      bytes = await out.save();
    } else {
      const d = await loadPdfLibDoc(f); bytes = await d.save({ useObjectStreams: true });
    }
    if (bytes.length >= orig) return [{ name: base(f.name) + '-compressed.pdf', blob: f.slice(0, f.size, PDF_TYPE), note: 'already as small as this method can make it — try Strong' }];
    return [{ name: base(f.name) + '-compressed.pdf', blob: new Blob([bytes], { type: PDF_TYPE }), note: Math.round((1 - bytes.length / orig) * 100) + '% smaller than ' + fmtBytes(orig) }];
  },
  async pdf2word(files) {
    const pdf = await openPdfJs(files[0], ''); const paras = []; let anyText = false;
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p), tc = await page.getTextContent();
      const items = tc.items.filter(i => i.str !== undefined && i.str.trim() !== '').map(i => ({ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width }));
      items.sort((a, b) => b.y - a.y || a.x - b.x);
      const lines = [];
      for (const it of items) { const L = lines[lines.length - 1]; if (L && Math.abs(L.y - it.y) < 3) L.items.push(it); else lines.push({ y: it.y, items: [it] }); }
      for (const L of lines) {
        L.items.sort((a, b) => a.x - b.x); let t = '', end = null;
        for (const it of L.items) { if (end !== null && it.x - end > 1 && !t.endsWith(' ') && !it.s.startsWith(' ')) t += ' '; t += it.s; end = it.x + it.w; }
        paras.push(t); anyText = true;
      }
      paras.push(p < pdf.numPages ? '\f' : null);
    }
    if (!anyText) throw new Error('No selectable text found. This looks like a scanned PDF — it needs OCR, which this tool does not do.');
    const JSZip = await lib('jszip'), z = new JSZip();
    const body = paras.filter(x => x !== null).map(t => t === '\f' ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : `<w:p><w:r><w:t xml:space="preserve">${xmlEsc(t)}</w:t></w:r></w:p>`).join('');
    z.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    z.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    z.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`);
    const blob = await z.generateAsync({ type: 'blob', mimeType: DOCX_TYPE, compression: 'DEFLATE' });
    return [{ name: base(files[0].name) + '.docx', blob, note: 'text only — images and layout are not kept' }];
  },
  async word2pdf(files) {
    const mammoth = await lib('mammoth'), { PDFDocument, StandardFonts } = await lib('pdflib'), f = files[0];
    let text; try { text = latin((await mammoth.extractRawText({ arrayBuffer: await f.arrayBuffer() })).value); } catch (e) { throw new Error('Could not read this file. Only .docx is supported (not old .doc).'); }
    if (!text.trim()) throw new Error('No text found in this document.');
    const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
    const W = 595.28, H = 841.89, M = 56, fs = 11, lh = 15.5, maxW = W - 2 * M;
    let page = doc.addPage([W, H]), y = H - M;
    const put = line => { if (y < M) { page = doc.addPage([W, H]); y = H - M; } if (line) page.drawText(line, { x: M, y: y - fs, size: fs, font }); y -= lh; };
    for (const para of text.split('\n')) {
      if (!para.trim()) { put(''); continue; }
      let line = '';
      for (let word of para.split(/ +/)) {
        while (font.widthOfTextAtSize(word, fs) > maxW) { let k = word.length; while (k > 1 && font.widthOfTextAtSize(word.slice(0, k), fs) > maxW) k--; if (line) { put(line); line = ''; } put(word.slice(0, k)); word = word.slice(k); }
        const t = line ? line + ' ' + word : word;
        if (line && font.widthOfTextAtSize(t, fs) > maxW) { put(line); line = word; } else line = t;
      }
      if (line) put(line);
    }
    return [{ name: base(f.name) + '.pdf', blob: new Blob([await doc.save()], { type: PDF_TYPE }), note: doc.getPageCount() + ' pages · text only — images and styling are not kept' }];
  },
  async unlock(files, o) {
    const pdf = await openPdfJs(files[0], o.password || ''), out = await rasterize(pdf, 2, .92);
    return [{ name: base(files[0].name) + '-unlocked.pdf', blob: new Blob([await out.save()], { type: PDF_TYPE }), note: 'no password · pages are now images (text not selectable)' }];
  },
  async cimg(files, o) {
    const res = [];
    for (const f of files) {
      const bmp = await createImageBitmap(f), mw = +o.mw || 0, sc = mw && mw < bmp.width ? mw / bmp.width : 1;
      const c = await toCanvas(f, bmp.width * sc, bmp.height * sc, true), b = await blobOf(c, 'image/jpeg', (+o.q || 70) / 100);
      res.push({ name: base(f.name) + '-compressed.jpg', blob: b, note: (b.size < f.size ? Math.round((1 - b.size / f.size) * 100) + '% smaller than ' : 'larger than ') + fmtBytes(f.size) });
    }
    return res;
  },
  async rimg(files, o) {
    const res = [];
    for (const f of files) {
      const bmp = await createImageBitmap(f); let w = +o.w || 0, h = +o.h || 0;
      if (!w && !h) throw new Error('Enter a width, a height, or both.');
      if (!h) h = bmp.height * w / bmp.width; if (!w) w = bmp.width * h / bmp.height;
      const type = f.type === 'image/png' || f.type === 'image/webp' ? f.type : 'image/jpeg';
      res.push({ name: base(f.name) + `-${Math.round(w)}x${Math.round(h)}.${ext(type)}`, blob: await blobOf(await toCanvas(f, w, h, type === 'image/jpeg'), type, .92) });
    }
    return res;
  },
  async vimg(files, o) {
    const res = [], type = o.fmt || 'image/png';
    for (const f of files) {
      const b = await blobOf(await toCanvas(f, 0, 0, type === 'image/jpeg'), type, .92);
      if (!b || b.type !== type) throw new Error('This browser cannot export ' + ext(type).toUpperCase() + '.');
      res.push({ name: base(f.name) + '.' + ext(type), blob: b });
    }
    return res;
  },
  async rmbg(files, o) {
    const res = [], tol = +o.tol || 45;
    for (const f of files) {
      const bmp = await createImageBitmap(f), sc = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
      const c = await toCanvas(f, bmp.width * sc, bmp.height * sc, false), ctx = c.getContext('2d', { willReadFrequently: true });
      const W = c.width, H = c.height, img = ctx.getImageData(0, 0, W, H), d = img.data;
      /* background colour = average of the four corner patches */
      let r = 0, g = 0, b = 0, n = 0; const P = Math.min(6, W >> 1, H >> 1) || 1;
      for (const [cx, cy] of [[0, 0], [W - P, 0], [0, H - P], [W - P, H - P]]) for (let y = cy; y < cy + P; y++) for (let x = cx; x < cx + P; x++) { const i = (y * W + x) * 4; r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
      r /= n; g /= n; b /= n; const t2 = tol * tol;
      const isBg = i => d[i + 3] < 10 || ((d[i] - r) ** 2 + (d[i + 1] - g) ** 2 + (d[i + 2] - b) ** 2) <= t2;
      const seen = new Uint8Array(W * H), q = new Int32Array(W * H); let qh = 0, qt = 0;
      const push = p => { if (!seen[p] && isBg(p * 4)) { seen[p] = 1; q[qt++] = p; } };
      for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); } for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
      while (qh < qt) { const p = q[qh++], x = p % W; if (x > 0) push(p - 1); if (x < W - 1) push(p + 1); if (p >= W) push(p - W); if (p < W * (H - 1)) push(p + W); }
      let removed = 0; for (let p = 0; p < W * H; p++) if (seen[p]) { d[p * 4 + 3] = 0; removed++; }
      if (removed < W * H * 0.002) throw new Error('Could not find a plain background to remove. This tool works best on photos with a solid-colour background — try raising the tolerance.');
      ctx.putImageData(img, 0, 0);
      res.push({ name: base(f.name) + '-no-bg.png', blob: await blobOf(c, 'image/png'), note: Math.round(removed / (W * H) * 100) + '% of the picture made transparent' });
    }
    return res;
  }
};
function fmtBytes(n) { return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB'; }
function runTool(kind, files, opts) {
  const fn = TOOLS_IMPL[kind];
  if (!fn) return Promise.reject(new Error('This tool is not available.'));
  return fn(files, opts || {});
}
window.runTool = runTool;
