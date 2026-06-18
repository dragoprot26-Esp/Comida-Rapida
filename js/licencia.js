/* ===== licencia.js — Comida Rápida ===== */
/* Activación por código vía validar_licencia (función compartida del lado servidor).
   Las licencias COMI- las genera el panel cyc-admin-v2. */

const CLAVE_LICENCIA = 'cr_licencia';
const PROVEEDOR_MAIL = 'dragoprot26@gmail.com';
// SB_URL y SB_KEY vienen de comun.js

async function sbGetLicencia(codigo) {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/rpc/validar_licencia`, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_codigo: codigo })
    });
    const data = res.ok ? await res.json() : null;
    return (data && typeof data === 'object' && data.codigo) ? data : null;
  } catch (e) { return null; }
}

function obtenerLicencia() {
  try { return JSON.parse(localStorage.getItem(CLAVE_LICENCIA) || 'null'); }
  catch (e) { return null; }
}
function guardarLicencia(obj) { localStorage.setItem(CLAVE_LICENCIA, JSON.stringify(obj)); }

function verificarLicencia() {
  const lic = obtenerLicencia();
  if (!lic) return false;
  if (lic.expira && Date.now() > lic.expira) { lic.valida = false; guardarLicencia(lic); return false; }
  return !!lic.valida;
}

function diasRestantes() {
  const lic = obtenerLicencia();
  if (!lic || !lic.expira) return null;
  return Math.ceil((lic.expira - Date.now()) / 86400000);
}

async function activarLicencia(codigo) {
  codigo = String(codigo || '').trim().toUpperCase();
  if (!codigo || codigo.length < 5) { return false; }

  const remote = await sbGetLicencia(codigo);
  if (!remote) return false;

  // La activación la hace validar_licencia() del lado del servidor.

  const expira = remote.fecha_vencimiento
    ? new Date(remote.fecha_vencimiento).getTime()
    : Date.now() + (remote.dias || 30) * 86400000;

  guardarLicencia({
    valida: true,
    expira,
    dias: remote.dias || 30,
    codigo,
    plan: remote.plan || 'premium',
    negocio: remote.nombre_negocio || '',
    usuario: remote.usuario_admin || ''
  });

  // Las credenciales del panel pasan a ser el login del admin
  if (remote.usuario_admin) localStorage.setItem('admin_user', remote.usuario_admin);
  if (remote.pass_admin) {
    const _salt = 'owner:' + (remote.usuario_admin || '');
    const _h = (typeof crHash === 'function') ? await crHash(remote.pass_admin, _salt) : null;
    localStorage.setItem('admin_pass', _h || btoa(remote.pass_admin));
  }

  // Reactivar = volver al estado de la licencia: limpiamos la sesión vieja
  // y sincronizamos la clave de la cuenta segura con la de la licencia.
  try { if (typeof authSignOut === 'function') authSignOut(); } catch (e) {}
  try {
    if (remote.usuario_admin && remote.pass_admin && typeof sbRPC === 'function') {
      await sbRPC('sincronizar_clave_dueno', {
        p_codigo: codigo, p_usuario: remote.usuario_admin, p_pass: remote.pass_admin
      });
    }
  } catch (e) { console.warn('sincronizar clave:', e); }

  // Traer datos de ESTE local desde la nube
  try {
    sessionStorage.removeItem('cr_hidratado');
    const r = await crNubeCargar();
    if (r && r.nuevo) {
      // Local nuevo: arranca LIMPIO (que no quede NADA del local anterior en este navegador)
      _origSetItem('productos', '[]');
      _origSetItem('promos', '[]');
      _origSetItem('colaboradores', '[]');
      _origSetItem('logo', '🍔');
      _origSetItem('tagline', 'Sabor que enamora · Encargá y retirá');
      _origSetItem('direccion', '');
      _origSetItem('telefono', '');
      _origSetItem('nombre_local', remote.nombre_negocio || 'Comida Rápida');
      if (remote.correo_cliente) _origSetItem('admin_email', remote.correo_cliente);
      await crNubeGuardar();
    }
    sessionStorage.setItem('cr_hidratado', '1');
    crHabilitarSync();
    sessionStorage.setItem('cr_bienvenida', remote.cliente_nombre || remote.nombre_negocio || '1');
  } catch (e) { console.warn('hidratación nube:', e); }

  return true;
}
