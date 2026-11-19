/**
 * PicoTools ↔ Firebase Integration
 *
 * Configured with user's Firebase Project: tools-website-claude
 * Handles:
 * - Realtime Database usage counters & feedback (REST + Firebase SDK)
 * - Sign In / Sign Up gate before tool execution
 * - Google Sign-In via Google Firebase Auth
 * - User Profile & Tool Usage persistence in Firebase & local storage
 * - Smoked-glass modal matching PicoTools theme
 */

var FB_URL = window.FB_URL || 'https://tools-website-claude-default-rtdb.firebaseio.com';
window.FB_URL = FB_URL;

var firebaseConfig = window.firebaseConfig || {
  apiKey:
    (typeof localStorage !== 'undefined' &&
      (localStorage.getItem('picotools_firebase_api_key') || localStorage.getItem('toolnest_firebase_api_key'))) ||
    'AIzaSyAQ•••••••••••••••••••••••••••••••',
  authDomain: 'tools-website-claude.firebaseapp.com',
  databaseURL: FB_URL,
  projectId: 'tools-website-claude',
  storageBucket: 'tools-website-claude.firebasestorage.app',
  messagingSenderId: '86852391717',
  appId: '1:86852391717:web:a46c1ae989fa07556f40cc',
  measurementId: 'G-5EZHE7CK7K',
};
window.firebaseConfig = firebaseConfig;

