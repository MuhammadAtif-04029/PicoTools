/* ToolNest ↔ Firebase Realtime Database (REST, no SDK, no API key).
   Used for: per-tool usage counters and a write-only feedback box.
   Every call fails silently — the site works fine if the database is down. */
const FB_URL = 'https://tools-website-claude-default-rtdb.firebaseio.com';
const fb = {
  async get(path) {
    const r = await fetch(`${FB_URL}/${path}.json`);
    if (!r.ok) throw new Error('Firebase ' + r.status);
    return r.json();
  },
  async send(method, path, body) {
    const r = await fetch(`${FB_URL}/${path}.json`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true });
    if (!r.ok) throw new Error('Firebase ' + r.status);
    return r.json();
  },
  /* +1 to usage/<slug>/count using a server-side increment (race-free) */
  hit(slug) { this.send('PUT', `usage/${slug}/count`, { '.sv': { increment: 1 } }).catch(() => {}); },
  feedback(tool, message) { return this.send('POST', 'feedback', { tool, message, ts: { '.sv': 'timestamp' } }); }
};
