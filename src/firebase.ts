/**
 * ToolNest ↔ Firebase Integration
 * 
 * Configured with user's Firebase Project: tools-website-claude
 * Handles:
 * - Authentication (Sign Up, Sign In, Google Sign In, Password Reset, Sign Out)
 * - User Profile & Tool Usage Persistence in Firebase Realtime Database
 * - Usage Counters & Feedback REST endpoints
 * - Smoked-glass Auth Modal & History Drawer matching ToolNest's aesthetic
 */

import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  updateProfile,
  sendPasswordResetEmail,
  User
} from 'firebase/auth';
import {
  getDatabase,
  ref,
  set,
  push,
  get,
  child,
  serverTimestamp
} from 'firebase/database';

export interface ToolUsageRecord {
  id?: string;
  toolSlug: string;
  toolName: string;
  category?: string;
  timestamp: number;
  details?: string;
  fileCount?: number;
}

export interface UserProfileData {
  uid: string;
  email: string | null;
  displayName: string | null;
  createdAt: number;
  lastLoginAt: number;
  totalToolsUsed: number;
}

// User's Firebase Configuration
const configuredApiKey =
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_FIREBASE_API_KEY) ||
  (typeof localStorage !== 'undefined' && localStorage.getItem('toolnest_firebase_api_key')) ||
  'AIzaSyAQ•••••••••••••••••••••••••••••••';

export const firebaseConfig = {
  apiKey: configuredApiKey,
  authDomain: 'tools-website-claude.firebaseapp.com',
  databaseURL: 'https://tools-website-claude-default-rtdb.firebaseio.com',
  projectId: 'tools-website-claude',
  storageBucket: 'tools-website-claude.firebasestorage.app',
  messagingSenderId: '86852391717',
  appId: '1:86852391717:web:a46c1ae989fa07556f40cc',
  measurementId: 'G-5EZHE7CK7K'
};

export const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);
export const rtdb = getDatabase(app);

export type AuthUser = User | { uid: string; email: string | null; displayName: string | null; isDemo?: boolean };

let currentUser: AuthUser | null = (() => {
  if (typeof localStorage !== 'undefined') {
    try {
      const stored = localStorage.getItem('toolnest_active_user');
      if (stored) return JSON.parse(stored);
    } catch {}
  }
  return null;
})();

let pendingAuthCallback: (() => void) | null = null;

// Auth state listener
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    try {
      localStorage.setItem('toolnest_active_user', JSON.stringify({
        uid: user.uid,
        email: user.email,
        displayName: user.displayName
      }));
      await saveUserProfile(user);
    } catch {
      // Graceful fallback
    }
  } else if (!currentUser || !('isDemo' in currentUser) || !currentUser.isDemo) {
    currentUser = null;
    localStorage.removeItem('toolnest_active_user');
  }

  updateNavUserUI();
  window.dispatchEvent(new CustomEvent('toolnest:auth-changed', { detail: { user: currentUser } }));
  if (currentUser && pendingAuthCallback) {
    const cb = pendingAuthCallback;
    pendingAuthCallback = null;
    closeAuthModal();
    cb();
  }
});

// Save or update user profile in Firebase Realtime Database
export async function saveUserProfile(user: AuthUser): Promise<void> {
  const userProfile: UserProfileData = {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName || (user.email ? user.email.split('@')[0] : 'User'),
    createdAt: Date.now(),
    lastLoginAt: Date.now(),
    totalToolsUsed: getLocalUsageCount(user.uid)
  };

  if (!('isDemo' in user && user.isDemo)) {
    try {
      const userRef = ref(rtdb, `users/${user.uid}/profile`);
      await set(userRef, {
        ...userProfile,
        lastLoginAt: serverTimestamp()
      });
    } catch (err) {
      console.warn('Realtime Database profile sync note:', err);
    }
  }

  // Also sync locally
  localStorage.setItem(`toolnest_user_${user.uid}`, JSON.stringify(userProfile));
}