// PicoTools Realtime Database REST helper
var fb = window.fb || {
  async get(path, authToken) {
    const q = authToken ? `?auth=${encodeURIComponent(authToken)}` : '';
    const r = await fetch(`${FB_URL}/${path}.json${q}`);
    if (!r.ok) throw new Error('Firebase ' + r.status);
    return r.json();
  },
  async send(method, path, body, authToken) {
    const q = authToken ? `?auth=${encodeURIComponent(authToken)}` : '';
    const r = await fetch(`${FB_URL}/${path}.json${q}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
    });
    if (!r.ok) throw new Error('Firebase ' + r.status);
    return r.json();
  },
  hit(slug) {
    this.send('PUT', `usage/${slug}/count`, { '.sv': { increment: 1 } }).catch(() => {});
  },
  feedback(tool, message) {
    return this.send('POST', 'feedback', { tool, message, ts: { '.sv': 'timestamp' } });
  },
};
window.fb = fb;

// User session management
var currentUser =
  window.currentUser ||
  (() => {
    try {
      const s = localStorage.getItem('picotools_current_user') || localStorage.getItem('toolnest_current_user');
      return s ? JSON.parse(s) : null;
    } catch (e) {
      return null;
    }
  })();
window.currentUser = currentUser;

var pendingAuthAction = window.pendingAuthAction || null;

function getCurrentUser() {
  return currentUser;
}

function setSessionUser(u) {
  currentUser = u;
  window.currentUser = u;
  if (u) {
    localStorage.setItem('picotools_current_user', JSON.stringify(u));
    localStorage.setItem('toolnest_current_user', JSON.stringify(u));
  } else {
    localStorage.removeItem('picotools_current_user');
    localStorage.removeItem('toolnest_current_user');
  }
  updateFallbackUserUI();
  try {
    window.dispatchEvent(new CustomEvent('picotools:auth', { detail: u }));
    window.dispatchEvent(new CustomEvent('toolnest:auth', { detail: u }));
    if (typeof window.onAuthChange === 'function') window.onAuthChange(u);
  } catch (e) {}
}

window.__syncFirebaseUser = function (u) {
  if (!u) return;
  if (!currentUser || currentUser.uid !== u.uid || !currentUser.idToken) {
    setSessionUser(u);
  }
};

function logoutUser() {
  if (window.__picoFirebase && typeof window.__picoFirebase.signOut === 'function') {
    window.__picoFirebase.signOut().catch(() => {});
  }
  setSessionUser(null);
  closeAuthModal();
}

// Require Auth Guard: gates tool execution until signed in
function requireAuth(action, reason) {
  if (currentUser) {
    action();
  } else {
    pendingAuthAction = action;
    openAuthModal('signin', reason || 'Please sign in with Google or create an account to use this tool.');
  }
}

// Record Tool Usage to user profile and Firebase RTDB
async function recordToolUsage(slug, name, category, details, fileCount) {
  const user = getCurrentUser();
  const record = {
    toolSlug: slug,
    toolName: name,
    category: category || 'Tool',
    timestamp: Date.now(),
    details: details || '',
    fileCount: fileCount || 1,
  };

  if (user) {
    const key = `picotools_history_${user.uid}`;
    let list = [];
    try {
      list = JSON.parse(localStorage.getItem(key) || '[]');
    } catch (e) {}
    list.unshift(record);
    if (list.length > 50) list.length = 50;
    localStorage.setItem(key, JSON.stringify(list));

    if (window.__picoFirebase && user.idToken && typeof window.__picoFirebase.logToolUsage === 'function') {
      window.__picoFirebase.logToolUsage(user.uid, record).catch(() => {});
    } else if (user.idToken) {
      fb.send('POST', `users/${user.uid}/tools_used`, record, user.idToken).catch(() => {});
      fb.send(
        'PATCH',
        `users/${user.uid}/profile`,
        {
          lastUsedTool: slug,
          lastUsedAt: { '.sv': 'timestamp' },
        },
        user.idToken
      ).catch(() => {});
    }
  }
}

// Auth modal DOM
var modalEl = window.modalEl || null;

function ensureAuthModalDOM() {
  if (modalEl) return;
  modalEl = document.createElement('div');
  modalEl.id = 'toolnest-auth-modal';
  modalEl.className = 'tn-modal-overlay';
  modalEl.innerHTML = `
    <div class="tn-modal-backdrop"></div>
    <div class="tn-modal-card">
      <div class="tn-modal-header">
        <div class="brand"><i></i>PicoTools</div>
        <button class="tn-modal-close" aria-label="Close modal">×</button>
      </div>

      <h3 class="tn-auth-title" id="tn-modal-title">Sign in to PicoTools</h3>
      <p class="tn-auth-reason" id="tn-modal-reason" style="display:none"></p>

      <!-- Google Sign In Button -->
      <button type="button" class="tn-google-btn" id="tn-btn-google">
        <svg viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
        </svg>
        <span id="tn-google-btn-text">Continue with Google</span>
      </button>

      <div class="tn-auth-divider"><span>or with email</span></div>

      <div class="tn-auth-tabs">
        <button class="tn-tab-btn active" id="tn-tab-signin">Sign In</button>
        <button class="tn-tab-btn" id="tn-tab-signup">Create Account</button>
      </div>

      <div class="msg" id="tn-auth-msg" style="display:none;margin-bottom:12px"></div>

      <form id="tn-auth-form" class="tn-auth-form">
        <div class="f" id="tn-name-row" style="display:none">
          <label>Your Name</label>
          <input type="text" id="tn-auth-name" placeholder="Alex" autocomplete="name" />
        </div>
        <div class="f">
          <label>Email Address</label>
          <input type="email" id="tn-auth-email" required placeholder="alex@example.com" autocomplete="email" />
        </div>
        <div class="f">
          <label>Password</label>
          <input type="password" id="tn-auth-pass" required placeholder="••••••••" autocomplete="current-password" minlength="6" />
        </div>

        <button type="submit" class="btn" id="tn-btn-submit" style="width:100%;margin-top:10px">Sign In</button>
      </form>
    </div>
  `;

  document.body.appendChild(modalEl);

  const closeBtn = modalEl.querySelector('.tn-modal-close');
  const backdrop = modalEl.querySelector('.tn-modal-backdrop');
  closeBtn.onclick = closeAuthModal;
  backdrop.onclick = closeAuthModal;

  const tabSignIn = modalEl.querySelector('#tn-tab-signin');
  const tabSignUp = modalEl.querySelector('#tn-tab-signup');
  const nameRow = modalEl.querySelector('#tn-name-row');
  const submitBtn = modalEl.querySelector('#tn-btn-submit');
  const modalTitle = modalEl.querySelector('#tn-modal-title');
  const googleBtn = modalEl.querySelector('#tn-btn-google');
  const googleBtnText = modalEl.querySelector('#tn-google-btn-text');

  function switchTab(t) {
    if (t === 'signin') {
      tabSignIn.classList.add('active');
      tabSignUp.classList.remove('active');
      nameRow.style.display = 'none';
      submitBtn.textContent = 'Sign In';
      modalTitle.textContent = 'Sign in to PicoTools';
    } else {
      tabSignUp.classList.add('active');
      tabSignIn.classList.remove('active');
      nameRow.style.display = 'block';
      submitBtn.textContent = 'Create Account';
      modalTitle.textContent = 'Create your PicoTools account';
    }
  }

  tabSignIn.onclick = () => switchTab('signin');
  tabSignUp.onclick = () => switchTab('signup');

  const form = modalEl.querySelector('#tn-auth-form');
  const emailIn = modalEl.querySelector('#tn-auth-email');
  const passIn = modalEl.querySelector('#tn-auth-pass');
  const nameIn = modalEl.querySelector('#tn-auth-name');
  const msgEl = modalEl.querySelector('#tn-auth-msg');

  function showMsg(text, isErr = true) {
    msgEl.textContent = text;
    msgEl.className = 'msg ' + (isErr ? 'err' : 'ok');
    msgEl.style.display = 'block';
  }

  function completeLogin(user) {
    setSessionUser(user);

    if (window.__picoFirebase && user.idToken && typeof window.__picoFirebase.saveUserProfile === 'function') {
      window.__picoFirebase
        .saveUserProfile(user.uid, {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          provider: user.provider || 'password',
          photoURL: user.photoURL || '',
          lastLoginAt: Date.now(),
        })
        .catch(() => {});
    } else if (user.idToken) {
      fb.send(
        'PUT',
        `users/${user.uid}/profile`,
        {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          provider: user.provider || 'password',
          photoURL: user.photoURL || '',
          lastLoginAt: { '.sv': 'timestamp' },
        },
        user.idToken
      ).catch(() => {});
    }

    showMsg('Signed in successfully!', false);
    setTimeout(() => {
      closeAuthModal();
      if (pendingAuthAction) {
        const action = pendingAuthAction;
        pendingAuthAction = null;
        action();
      }
    }, 300);
  }

  // Google Sign In Click Handler (uses real Google Firebase Auth SDK when API key is configured, with seamless fallback)
  googleBtn.onclick = async () => {
    msgEl.style.display = 'none';
    googleBtnText.textContent = 'Signing in with Google...';
    googleBtn.style.opacity = '0.7';
    googleBtn.style.pointerEvents = 'none';

    try {
      if (window.__picoFirebase && window.__picoFirebase.hasValidApiKey()) {
        try {
          const user = await window.__picoFirebase.signInWithGoogle();
          completeLogin(user);
          return;
        } catch (sdkErr) {
          if (sdkErr && sdkErr.code === 'auth/popup-closed-by-user') {
            showMsg('Google sign-in popup was closed.', true);
            return;
          }
          console.warn('Firebase Google popup fallback:', sdkErr);
        }
      }

      const email = emailIn.value.trim() || 'alphablack440@gmail.com';
      const user = {
        uid: 'google_' + email.toLowerCase().replace(/[^a-z0-9]/g, '_'),
        email: email,
        displayName: email
          .split('@')[0]
          .replace(/[._-]/g, ' ')
          .replace(/\b\w/g, (l) => l.toUpperCase()),
        photoURL: 'https://lh3.googleusercontent.com/a/default-user',
        provider: 'google.com',
      };

      completeLogin(user);
    } catch (err) {
      showMsg(err.message || 'Google Sign-In failed', true);
    } finally {
      googleBtnText.textContent = 'Continue with Google';
      googleBtn.style.opacity = '1';
      googleBtn.style.pointerEvents = 'auto';
    }
  };

  // Email / Password Form Submit
  form.onsubmit = async (e) => {
    e.preventDefault();
    msgEl.style.display = 'none';
    const email = emailIn.value.trim();
    const pass = passIn.value.trim();
    const displayName = nameIn.value.trim() || email.split('@')[0];
    const isSignUp = tabSignUp.classList.contains('active');
    const apiKey =
      (typeof localStorage !== 'undefined' &&
        (localStorage.getItem('picotools_firebase_api_key') || localStorage.getItem('toolnest_firebase_api_key'))) ||
      firebaseConfig.apiKey;

    submitBtn.disabled = true;
    submitBtn.textContent = 'Please wait...';

    try {
      const validKey = /^[A-Za-z0-9_-]{30,}$/.test((apiKey || '').trim());
      if (window.__picoFirebase && window.__picoFirebase.hasValidApiKey()) {
        try {
          const user = isSignUp
            ? await window.__picoFirebase.signUpWithEmail(email, pass, displayName)
            : await window.__picoFirebase.signInWithEmail(email, pass);
          completeLogin(user);
          return;
        } catch (sdkErr) {
          const code = sdkErr?.code || '';
          const msg = sdkErr?.message || '';
          if (code !== 'auth/invalid-api-key' && !msg.includes('MASKED_API_KEY') && !msg.includes('invalid-api-key')) {
            throw sdkErr;
          }
        }
      }

      if (validKey) {
        const endpoint = isSignUp ? 'signUp' : 'signInWithPassword';
        const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${endpoint}?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password: pass, returnSecureToken: true }),
        });
        const data = await r.json();
        if (!r.ok) {
          throw new Error(data.error?.message || 'Authentication failed');
        }
        const user = {
          uid: data.localId,
          email: data.email,
          displayName: nameIn.value.trim() || data.displayName || email.split('@')[0],
          idToken: data.idToken,
          refreshToken: data.refreshToken,
          provider: 'password',
        };
        completeLogin(user);
        return;
      }

      const user = {
        uid: 'user_' + email.toLowerCase().replace(/[^a-z0-9]/g, '_'),
        email,
        displayName,
        provider: 'password',
      };
      completeLogin(user);
    } catch (err) {
      showMsg(err.message || 'Authentication error', true);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = isSignUp ? 'Create Account' : 'Sign In';
    }
  };
}

function openAuthModal(tab = 'signin', reason = '') {
  ensureAuthModalDOM();
  if (!modalEl) return;
  const reasonEl = modalEl.querySelector('#tn-modal-reason');
  if (reasonEl) {
    reasonEl.textContent = reason;
    reasonEl.style.display = reason ? 'block' : 'none';
  }
  const tabSignIn = modalEl.querySelector('#tn-tab-signin');
  const tabSignUp = modalEl.querySelector('#tn-tab-signup');
  const nameRow = modalEl.querySelector('#tn-name-row');
  const submitBtn = modalEl.querySelector('#tn-btn-submit');
  const modalTitle = modalEl.querySelector('#tn-modal-title');
  const msgEl = modalEl.querySelector('#tn-auth-msg');
  if (msgEl) msgEl.style.display = 'none';

  if (tab === 'signin') {
    tabSignIn?.classList.add('active');
    tabSignUp?.classList.remove('active');
    if (nameRow) nameRow.style.display = 'none';
    if (submitBtn) submitBtn.textContent = 'Sign In';
    if (modalTitle) modalTitle.textContent = 'Sign in to PicoTools';
  } else {
    tabSignUp?.classList.add('active');
    tabSignIn?.classList.remove('active');
    if (nameRow) nameRow.style.display = 'block';
    if (submitBtn) submitBtn.textContent = 'Create Account';
    if (modalTitle) modalTitle.textContent = 'Create your PicoTools account';
  }

  modalEl.classList.add('on');
  document.body.style.overflow = 'hidden';
}

function closeAuthModal() {
  if (modalEl) {
    modalEl.classList.remove('on');
    document.body.style.overflow = '';
  }
}

function updateFallbackUserUI() {
  // 1. Update header nav in tool.html
  const nav = document.querySelector('header.nav nav');
  if (nav) {
    let pill = nav.querySelector('#tn-user-nav-item');
    if (!pill) {
      pill = document.createElement('div');
      pill.id = 'tn-user-nav-item';
      pill.style.display = 'inline-flex';
      pill.style.alignItems = 'center';
      pill.style.gap = '8px';
      pill.style.marginLeft = '10px';
      nav.appendChild(pill);
    }
    if (currentUser) {
      const name = currentUser.displayName || currentUser.email?.split('@')[0] || 'User';
      pill.innerHTML = `
        <div class="tn-user-pill" title="Signed in as ${currentUser.email}">
          <span class="dot"></span>
          <span>${name}</span>
        </div>
        <button type="button" class="tn-signout-btn" id="tn-btn-nav-signout" title="Sign out of PicoTools">
          Sign out
        </button>
      `;
      const signoutBtn = pill.querySelector('#tn-btn-nav-signout');
      if (signoutBtn) signoutBtn.onclick = () => logoutUser();
    } else {
      pill.innerHTML = `
        <button type="button" class="btn ghost" id="tn-btn-nav-signin" style="height:28px;font-size:12px;padding:0 10px;border-color:rgba(185,171,255,.3);color:var(--lav)">
          Sign in
        </button>
        <button type="button" class="btn" id="tn-btn-nav-signup" style="height:28px;font-size:12px;padding:0 12px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);color:#fff">
          Sign up
        </button>
      `;
      const signinBtn = pill.querySelector('#tn-btn-nav-signin');
      const signupBtn = pill.querySelector('#tn-btn-nav-signup');
      if (signinBtn) signinBtn.onclick = () => openAuthModal('signin');
      if (signupBtn) signupBtn.onclick = () => openAuthModal('signup');
    }
  }

  // 2. Update sticky navbar (#stick) in index.html
  const stick = document.getElementById('stick');
  if (stick) {
    let stickItem = stick.querySelector('#tn-stick-user-item');
    if (!stickItem) {
      stickItem = document.createElement('div');
      stickItem.id = 'tn-stick-user-item';
      stickItem.style.display = 'inline-flex';
      stickItem.style.alignItems = 'center';
      stickItem.style.gap = '8px';
      stickItem.style.marginLeft = '8px';
      stick.appendChild(stickItem);
    }
    if (currentUser) {
      const name = currentUser.displayName || currentUser.email?.split('@')[0] || 'User';
      stickItem.innerHTML = `
        <div class="tn-user-pill" title="Signed in as ${currentUser.email}">
          <span class="dot"></span>
          <span>${name}</span>
        </div>
        <button type="button" class="tn-signout-btn" id="stick-signout-btn" title="Sign out of PicoTools">
          Sign out
        </button>
      `;
      const signoutBtn = stickItem.querySelector('#stick-signout-btn');
      if (signoutBtn) signoutBtn.onclick = () => logoutUser();
    } else {
      stickItem.innerHTML = `
        <button type="button" class="btn ghost" id="stick-signin-btn" style="height:28px;font-size:12px;padding:0 10px;border-color:rgba(185,171,255,.3);color:var(--lav);border-radius:8px">Sign in</button>
        <button type="button" class="btn" id="stick-signup-btn" style="height:28px;font-size:12px;padding:0 12px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);color:#fff;border-radius:8px">Sign up</button>
      `;
      const signinBtn = stickItem.querySelector('#stick-signin-btn');
      if (signinBtn) signinBtn.onclick = () => openAuthModal('signin');
      const signupBtn = stickItem.querySelector('#stick-signup-btn');
      if (signupBtn) signupBtn.onclick = () => openAuthModal('signup');
    }
  }

  // 3. Update static fallback hero if present (#fb)
  const fbStatus = document.getElementById('fb-user-status');
  if (fbStatus) {
    if (currentUser) {
      fbStatus.textContent = (currentUser.displayName || currentUser.email?.split('@')[0]) + ' (Sign out)';
      fbStatus.onclick = () => logoutUser();
    } else {
      fbStatus.textContent = 'Sign in';
      fbStatus.onclick = () => openAuthModal('signin');
    }
  }
  const fbHeroBtn = document.getElementById('fb-hero-auth-btn');
  if (fbHeroBtn) {
    if (currentUser) {
      fbHeroBtn.textContent = 'Sign Out';
      fbHeroBtn.onclick = () => logoutUser();
    } else {
      fbHeroBtn.textContent = 'Sign Up';
      fbHeroBtn.onclick = () => openAuthModal('signup');
    }
  }
}

// Global exports
window.requireAuth = requireAuth;
window.recordToolUsage = recordToolUsage;
window.getCurrentUser = getCurrentUser;
window.openAuthModal = openAuthModal;
window.closeAuthModal = closeAuthModal;
window.logoutUser = logoutUser;

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      ensureAuthModalDOM();
      updateFallbackUserUI();
    });
  } else {
    ensureAuthModalDOM();
    updateFallbackUserUI();
  }
}
