/* ===== comun.js — Comida Rápida ===== */
/* Adaptado del molde de Tienda Libre. Misma base Supabase compartida.
   Reutiliza las funciones de cuenta/membresía YA construidas (reclamar_tienda,
   verificar_colab, unirse_como_colab, sincronizar_clave_dueno, resetear_clave_colab)
   y el espacio de nombres interno de Auth (@tiendalibre.app), que es solo un
   "namespace" de cuentas (el código de licencia COMI- es único igual).
   Lo ÚNICO propio de esta app es la tabla de datos: comidarapida_backups. */

/* =====================================================================
   SUPABASE (CyC Admin v2 — base compartida con Tienda Libre / Dulzura)
   ===================================================================== */
const SB_URL = 'https://pcxlhgdpxfuybzfsquem.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjeGxoZ2RweGZ1eWJ6ZnNxdWVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2MDIyOTQsImV4cCI6MjA5NjE3ODI5NH0.HJWpFO8TkRsmUx15GtSsUusjvVEhUsi5b_QGoPoPU00';

/* Tabla de datos propia de esta app (1 fila por local) */
const CR_BACKUPS = 'comidarapida_backups';
/* Tabla de membresía compartida (mapea user_id -> tenant_id -> rol) */
const CR_MIEMBROS = 'tl_miembros';

/* =====================================================================
   SUPABASE AUTH (Nivel 2) — login real del lado del servidor
   ===================================================================== */
const CR_SESS_KEY = 'cr_sb_sess';
const CR_MAIL_DOM = '@tiendalibre.app';   // namespace interno compartido de Auth

function _emailDe(usuario, tenant){
  const base = ((usuario||'') + '.' + (tenant||'')).toLowerCase().replace(/[^a-z0-9.]/g, '');
  return base + CR_MAIL_DOM;
}
function _sbSessGet(){ try{ return JSON.parse(localStorage.getItem(CR_SESS_KEY)||'null'); }catch(e){ return null; } }
function _sbSessSet(s){ if(s) localStorage.setItem(CR_SESS_KEY, JSON.stringify(s)); else localStorage.removeItem(CR_SESS_KEY); }
function authLogueado(){ return !!_sbSessGet(); }
function authUserId(){ const s=_sbSessGet(); return s ? s.user_id : null; }

async function _authPost(path, body){
  const res = await fetch(SB_URL + path, {
    method:'POST',
    headers:{ apikey: SB_KEY, 'Content-Type':'application/json' },
    body: JSON.stringify(body||{})
  });
  const txt = await res.text();
  let data = null; try{ data = txt ? JSON.parse(txt) : null; }catch(e){ data = { raw: txt }; }
  return { ok: res.ok, status: res.status, data };
}
function _guardarSesion(d){
  if(!d || !d.access_token) return null;
  const sess = {
    access_token: d.access_token,
    refresh_token: d.refresh_token || '',
    user_id: (d.user && d.user.id) || d.user_id || null,
    expira: Date.now() + ((d.expires_in||3600)*1000) - 60000   // 1 min de margen
  };
  _sbSessSet(sess);
  return sess;
}
async function authSignUp(email, password){
  const r = await _authPost('/auth/v1/signup', { email, password });
  if (r.ok && r.data && r.data.access_token) return _guardarSesion(r.data);
  return null;
}
async function authSignIn(email, password){
  const r = await _authPost('/auth/v1/token?grant_type=password', { email, password });
  if (r.ok && r.data && r.data.access_token) return _guardarSesion(r.data);
  return null;
}
async function _authRefresh(){
  const s = _sbSessGet(); if(!s || !s.refresh_token) return null;
  const r = await _authPost('/auth/v1/token?grant_type=refresh_token', { refresh_token: s.refresh_token });
  if (r.ok && r.data && r.data.access_token) return _guardarSesion(r.data);
  return null;
}
async function authToken(){
  const s = _sbSessGet(); if(!s) return null;
  if (Date.now() < (s.expira||0)) return s.access_token;
  const ns = await _authRefresh();
  return ns ? ns.access_token : null;
}
function authSignOut(){ _sbSessSet(null); }

