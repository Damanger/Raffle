import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';

export const firebaseConfig = {
  apiKey: import.meta.env.PUBLIC_FIREBASE_API_KEY,
  authDomain: import.meta.env.PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.PUBLIC_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.PUBLIC_FIREBASE_APP_ID,
  measurementId: import.meta.env.PUBLIC_FIREBASE_MEASUREMENT_ID,
};
export const app = getApps()[0] || initializeApp(firebaseConfig);
export const auth = getAuth(app);

if (import.meta.env.PUBLIC_ENABLE_ANALYTICS === 'true') {
  import('firebase/analytics').then(async ({ isSupported, getAnalytics }) => {
    if (await isSupported()) getAnalytics(app);
  }).catch(() => { /* Analytics never blocks the main flow. */ });
}