export function signInDemoUser(email: string = 'alex@example.com', displayName: string = 'Alex'): void {
  const existing = localStorage.getItem('toolnest_active_user');
  let demoUid = 'demo_user';
  if (existing) {
    try {
      const parsed = JSON.parse(existing);
      if (parsed.uid) demoUid = parsed.uid;
    } catch {}
  } else {
    demoUid = 'demo_' + Math.random().toString(36).substring(2, 9);
  }

  const demo: AuthUser = {
    uid: demoUid,
    email,
    displayName,
    isDemo: true
  };
  currentUser = demo;
  localStorage.setItem('toolnest_active_user', JSON.stringify(demo));
  saveUserProfile(demo);
  updateNavUserUI();
  window.dispatchEvent(new CustomEvent('toolnest:auth-changed', { detail: { user: demo } }));

  if (pendingAuthCallback) {
    const cb = pendingAuthCallback;
    pendingAuthCallback = null;
    closeAuthModal();
    cb();
  } else {
    closeAuthModal();
  }
}

export async function logoutUser(): Promise<void> {
  currentUser = null;
  localStorage.removeItem('toolnest_active_user');
  try {
    await signOut(auth);
  } catch {}
  updateNavUserUI();
  window.dispatchEvent(new CustomEvent('toolnest:auth-changed', { detail: { user: null } }));
}

// Record tool usage to Firebase Realtime Database & local cache
export async function recordToolUsage(
  toolSlug: string,
  toolName: string,
  category: string = 'General',
  details: string = '',
  fileCount: number = 1
): Promise<void> {
  const record: ToolUsageRecord = {
    toolSlug,
    toolName,
    category,
    timestamp: Date.now(),
    details,
    fileCount
  };

  // Always increment global counter on Firebase RTDB
  fb.hit(toolSlug);

  if (currentUser) {
    const uid = currentUser.uid;
    // 1. Save to local storage cache for instant UI display
    addLocalUsageRecord(uid, record);

    // 2. Persist to Firebase Realtime Database
    if (!('isDemo' in currentUser && currentUser.isDemo)) {
      try {
        const userToolsRef = ref(rtdb, `users/${uid}/tools_used`);
        const newEntryRef = push(userToolsRef);
        await set(newEntryRef, {
          ...record,
          timestamp: serverTimestamp()
        });

        // Update total stats
        const statsRef = ref(rtdb, `users/${uid}/stats`);
        await set(statsRef, {
          lastTool: toolSlug,
          lastToolName: toolName,
          totalUsed: getLocalUsageCount(uid),
          lastUsedAt: serverTimestamp()
        });
      } catch (err) {
        console.warn('Tool usage database sync note:', err);
      }
    }
  }
  updateNavUserUI();
}

function getLocalUsageCount(uid: string): number {
  const records = getLocalHistory(uid);
  return records.length;
}

function addLocalUsageRecord(uid: string, record: ToolUsageRecord) {
  const key = `toolnest_history_${uid}`;
  const existing: ToolUsageRecord[] = getLocalHistory(uid);
  existing.unshift(record);
  if (existing.length > 50) existing.length = 50; // keep last 50
  localStorage.setItem(key, JSON.stringify(existing));
}