async function sbRPC(fn, body){
  const tok = await authToken();
  const res = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method:'POST',
    headers:{ apikey: SB_KEY, Authorization:'Bearer '+(tok||SB_KEY), 'Content-Type':'application/json' },
    body: JSON.stringify(body||{})
  });
  const txt = await res.text();
  if(!res.ok) throw new Error(txt || ('rpc '+fn+' '+res.status));
  try{ return txt ? JSON.parse(txt) : null; }catch(e){ return txt; }
}

/* Crea/entra a la cuenta segura del DUEÑO y la vincula al local */
async function asegurarCuentaSeguraDueno(usuario, password, codigo){
  if(!usuario || !password || !codigo) return { ok:false, msg:'Faltan datos' };
  const email = _emailDe(usuario, codigo);
  let sess = await authSignIn(email, password);
  if (!sess){ await authSignUp(email, password); sess = await authSignIn(email, password); }
  if (!sess) return { ok:false, msg:'No se pudo crear la cuenta segura (la contraseña debe tener 6+ caracteres).' };
  try { await sbRPC('reclamar_tienda', { p_codigo: codigo, p_usuario: usuario }); }
  catch(e){ return { ok:false, msg:'Cuenta creada, pero no se pudo vincular: ' + (e.message||e) }; }
  return { ok:true, email };
}

/* Verifica la contraseña actual del dueño contra lo guardado (hash o base64) */
async function verificarClaveDueno(pass){
  const u = localStorage.getItem('admin_user');
  const stored = localStorage.getItem('admin_pass');
  if(!stored) return false;
  if(_esHash(stored)){ const h = await crHash(pass, 'owner:'+(u||'')); return h!==null && h===stored; }
  let p=''; try{ p=atob(stored); }catch(e){ p=''; }
  return pass===p;
}

/* Cambia la contraseña del dueño en Supabase Y en este dispositivo */
async function cambiarClaveDueno(actual, nueva){
  const u = localStorage.getItem('admin_user') || '';
  const codigo = _crCodigo();
  if(!(await verificarClaveDueno(actual))) return { ok:false, msg:'La contraseña actual no es correcta.' };
  let tok = await authToken();
  if(!tok){ await asegurarCuentaSeguraDueno(u, actual, codigo); tok = await authToken(); }
  if(!tok) return { ok:false, msg:'No se pudo acceder a tu cuenta segura. Iniciá sesión y reintentá.' };
  const res = await fetch(`${SB_URL}/auth/v1/user`, {
    method:'PUT',
    headers:{ apikey:SB_KEY, Authorization:'Bearer '+tok, 'Content-Type':'application/json' },
    body: JSON.stringify({ password: nueva })
  });
  if(!res.ok){ const t=await res.text(); return { ok:false, msg:'El servidor rechazó el cambio: '+t.slice(0,120) }; }
  await authSignIn(_emailDe(u, codigo), nueva);
  const h = await crHash(nueva, 'owner:'+u);
  if(h) localStorage.setItem('admin_pass', h);
  return { ok:true };
}

/* Crea/entra a la cuenta segura del AYUDANTE y lo une al local */
async function asegurarCuentaSeguraColab(usuario, password, codigo){
  if(!usuario || !password || !codigo) return { ok:false, msg:'Faltan datos' };
  const email = _emailDe(usuario, codigo);
  let sess = await authSignIn(email, password);
  if (!sess){
    let ok = false;
    try { ok = await sbRPC('verificar_colab', { p_codigo: codigo, p_usuario: usuario, p_pass: password }); }
    catch(e){ ok = false; }
    if (!ok) return { ok:false, msg:'Usuario o contraseña incorrectos.' };
    await authSignUp(email, password);
    sess = await authSignIn(email, password);
  }
  if (!sess) return { ok:false, msg:'No se pudo crear la cuenta del ayudante (la clave debe tener 6+).' };
  try { await sbRPC('unirse_como_colab', { p_codigo: codigo, p_usuario: usuario, p_pass: password }); }
  catch(e){ return { ok:false, msg:'Cuenta creada, pero no se pudo unir: ' + (e.message||e) }; }
  return { ok:true };
}

