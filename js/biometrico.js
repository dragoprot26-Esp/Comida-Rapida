/* biometrico.js — Ingreso con huella / Face ID (WebAuthn) para este dispositivo.
   Guarda las credenciales en este equipo, protegidas por la verificación
   biométrica del sistema. Sirve para Dueño y Colaborador. Requiere HTTPS. */
(function () {
  const KEY = 'cr_bio';

  function toB64(buf) { return btoa(String.fromCharCode.apply(null, new Uint8Array(buf))); }
  function fromB64(s) { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }

  async function bioSupported() {
    try {
      if (typeof window === 'undefined' || !window.PublicKeyCredential) return false;
      return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch (e) { return false; }
  }

  function bioEnabled() { return !!localStorage.getItem(KEY); }
  function bioDisable() { localStorage.removeItem(KEY); }

  // creds = { codigo, usuario, password, rol }
  async function bioEnable(creds) {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const userId = crypto.getRandomValues(new Uint8Array(16));
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: 'Comida Rápida' },
        user: { id: userId, name: creds.usuario || 'usuario', displayName: creds.usuario || 'Usuario' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
        timeout: 60000,
      },
    });
    if (!cred) throw new Error('No se pudo registrar la huella');
    localStorage.setItem(KEY, JSON.stringify({
      credId: toB64(cred.rawId),
      creds: Object.assign({}, creds, { password: btoa(creds.password || '') }),
    }));
    return true;
  }

  async function bioLogin() {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{ type: 'public-key', id: fromB64(data.credId) }],
        userVerification: 'required',
        timeout: 60000,
      },
    });
    if (!assertion) return null;
    return Object.assign({}, data.creds, { password: atob(data.creds.password || '') });
  }

  window.Bio = { bioSupported, bioEnabled, bioDisable, bioEnable, bioLogin };
})();
