import { initializeApp, getApps, deleteApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  type Auth,
} from 'firebase/auth';
import { getDatabase, ref, set, push, update } from 'firebase/database';
import { getAnalytics, isSupported as isAnalyticsSupported } from 'firebase/analytics';

const DEFAULT_CONFIG = {
  apiKey: 'AIzaSyAQ•••••••••••••••••••••••••••••••',
  authDomain: 'tools-website-claude.firebaseapp.com',
  databaseURL: 'https://tools-website-claude-default-rtdb.firebaseio.com',
  projectId: 'tools-website-claude',
  storageBucket: 'tools-website-claude.firebasestorage.app',
  messagingSenderId: '86852391717',
  appId: '1:86852391717:web:a46c1ae989fa07556f40cc',
  measurementId: 'G-5EZHE7CK7K',
};

function getStoredApiKey(): string {
  try {
    return (
      localStorage.getItem('picotools_firebase_api_key') ||
      localStorage.getItem('toolnest_firebase_api_key') ||
      import.meta.env.VITE_FIREBASE_API_KEY ||
      DEFAULT_CONFIG.apiKey
    );
  } catch {
    return DEFAULT_CONFIG.apiKey;
  }
}

function isValidKey(key: string): boolean {
  return /^[A-Za-z0-9_-]{30,}$/.test((key || '').trim());
}

let app: FirebaseApp | null = null;
let auth: Auth | null = null;

async function initFirebase(apiKeyOverride?: string) {
  const apiKey = apiKeyOverride || getStoredApiKey();
  const config = { ...DEFAULT_CONFIG, apiKey };

  if (getApps().length > 0) {
    for (const existing of getApps()) {
      await deleteApp(existing).catch(() => {});
    }
  }

  app = initializeApp(config);
  auth = null;

  if (!isValidKey(apiKey)) {
    return;
  }

  try {
    auth = getAuth(app);
  } catch {
    auth = null;
    return;
  }

  // Initialize Analytics if supported and key is valid
  isAnalyticsSupported()
    .then((ok) => {
      if (ok && app) {
        try {
          getAnalytics(app);
        } catch {
          // Analytics optional in sandboxed iframes
        }
      }
    })
    .catch(() => {});

  onAuthStateChanged(auth, async (fbUser) => {
    if (!fbUser) return;
    try {
      const idToken = await fbUser.getIdToken();
      const userObj = {
        uid: fbUser.uid,
        email: fbUser.email || '',
        displayName: fbUser.displayName || (fbUser.email ? fbUser.email.split('@')[0] : 'User'),
        photoURL: fbUser.photoURL || '',
        idToken,
        provider: fbUser.providerData?.[0]?.providerId || 'firebase',
      };
      if (typeof (window as unknown as Record<string, unknown>).__syncFirebaseUser === 'function') {
        ((window as unknown as Record<string, unknown>).__syncFirebaseUser as (u: typeof userObj) => void)(userObj);
      }
    } catch {
      // Ignore token refresh errors
    }
  });
}

initFirebase().catch(() => {});

const bridge = {
  hasValidApiKey: () => isValidKey(getStoredApiKey()),

  async reinitWithApiKey(newKey: string) {
    try {
      localStorage.setItem('picotools_firebase_api_key', newKey.trim());
    } catch {
      // ignore
    }
    await initFirebase(newKey.trim());
  },

  async signInWithGoogle() {
    const apiKey = getStoredApiKey();
    if (!isValidKey(apiKey)) {
      throw new Error('MASKED_API_KEY');
    }
    if (!auth) await initFirebase(apiKey);
    if (!auth) throw new Error('Firebase Auth not initialized');

    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const result = await signInWithPopup(auth, provider);
    const u = result.user;
    const idToken = await u.getIdToken();
    return {
      uid: u.uid,
      email: u.email || 'google.user@picotools.app',
      displayName: u.displayName || (u.email ? u.email.split('@')[0] : 'Google User'),
      photoURL: u.photoURL || '',
      idToken,
      provider: 'google.com',
    };
  },

  async signInWithEmail(email: string, password: string) {
    const apiKey = getStoredApiKey();
    if (!isValidKey(apiKey)) {
      throw new Error('MASKED_API_KEY');
    }
    if (!auth) await initFirebase(apiKey);
    if (!auth) throw new Error('Firebase Auth not initialized');

    const result = await signInWithEmailAndPassword(auth, email, password);
    const u = result.user;
    const idToken = await u.getIdToken();
    return {
      uid: u.uid,
      email: u.email || email,
      displayName: u.displayName || email.split('@')[0],
      photoURL: u.photoURL || '',
      idToken,
      provider: 'password',
    };
  },

  async signUpWithEmail(email: string, password: string, displayName?: string) {
    const apiKey = getStoredApiKey();
    if (!isValidKey(apiKey)) {
      throw new Error('MASKED_API_KEY');
    }
    if (!auth) await initFirebase(apiKey);
    if (!auth) throw new Error('Firebase Auth not initialized');

    const result = await createUserWithEmailAndPassword(auth, email, password);
    const u = result.user;
    if (displayName) {
      await updateProfile(u, { displayName }).catch(() => {});
    }
    const idToken = await u.getIdToken();
    return {
      uid: u.uid,
      email: u.email || email,
      displayName: displayName || u.displayName || email.split('@')[0],
      photoURL: u.photoURL || '',
      idToken,
      provider: 'password',
    };
  },

  async signOut() {
    if (auth) {
      await firebaseSignOut(auth).catch(() => {});
    }
  },

  async saveUserProfile(uid: string, profile: Record<string, unknown>) {
    if (!app || !auth?.currentUser || auth.currentUser.uid !== uid) return;
    const db = getDatabase(app);
    await set(ref(db, `users/${uid}/profile`), profile);
  },

  async logToolUsage(uid: string, record: Record<string, unknown>) {
    if (!app || !auth?.currentUser || auth.currentUser.uid !== uid) return;
    const db = getDatabase(app);
    await push(ref(db, `users/${uid}/tools_used`), record);
    await update(ref(db, `users/${uid}/profile`), {
      lastUsedTool: record.toolSlug,
      lastUsedAt: Date.now(),
    });
  },
};

(window as unknown as Record<string, unknown>).__picoFirebase = bridge;
export default bridge;