/* Lee la membresía (rol/local) del usuario logueado en Supabase */
async function miMembresia(){
  const tok = await authToken(); if(!tok) return null;
  const uid = authUserId(); if(!uid) return null;
  try{
    const r = await fetch(`${SB_URL}/rest/v1/${CR_MIEMBROS}?select=tenant_id,rol,usuario&user_id=eq.${uid}`,
      { cache:'no-store', headers:{ apikey:SB_KEY, Authorization:'Bearer '+tok } });
    const rows = r.ok ? await r.json() : [];
    return (rows && rows.length) ? rows[0] : null;
  }catch(e){ return null; }
}

/* =====================================================================
   SYNC MULTI-INQUILINO — 1 fila por local. Tabla: comidarapida_backups
   ===================================================================== */
const CR_SYNC_KEYS = [
  'productos', 'promos', 'colaboradores',
  'nombre_local', 'tagline', 'logo', 'direccion', 'telefono',
  /* Página pública (editable desde el panel) */
  'horarios', 'testimonios', 'historia', 'espacio', 'carta', 'img_forma'
];

let _crPush = false;
let _crTimer = null;
let _crPushPendiente = false;   // hay cambios locales esperando subir
const _origSetItem = localStorage.setItem.bind(localStorage);

function _crCodigo() {
  try {
    const raw = localStorage.getItem('cr_licencia');
    if (!raw) return null;
    let c = null;
    try {
      const lic = JSON.parse(raw);
      c = (lic && lic.codigo) ? lic.codigo : (typeof lic === 'string' ? lic : null);
    } catch (e) { c = raw; }
    if (!c || c === 'TRIAL-15') return null;
    return c;
  } catch (e) { return null; }
}

function crHabilitarSync() { _crPush = true; }

function _crDebounce() {
  _crPushPendiente = true;
  if (_crTimer) clearTimeout(_crTimer);
  _crTimer = setTimeout(crNubeGuardar, 800);
}

async function crNubeGuardar() {
  if (!_crPush) return;
  const codigo = _crCodigo();
  if (!codigo) { _crPushPendiente = false; return; }

  async function _subir(bearer) {
    let datos = {};
    try {
      const r = await fetch(
        `${SB_URL}/rest/v1/${CR_BACKUPS}?tenant_id=eq.${encodeURIComponent(codigo)}&select=datos&limit=1`,
        { cache: 'no-store', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + bearer } }
      );
      if (r.ok) { const rows = await r.json(); if (rows && rows.length && rows[0].datos) datos = rows[0].datos; }
    } catch (e) {}
    CR_SYNC_KEYS.forEach(k => {
      const v = localStorage.getItem(k);
      if (v !== null) datos[k] = v;
    });
    return fetch(`${SB_URL}/rest/v1/${CR_BACKUPS}`, {
      method: 'POST',
      headers: {
        apikey: SB_KEY, Authorization: 'Bearer ' + bearer,
        'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates'
      },
      body: JSON.stringify({ tenant_id: codigo, datos, updated_at: new Date().toISOString() })
    });
  }

  try {
    const tok = await authToken();
    let resp = await _subir(tok || SB_KEY);
    if (!resp.ok && (resp.status === 401 || resp.status === 403)) {
      const ns = await _authRefresh();
      if (ns && ns.access_token) resp = await _subir(ns.access_token);
    }
    if (!resp.ok) {
      console.warn('[CR] La nube rechazó el guardado:', resp.status);
      if (typeof toast === 'function') {
        const ahora = Date.now();
        if (!window._crLastSyncWarn || (ahora - window._crLastSyncWarn) > 8000) {
          window._crLastSyncWarn = ahora;
          toast('⚠️ No se pudo publicar tu local. Cerrá sesión y volvé a entrar para que se publiquen los cambios.');
        }
      }
    }
  } catch (e) { console.warn('[CR] No se pudo subir a la nube:', e); }
  finally { _crPushPendiente = false; }
}