export function getLocalHistory(uid: string): ToolUsageRecord[] {
  try {
    const raw = localStorage.getItem(`toolnest_history_${uid}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

// Fetch user tool history from Firebase RTDB with local fallback
export async function fetchUserHistory(uid: string): Promise<ToolUsageRecord[]> {
  const local = getLocalHistory(uid);
  if (currentUser && 'isDemo' in currentUser && currentUser.isDemo) {
    return local;
  }
  try {
    const snapshot = await get(child(ref(rtdb), `users/${uid}/tools_used`));
    if (snapshot.exists()) {
      const data = snapshot.val();
      const list: ToolUsageRecord[] = Object.keys(data).map(k => ({
        id: k,
        ...data[k],
        timestamp: typeof data[k].timestamp === 'number' ? data[k].timestamp : Date.now()
      }));
      list.sort((a, b) => b.timestamp - a.timestamp);
      return list;
    }
  } catch {
    // If database read rules or network issue, fallback to local
  }
  return local;
}

// Guard: Require authentication before using a tool
export function requireAuth(action: () => void, promptReason: string = 'Please sign in or create an account to use this tool and save your history.'): void {
  if (currentUser) {
    action();
  } else {
    pendingAuthCallback = action;
    openAuthModal('signin', promptReason);
  }
}

// ToolNest ↔ Firebase Realtime Database REST helper (preserves original interface)
const FB_URL = firebaseConfig.databaseURL;
export const fb = {
  async get(path: string) {
    const r = await fetch(`${FB_URL}/${path}.json`);
    if (!r.ok) throw new Error('Firebase ' + r.status);
    return r.json();
  },
  async send(method: string, path: string, body: any) {
    const r = await fetch(`${FB_URL}/${path}.json`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true
    });
    if (!r.ok) throw new Error('Firebase ' + r.status);
    return r.json();
  },
  hit(slug: string) {
    this.send('PUT', `usage/${slug}/count`, { '.sv': { increment: 1 } }).catch(() => {});
  },
  feedback(tool: string, message: string) {
    return this.send('POST', 'feedback', { tool, message, ts: { '.sv': 'timestamp' } });
  }
};

/* -------------------------------------------------------------
 * UI: Smoked-Glass Auth Modal & User Navigation Widget
 * ------------------------------------------------------------- */

let authModalEl: HTMLElement | null = null;
let historyModalEl: HTMLElement | null = null;

export function openAuthModal(tab: 'signin' | 'signup' = 'signin', reason: string = ''): void {
  ensureAuthModalDOM();
  if (!authModalEl) return;
  
  const reasonEl = authModalEl.querySelector('.tn-auth-reason') as HTMLElement;
  if (reasonEl) {
    reasonEl.textContent = reason || 'Sign in or create an account to use tools and keep your history.';
    reasonEl.style.display = reason ? 'block' : 'none';
  }

  const errEl = authModalEl.querySelector('.tn-auth-msg') as HTMLElement;
  if (errEl) {
    errEl.textContent = '';
    errEl.className = 'tn-auth-msg';
    errEl.style.display = 'none';
  }

  switchTab(tab);
  authModalEl.classList.add('on');
  document.body.style.overflow = 'hidden';
}

export function closeAuthModal(): void {
  if (authModalEl) {
    authModalEl.classList.remove('on');
    document.body.style.overflow = '';
  }
}

export function openHistoryModal(): void {
  if (!currentUser) {
    openAuthModal('signin', 'Sign in to view your tools history.');
    return;
  }
  ensureHistoryModalDOM();
  if (historyModalEl) {
    renderHistoryContent();
    historyModalEl.classList.add('on');
    document.body.style.overflow = 'hidden';
  }
}

export function closeHistoryModal(): void {
  if (historyModalEl) {
    historyModalEl.classList.remove('on');
    document.body.style.overflow = '';
  }
}

function switchTab(tab: 'signin' | 'signup') {
  if (!authModalEl) return;
  const tabSignIn = authModalEl.querySelector('#tn-tab-signin') as HTMLElement;
  const tabSignUp = authModalEl.querySelector('#tn-tab-signup') as HTMLElement;
  const nameRow = authModalEl.querySelector('#tn-row-name') as HTMLElement;
  const submitBtn = authModalEl.querySelector('#tn-auth-submit') as HTMLButtonElement;
  const title = authModalEl.querySelector('.tn-auth-title') as HTMLElement;

  if (tab === 'signin') {
    tabSignIn?.classList.add('active');
    tabSignUp?.classList.remove('active');
    if (nameRow) nameRow.style.display = 'none';
    if (submitBtn) submitBtn.textContent = 'Sign In';
    if (title) title.textContent = 'Welcome back to ToolNest';
  } else {
    tabSignUp?.classList.add('active');
    tabSignIn?.classList.remove('active');
    if (nameRow) nameRow.style.display = 'block';
    if (submitBtn) submitBtn.textContent = 'Create Account';
    if (title) title.textContent = 'Create your ToolNest account';
  }
}

function ensureAuthModalDOM() {
  if (authModalEl) return;

  authModalEl = document.createElement('div');
  authModalEl.id = 'toolnest-auth-modal';
  authModalEl.className = 'tn-modal-overlay';
  authModalEl.innerHTML = `
    <div class="tn-modal-backdrop"></div>
    <div class="tn-modal-card glass">
      <div class="tn-modal-header">
        <div class="brand"><i></i>ToolNest</div>
        <button class="tn-modal-close" aria-label="Close modal">×</button>
      </div>

      <h3 class="tn-auth-title">Welcome to ToolNest</h3>
      <p class="tn-auth-reason"></p>

      <div class="tn-auth-tabs">
        <button class="tn-tab-btn active" id="tn-tab-signin">Sign In</button>
        <button class="tn-tab-btn" id="tn-tab-signup">Create Account</button>
      </div>

      <div class="tn-auth-msg" style="display:none"></div>

      <form id="tn-auth-form" class="tn-auth-form">
        <div class="f" id="tn-row-name" style="display:none">
          <label>Your Name</label>
          <input type="text" id="tn-input-name" placeholder="Alex" autocomplete="name" />
        </div>
        <div class="f">
          <label>Email Address</label>
          <input type="email" id="tn-input-email" required placeholder="alex@example.com" autocomplete="email" />
        </div>
        <div class="f">
          <label>Password</label>
          <input type="password" id="tn-input-password" required placeholder="••••••••" autocomplete="current-password" minlength="6" />
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:12.5px;margin-top:-4px">
          <span style="color:var(--mut)">Minimum 6 characters</span>
          <a href="#" id="tn-link-forgot" style="color:var(--lav)">Forgot password?</a>
        </div>

        <button type="submit" class="btn" id="tn-auth-submit" style="width:100%;margin-top:14px">Sign In</button>
      </form>

      <div class="tn-auth-divider"><span>or continue with</span></div>

      <button type="button" class="btn ghost" id="tn-google-btn" style="width:100%;gap:10px">
        <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"/><path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.34 24 12 24z"/><path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/><path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.34 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/></svg>
        Sign in with Google
      </button>

      <div id="tn-demo-row" style="margin-top:12px;padding:10px 12px;border-radius:10px;background:rgba(54,214,126,0.06);border:1px solid rgba(54,214,126,0.22);display:flex;align-items:center;justify-content:space-between;gap:8px">
        <div style="text-align:left">
          <div style="font-size:12px;font-weight:600;color:#36d67e">Instant Test Account</div>
          <div style="font-size:11px;color:var(--mut)">Try tools immediately with local session & history</div>
        </div>
        <button type="button" class="btn" id="tn-btn-instant-demo" style="height:28px;font-size:11.5px;padding:0 12px;white-space:nowrap;background:rgba(54,214,126,0.2);border-color:rgba(54,214,126,0.4);color:#36d67e">
          Quick Sign In ⚡
        </button>
      </div>

      <div class="tn-auth-footer-note">
        <small style="color:var(--mut);font-size:11.5px;display:block;text-align:center;margin-top:14px">
          Protected by Firebase Authentication. Your files remain 100% private.
        </small>
        <div id="tn-key-prompt-row" style="margin-top:10px;text-align:center;font-size:11px">
          <a href="#" id="tn-toggle-key-input" style="color:rgba(255,255,255,.38);text-decoration:underline">Firebase API Key Settings</a>
          <div id="tn-key-input-box" style="display:none;margin-top:8px;padding:8px;border:1px solid rgba(255,255,255,.1);border-radius:8px;background:rgba(0,0,0,.3)">
            <input type="text" id="tn-manual-api-key" placeholder="Paste your Firebase Web API Key" style="height:34px;font-size:12px;width:100%" />
            <button type="button" class="btn" id="tn-save-api-key" style="height:30px;font-size:12px;padding:0 12px;margin-top:6px;width:100%">Apply Key</button>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(authModalEl);

  // Setup event listeners
  const closeBtn = authModalEl.querySelector('.tn-modal-close') as HTMLElement;
  const backdrop = authModalEl.querySelector('.tn-modal-backdrop') as HTMLElement;
  closeBtn.onclick = closeAuthModal;
  backdrop.onclick = closeAuthModal;

  const tabSignIn = authModalEl.querySelector('#tn-tab-signin') as HTMLElement;
  const tabSignUp = authModalEl.querySelector('#tn-tab-signup') as HTMLElement;
  tabSignIn.onclick = () => switchTab('signin');
  tabSignUp.onclick = () => switchTab('signup');

  const form = authModalEl.querySelector('#tn-auth-form') as HTMLFormElement;
  const emailInput = authModalEl.querySelector('#tn-input-email') as HTMLInputElement;
  const passInput = authModalEl.querySelector('#tn-input-password') as HTMLInputElement;
  const nameInput = authModalEl.querySelector('#tn-input-name') as HTMLInputElement;
  const msgEl = authModalEl.querySelector('.tn-auth-msg') as HTMLElement;
  const submitBtn = authModalEl.querySelector('#tn-auth-submit') as HTMLButtonElement;

  const showMsg = (text: string, isErr: boolean = true) => {
    msgEl.textContent = text;
    msgEl.className = 'tn-auth-msg msg ' + (isErr ? 'err' : 'ok');
    msgEl.style.display = 'block';
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    msgEl.style.display = 'none';
    const email = emailInput.value.trim();
    const pass = passInput.value.trim();
    const isSignUp = tabSignUp.classList.contains('active');

    submitBtn.disabled = true;
    const prevLabel = submitBtn.textContent;
    submitBtn.textContent = 'Please wait...';

    try {
      if (isSignUp) {
        const cred = await createUserWithEmailAndPassword(auth, email, pass);
        if (nameInput.value.trim() && cred.user) {
          await updateProfile(cred.user, { displayName: nameInput.value.trim() });
        }
        await saveUserProfile(cred.user);
        showMsg('Account created successfully!', false);
      } else {
        await signInWithEmailAndPassword(auth, email, pass);
        showMsg('Signed in successfully!', false);
      }
      setTimeout(() => closeAuthModal(), 400);
    } catch (err: any) {
      console.error('Firebase Auth error:', err);
      let errorMsg = err.message || 'Authentication failed.';
      const isKeyInvalid = err.code === 'auth/api-key-not-valid' ||
        String(err.message || '').includes('api-key-not-valid') ||
        String(err).includes('api-key-not-valid') ||
        String(err).includes('API key not valid');

      if (isKeyInvalid) {
        errorMsg = 'Your Firebase Web API Key was masked with bullets in the prompt (AIzaSyAQ•••••). Paste your unmasked Firebase Web API Key below, or click "Continue in Test Mode" to proceed immediately.';
        const keyBox = authModalEl?.querySelector('#tn-key-input-box') as HTMLElement;
        if (keyBox) keyBox.style.display = 'block';
        const demoRow = authModalEl?.querySelector('#tn-demo-row') as HTMLElement;
        if (demoRow) demoRow.style.display = 'block';
      } else if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') {
        errorMsg = 'Incorrect email or password.';
      } else if (err.code === 'auth/email-already-in-use') {
        errorMsg = 'An account with this email already exists. Try signing in.';
      } else if (err.code === 'auth/weak-password') {
        errorMsg = 'Password should be at least 6 characters.';
      }
      showMsg(errorMsg, true);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = prevLabel;
    }
  };

  // Google sign in
  const googleBtn = authModalEl.querySelector('#tn-google-btn') as HTMLElement;
  googleBtn.onclick = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
      closeAuthModal();
    } catch (err: any) {
      console.error('Google Sign In error:', err);
      showMsg(err.message || 'Google sign-in could not be completed.', true);
    }
  };

  // Instant demo / test mode button
  const instantDemoBtn = authModalEl.querySelector('#tn-btn-instant-demo') as HTMLButtonElement;
  if (instantDemoBtn) {
    instantDemoBtn.onclick = () => {
      const email = emailInput.value.trim() || 'alex@example.com';
      const name = nameInput.value.trim() || (email.includes('@') ? email.split('@')[0] : 'Alex');
      signInDemoUser(email, name);
    };
  }

  // Forgot password
  const forgotLink = authModalEl.querySelector('#tn-link-forgot') as HTMLElement;
  forgotLink.onclick = async (e) => {
    e.preventDefault();
    const email = emailInput.value.trim();
    if (!email) {
      showMsg('Please enter your email address first, then click Forgot password.', true);
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
      showMsg(`Password reset email sent to ${email}`, false);
    } catch (err: any) {
      showMsg(err.message || 'Could not send reset email.', true);
    }
  };

  // Manual API Key toggle
  const toggleKey = authModalEl.querySelector('#tn-toggle-key-input') as HTMLElement;
  const keyBox = authModalEl.querySelector('#tn-key-input-box') as HTMLElement;
  const manualInput = authModalEl.querySelector('#tn-manual-api-key') as HTMLInputElement;
  const saveKeyBtn = authModalEl.querySelector('#tn-save-api-key') as HTMLButtonElement;

  if (toggleKey && keyBox) {
    toggleKey.onclick = (e) => {
      e.preventDefault();
      keyBox.style.display = keyBox.style.display === 'none' ? 'block' : 'none';
      manualInput.value = localStorage.getItem('toolnest_firebase_api_key') || '';
    };
  }

  if (saveKeyBtn && manualInput) {
    saveKeyBtn.onclick = () => {
      const k = manualInput.value.trim();
      if (k) {
        localStorage.setItem('toolnest_firebase_api_key', k);
        showMsg('Firebase API Key saved. Reloading app...', false);
        setTimeout(() => location.reload(), 600);
      }
    };
  }
}

