import { GoogleAuthProvider, onIdTokenChanged, signInWithPopup, signOut } from 'firebase/auth';
import { auth } from '../lib/firebase-client';
import { api, toast } from '../lib/client';
import { ensureGoogleSession } from '../lib/google-session';

let loggingIn = false;
const loginButtons = document.querySelectorAll<HTMLButtonElement>('.google-login');
function updateLoginButtons() {
  loginButtons.forEach(button => {
    button.disabled = loggingIn;
    button.setAttribute('aria-busy', String(loggingIn));
    const label = button.querySelector<HTMLElement>('[data-google-label]');
    if (label) label.textContent = loggingIn ? 'Entrando…' : auth.currentUser ? 'Ir a mi perfil' : label.dataset.anonymousLabel || 'Continuar con Google';
  });
}
async function syncSession() {
  const user = auth.currentUser;
  if (!user) throw new Error('Inicia sesión con Google para continuar.');
  const idToken = await user.getIdToken();
  await api('/api/auth/session', { idToken });
}
onIdTokenChanged(auth, async user => {
  updateLoginButtons();
  if (!user || loggingIn) return;
  try { await syncSession(); }
  catch { if (location.pathname === '/perfil') toast('Tu sesión necesita renovarse. Vuelve a iniciar sesión.', true); }
});

loginButtons.forEach(button => button.addEventListener('click', async () => {
  if (loggingIn) return;
  loggingIn = true;
  updateLoginButtons();
  try {
    await ensureGoogleSession(auth, () => {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      return signInWithPopup(auth, provider);
    }, syncSession);
    location.assign('/perfil');
  } catch (error) {
    const code = (error as { code?: string }).code;
    const messages: Record<string, string> = {
      'auth/unauthorized-domain': 'Este dominio aún no está autorizado en Firebase Authentication.',
      'auth/operation-not-allowed': 'Activa el proveedor Google en Firebase Authentication.',
      'auth/popup-blocked': 'Permite las ventanas emergentes para iniciar sesión.',
      'auth/popup-closed-by-user': 'Se cerró el inicio de sesión. Puedes intentarlo de nuevo.',
      'auth/network-request-failed': 'Revisa tu conexión e intenta otra vez.',
    };
    toast(messages[code || ''] || (error as Error).message || 'No se pudo iniciar sesión.', true);
  } finally { loggingIn = false; updateLoginButtons(); }
}));

document.getElementById('logout')?.addEventListener('click', async () => {
  try { await api('/api/auth/session', undefined, 'DELETE'); await signOut(auth); location.assign('/'); }
  catch { toast('No se pudo cerrar la sesión. Intenta otra vez.', true); }
});
if (new URLSearchParams(location.search).get('sesion') === 'requerida') toast('Inicia sesión con Google para acceder a tu perfil.');