async function crNubeCargar() {
  const codigo = _crCodigo();
  if (!codigo) return { hydrated: false, changed: false };
  const bearer = (await authToken()) || SB_KEY;
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/${CR_BACKUPS}?tenant_id=eq.${encodeURIComponent(codigo)}&select=datos&limit=1`,
      { cache: 'no-store', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + bearer } }
    );
    let rows = [];
    if (res.ok) rows = await res.json();
    if (rows && rows.length && rows[0].datos) {
      const datos = rows[0].datos;
      let changed = false;
      Object.keys(datos).forEach(k => {
        if (CR_SYNC_KEYS.includes(k)) {
          if (localStorage.getItem(k) !== datos[k]) changed = true;
          _origSetItem(k, datos[k]);
        }
      });
      return { hydrated: true, changed, nuevo: false };
    }
    _crPush = true;
    return { hydrated: true, changed: false, nuevo: true };
  } catch (e) {
    console.warn('[CR] No se pudo bajar de la nube:', e);
    return { hydrated: false, changed: false };
  }
}

// Interceptar setItem para sincronizar automáticamente
localStorage.setItem = function (k, v) {
  _origSetItem(k, v);
  if (_crPush && CR_SYNC_KEYS.includes(k)) _crDebounce();
};

/* =====================================================================
   HELPERS
   ===================================================================== */
function getProductos() {
  try { return JSON.parse(localStorage.getItem('productos') || '[]'); }
  catch (e) { return []; }
}
function setProductos(arr) { localStorage.setItem('productos', JSON.stringify(arr)); }

function cfg(k, def) {
  const v = localStorage.getItem(k);
  return (v !== null && v !== undefined) ? v : (def || '');
}
function setCfg(k, v) { localStorage.setItem(k, v); }

function uid() { return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function formatPrecio(n) { return '$' + Number(n || 0).toLocaleString('es-AR'); }
function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g,
    m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

/* =====================================================================
   AUTH (admin) — solo credenciales que generó el panel cyc-admin-v2
   ===================================================================== */
function isAdminLogged() { return sessionStorage.getItem('cr_logged') === 'true'; }

/* ===== Hash de contraseñas (SHA-256, con "sal" por usuario/local) ===== */
async function crHash(plain, salt) {
  try {
    const data = new TextEncoder().encode((salt || '') + '|' + (plain == null ? '' : plain));
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (e) { return null; }
}
function _esHash(s) { return typeof s === 'string' && /^[0-9a-f]{64}$/.test(s); }

async function loginAdmin(user, pass) {
  const u = localStorage.getItem('admin_user');
  const stored = localStorage.getItem('admin_pass');
  if (!u || !stored) return false;
  if (String(user).trim() !== u) return false;
  let ok = false;
  if (_esHash(stored)) {
    const h = await crHash(pass, 'owner:' + u);
    ok = (h !== null && h === stored);
  } else {
    let p = ''; try { p = atob(stored); } catch (e) { p = ''; }
    ok = (pass === p);
    if (ok) { const h = await crHash(pass, 'owner:' + u); if (h) localStorage.setItem('admin_pass', h); }
  }
  if (ok) { sessionStorage.setItem('cr_logged', 'true'); return true; }
  return false;
}
function logoutAdmin() {
  sessionStorage.removeItem('cr_logged');
  try { authSignOut(); } catch(e){}
  location.reload();
}

/* Link público del local (lleva el código) */
function getLinkTienda() {
  const base = location.origin + location.pathname.replace(/[^/]*$/, '');
  const codigo = _crCodigo() || '';
  return codigo ? (base + '?local=' + encodeURIComponent(codigo)) : base;
}
