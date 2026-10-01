import type { Auth } from 'firebase/auth';

export async function ensureGoogleSession(
  auth: Pick<Auth, 'authStateReady' | 'currentUser'>,
  signIn: () => Promise<unknown>,
  syncSession: () => Promise<void>,
) {
  // A persisted user may still be loading when the landing button is clicked.
  await auth.authStateReady();
  if (!auth.currentUser) await signIn();
  await syncSession();
}