function ensureHistoryModalDOM() {
  if (historyModalEl) return;

  historyModalEl = document.createElement('div');
  historyModalEl.id = 'toolnest-history-modal';
  historyModalEl.className = 'tn-modal-overlay';
  historyModalEl.innerHTML = `
    <div class="tn-modal-backdrop"></div>
    <div class="tn-modal-card glass" style="max-width:540px">
      <div class="tn-modal-header">
        <div class="brand"><i></i>ToolNest History</div>
        <button class="tn-modal-close" aria-label="Close modal">×</button>
      </div>

      <div id="tn-history-content">
        <p style="color:var(--mut)">Loading your tool history...</p>
      </div>
    </div>
  `;

  document.body.appendChild(historyModalEl);
  const closeBtn = historyModalEl.querySelector('.tn-modal-close') as HTMLElement;
  const backdrop = historyModalEl.querySelector('.tn-modal-backdrop') as HTMLElement;
  closeBtn.onclick = closeHistoryModal;
  backdrop.onclick = closeHistoryModal;
}

async function renderHistoryContent() {
  if (!historyModalEl || !currentUser) return;
  const container = historyModalEl.querySelector('#tn-history-content');
  if (!container) return;

  container.innerHTML = '<div class="msg" style="margin-bottom:12px">Loading your activity from Firebase...</div>';

  const history = await fetchUserHistory(currentUser.uid);
  const total = history.length;
  const userEmail = currentUser.email || 'User';

  if (!history.length) {
    container.innerHTML = `
      <div style="text-align:center;padding:24px 10px">
        <div style="font-size:28px;margin-bottom:10px">🧰</div>
        <b style="display:block;font-size:16px;margin-bottom:6px">No tools used yet</b>
        <p style="color:var(--mut);font-size:13.5px;margin:0 0 16px">Pick any tool from the toolbox to start converting, merging, or compressing files!</p>
        <a href="tool.html" class="btn" style="display:inline-flex">Explore All Tools</a>
      </div>
    `;
    return;
  }

  const itemsHtml = history.map(item => {
    const d = new Date(item.timestamp);
    const timeStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `
      <div class="tn-history-item">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <b>${item.toolName}</b>
          <span class="tag ok" style="font-size:10px">${item.category || 'Tool'}</span>
        </div>
        <div style="display:flex;justify-content:space-between;color:var(--mut);font-size:12px;margin-top:4px">
          <span>${item.details || 'Processed successfully'}</span>
          <span>${timeStr}</span>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,.08)">
      <div>
        <span style="font-size:13px;color:var(--mut)">Signed in as</span>
        <b style="display:block;font-size:14px;color:#fff">${userEmail}</b>
      </div>
      <span class="tag srv" style="font-size:12px;padding:4px 10px">${total} tools used</span>
    </div>
    <div class="tn-history-list" style="max-height:360px;overflow-y:auto;display:grid;gap:8px;padding-right:4px">
      ${itemsHtml}
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:16px;padding-top:12px;border-top:1px solid rgba(255,255,255,.08)">
      <button class="btn ghost" id="tn-btn-clear-history" style="font-size:12px;height:32px;padding:0 12px">Clear Local History</button>
      <button class="btn" id="tn-btn-done-history" style="font-size:12px;height:32px;padding:0 14px">Close</button>
    </div>
  `;

  const doneBtn = container.querySelector('#tn-btn-done-history') as HTMLElement;
  if (doneBtn) doneBtn.onclick = closeHistoryModal;

  const clearBtn = container.querySelector('#tn-btn-clear-history') as HTMLElement;
  if (clearBtn) {
    clearBtn.onclick = () => {
      localStorage.removeItem(`toolnest_history_${currentUser?.uid}`);
      renderHistoryContent();
    };
  }
}

// Update User UI in the nav bar
export function updateNavUserUI(): void {
  const slots = document.querySelectorAll('#nav-user-slot, .nav-user-slot');
  slots.forEach(slot => {
    if (!currentUser) {
      slot.innerHTML = `
        <button class="btn ghost" id="btn-open-signin" style="height:32px;padding:0 14px;font-size:13px">Sign In</button>
      `;
      const btn = slot.querySelector('#btn-open-signin') as HTMLElement;
      if (btn) btn.onclick = (e) => { e.preventDefault(); openAuthModal('signin'); };
    } else {
      const email = currentUser.email || 'User';
      const initial = (currentUser.displayName || email)[0].toUpperCase();
      const count = getLocalUsageCount(currentUser.uid);
      slot.innerHTML = `
        <div class="tn-user-pill" style="display:inline-flex;align-items:center;gap:8px">
          <button class="tn-avatar-btn" title="View Tool History" style="display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-radius:99px;padding:3px 10px 3px 4px;color:#fff;font-size:12.5px;cursor:pointer">
            <span style="width:22px;height:22px;border-radius:50%;background:linear-gradient(135deg,#36d67e,#b9abff);color:#050507;font-weight:600;display:inline-flex;align-items:center;justify-content:center;font-size:11px">${initial}</span>
            <span style="max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${email.split('@')[0]}</span>
            <span class="tag ok" style="padding:1px 5px;font-size:10px">${count}</span>
          </button>
          <button class="btn ghost" id="btn-signout" title="Sign Out" style="height:28px;padding:0 8px;font-size:12px;opacity:.7">Sign Out</button>
        </div>
      `;
      const avatarBtn = slot.querySelector('.tn-avatar-btn') as HTMLElement;
      if (avatarBtn) avatarBtn.onclick = (e) => { e.preventDefault(); openHistoryModal(); };

      const signOutBtn = slot.querySelector('#btn-signout') as HTMLElement;
      if (signOutBtn) signOutBtn.onclick = async (e) => {
        e.preventDefault();
        await logoutUser();
      };
    }
  });

  // Also update static fallback sign in if present
  const fbStatus = document.getElementById('fb-user-status');
  if (fbStatus) {
    if (currentUser) {
      fbStatus.textContent = currentUser.email?.split('@')[0] || 'My Account';
      fbStatus.onclick = openHistoryModal;
    } else {
      fbStatus.textContent = 'Sign in';
      fbStatus.onclick = () => openAuthModal('signin');
    }
  }
}

// Auto-initialize when DOM is ready
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      ensureAuthModalDOM();
      updateNavUserUI();
    });
  } else {
    ensureAuthModalDOM();
    updateNavUserUI();
  }
}

// Attach to window object for access by traditional scripts
if (typeof window !== 'undefined') {
  (window as any).auth = auth;
  (window as any).fb = fb;
  (window as any).requireAuth = requireAuth;
  (window as any).openAuthModal = openAuthModal;
  (window as any).closeAuthModal = closeAuthModal;
  (window as any).openHistoryModal = openHistoryModal;
  (window as any).recordToolUsage = recordToolUsage;
  (window as any).getCurrentUser = () => currentUser;
}
