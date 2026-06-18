/* ===== admin.js — Comida Rápida ===== */
/* Panel del local. Login real (cuenta segura Supabase) + activación por licencia.
   Gestiona productos, promos, pedidos y ajustes (logo / nombre / contacto). */

const $ = id => document.getElementById(id);
const fmtMoney = n => '$' + (Number(n) || 0).toFixed(2);

let editId = null;        // producto en edición
let imagenProd = '';      // imagen del producto (base64 o URL)
let logoImg = '';         // base64 del logo (si se sube)

/* ---------- toast ---------- */
let toastT = null;
function toast(msg){ const t=$('toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove('show'),2600); }

/* ---------- comprimir imagen ---------- */
function comprimirImagen(file, max, cb){
  const r = new FileReader();
  r.onload = e => {
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      const s = Math.min(1, max / Math.max(w, h));
      w = Math.round(w*s); h = Math.round(h*s);
      const c = document.createElement('canvas'); c.width=w; c.height=h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      cb(c.toDataURL('image/jpeg', 0.72));
    };
    img.src = e.target.result;
  };
  r.readAsDataURL(file);
}
function esImg(s){ return typeof s==='string' && s.indexOf('data:')===0; }
function tieneImg(s){ return typeof s==='string' && s.length > 0; }   // base64 o URL

/* ---------- rol / usuario actual ---------- */
function rolActual(){ return sessionStorage.getItem('cr_rol') || 'dueno'; }
function esDueno(){ return rolActual() !== 'colab'; }
function nombreUsuario(){ return sessionStorage.getItem('cr_user') || 'Dueño'; }

/* ===================== VISTAS ===================== */
function mostrarLogin(){ $('vistaLogin').style.display='grid'; $('vistaPanel').style.display='none'; }

async function mostrarPanel(){
  $('vistaLogin').style.display='none';
  $('vistaPanel').style.display='block';
  try { await crNubeCargar(); } catch(e){}
  sessionStorage.setItem('cr_hidratado','1');
  crHabilitarSync();
  pintarBarra();
  pintarConfig();
  pintarProductos();
  pintarPromosPanel();
  pintarCuentaSegura();
  iniciarVentas();
  const b = sessionStorage.getItem('cr_bienvenida');
  if (b) { sessionStorage.removeItem('cr_bienvenida'); setTimeout(()=>toast('🎉 ¡Bienvenido/a! Cargá tus productos y promos.'), 400); }
}

function pintarBarra(){
  const logo = cfg('logo','🍔');
  $('barLogo').innerHTML = esImg(logo) ? `<img src="${logo}">` : escHtml(logo||'🍔');
  $('barNombre').textContent = cfg('nombre_local','Comida Rápida');
  let u=''; try { u=(obtenerLicencia()||{}).usuario||''; } catch(e){}
  $('barUser').textContent = u ? ('@'+u) : '';
  const d = diasRestantes();
  const chip = $('barLic');
  if (d===null){ chip.textContent='—'; chip.className='chip v'; }
  else { chip.textContent = d+(d===1?' día':' días'); chip.className='chip '+(d>15?'v':d>5?'a':'r'); }
}

/* ===================== TOPE DE IMÁGENES (base64) ===================== */
const TOPE_IMAGENES = 40;
function _imgsEnArray(arr){ let n=0; (arr||[]).forEach(x=>{ if(esImg(x.image)) n++; }); return n; }
function _topeImagenesOk(prodsArr, promosArr){
  const total = _imgsEnArray(prodsArr) + _imgsEnArray(promosArr);
  if (total > TOPE_IMAGENES){
    toast('⚠️ Llegaste al tope de '+TOPE_IMAGENES+' fotos subidas (productos + promos). Borrá alguna o usá una URL.');
    return false;
  }
  return true;
}

/* ===================== PRODUCTOS ===================== */
function pintarProductos(){
  const prods = getProductos();
  const cont = $('listaProd');
  if (!prods.length){
    cont.innerHTML = `<div class="empty"><span class="e">🍔</span>Todavía no cargaste productos.<br>Tocá "+ Agregar producto".</div>`;
    return;
  }
  cont.innerHTML = prods.map(p=>`
    <div class="prod-row">
      <div class="th">${tieneImg(p.image)?`<img src="${escHtml(p.image)}">`:'🍔'}</div>
      <div class="pi">
        <div class="n">${escHtml(p.name)}</div>
        <div class="m">${escHtml(p.desc||'')}</div>
        <div class="pr">${fmtMoney(p.price)}</div>
      </div>
      <div class="prod-actions">
        <button class="btn btn-ghost btn-sm" data-edit="${p.id}">✏️</button>
        <button class="btn btn-bad btn-sm" data-del="${p.id}">🗑️</button>
      </div>
    </div>`).join('');
}

function abrirProd(id){
  editId = id || null;
  const p = id ? getProductos().find(x=>x.id===id) : null;
  $('prodModalTit').textContent = p ? 'Editar producto' : 'Nuevo producto';
  $('prodNombre').value = p ? (p.name||'') : '';
  $('prodDesc').value   = p ? (p.desc||'') : '';
  $('prodPrecio').value = p ? (p.price||'') : '';
  imagenProd = p ? (p.image||'') : '';
  $('prodUrl').value = (imagenProd && !esImg(imagenProd)) ? imagenProd : '';
  $('prodPrev').innerHTML = tieneImg(imagenProd) ? `<img src="${escHtml(imagenProd)}">` : '🍔';
  $('prodFile').value = '';
  abrir('ovProd');
}

async function guardarProd(){
  const name = $('prodNombre').value.trim();
  if (!name) { toast('⚠️ Poné un nombre'); return; }
  // si no se subió foto, tomar la URL escrita
  if (!esImg(imagenProd)) imagenProd = $('prodUrl').value.trim();
  const prod = {
    id: editId || uid(),
    name,
    desc: $('prodDesc').value.trim(),
    price: parseFloat($('prodPrecio').value) || 0,
    image: imagenProd || ''
  };
  try { await crNubeCargar(); } catch(e){}
  let prods = getProductos();
  if (editId) prods = prods.map(p=>p.id===editId?prod:p);
  else prods.unshift(prod);
  if (!_topeImagenesOk(prods, getPromos())) return;
  setProductos(prods);
  cerrarTodo();
  pintarProductos();
  toast(editId ? '✅ Producto actualizado' : '✅ Producto agregado');
}

async function eliminarProd(id){
  if (!confirm('¿Eliminar este producto?')) return;
  try { await crNubeCargar(); } catch(e){}
  setProductos(getProductos().filter(p=>p.id!==id));
  pintarProductos();
  toast('Producto eliminado');
}

/* ===================== PROMOS ===================== */
let promoEdit = null;
let promoImg = '';
function getPromos(){ try{ return JSON.parse(localStorage.getItem('promos')||'[]'); }catch(e){ return []; } }
function setPromos(arr){ localStorage.setItem('promos', JSON.stringify(arr)); }

function pintarPromosPanel(){
  const proms = getPromos();
  const cont = $('listaPromos');
  if(!proms.length){ cont.innerHTML = `<div class="empty"><span class="e">🔥</span>Todavía no creaste promos.<br>Tocá "+ Agregar promoción".</div>`; return; }
  cont.innerHTML = proms.map(p=>`
    <div class="prod-row">
      <div class="th">${tieneImg(p.image)?`<img src="${escHtml(p.image)}">`:'🔥'}</div>
      <div class="pi">
        <div class="n">${escHtml(p.name)}${p.badge?`<span class="badge-tag">${escHtml(p.badge)}</span>`:''}</div>
        <div class="m">${escHtml(p.desc||'')}</div>
        <div class="pr">${fmtMoney(p.price)}</div>
      </div>
      <div class="prod-actions">
        <button class="btn btn-ghost btn-sm" data-editpromo="${p.id}">✏️</button>
        <button class="btn btn-bad btn-sm" data-delpromo="${p.id}">🗑️</button>
      </div>
    </div>`).join('');
}

function abrirPromo(id){
  promoEdit = id || null;
  const p = id ? getPromos().find(x=>x.id===id) : null;
  $('promoModalTit').textContent = p ? 'Editar promoción' : 'Nueva promoción';
  $('promoNombre').value = p ? (p.name||'') : '';
  $('promoDesc').value   = p ? (p.desc||'') : '';
  $('promoPrecio').value = p ? (p.price||'') : '';
  $('promoBadge').value  = p ? (p.badge||'') : '';
  promoImg = p ? (p.image||'') : '';
  $('promoUrl').value = (promoImg && !esImg(promoImg)) ? promoImg : '';
  $('promoPrev').innerHTML = tieneImg(promoImg) ? `<img src="${escHtml(promoImg)}">` : '🔥';
  $('promoFile').value = '';
  abrir('ovPromo');
}

async function guardarPromo(){
  const name = $('promoNombre').value.trim();
  if(!name){ toast('⚠️ Poné un nombre'); return; }
  if (!esImg(promoImg)) promoImg = $('promoUrl').value.trim();
  const promo = {
    id: promoEdit || ('pr'+Date.now().toString(36)),
    name,
    desc: $('promoDesc').value.trim(),
    price: parseFloat($('promoPrecio').value) || 0,
    badge: $('promoBadge').value.trim(),
    image: promoImg || ''
  };
  try { await crNubeCargar(); } catch(e){}
  let proms = getPromos();
  if(promoEdit) proms = proms.map(p=>p.id===promoEdit?promo:p);
  else proms.unshift(promo);
  if (!_topeImagenesOk(getProductos(), proms)) return;
  setPromos(proms);
  cerrarTodo(); pintarPromosPanel();
  toast(promoEdit?'✅ Promo actualizada':'✅ Promo agregada');
}

async function eliminarPromo(id){
  if(!confirm('¿Eliminar esta promo?')) return;
  try { await crNubeCargar(); } catch(e){}
  setPromos(getPromos().filter(p=>p.id!==id));
  pintarPromosPanel();
  toast('Promo eliminada');
}

/* ===================== CONFIG ===================== */
function pintarConfig(){
  $('cNombre').value    = cfg('nombre_local','');
  $('cTagline').value   = cfg('tagline','');
  $('cDireccion').value = cfg('direccion','');
  $('cTelefono').value  = cfg('telefono','');
  const logo = cfg('logo','🍔');
  logoImg = esImg(logo) ? logo : '';
  $('cLogoEmoji').value = esImg(logo) ? '' : (logo||'🍔');
  $('cLogoPrev').innerHTML = esImg(logo) ? `<img src="${logo}">` : (logo||'🍔');
}
function guardarConfig(){
  setCfg('nombre_local', $('cNombre').value.trim() || 'Comida Rápida');
  setCfg('tagline', $('cTagline').value.trim());
  setCfg('direccion', $('cDireccion').value.trim());
  setCfg('telefono', $('cTelefono').value.trim());
  setCfg('logo', logoImg || $('cLogoEmoji').value.trim() || '🍔');
  pintarBarra();
  toast('💾 Configuración guardada');
}

/* ===================== QR / COMPARTIR ===================== */
function abrirQR(){
  const link = getLinkTienda();
  $('qrLink').textContent = link;
  const box = $('qrBox'); box.innerHTML = '';
  if (typeof QRCode !== 'undefined'){
    new QRCode(box, { text: link, width: 224, height: 224, correctLevel: QRCode.CorrectLevel.M });
  } else {
    box.innerHTML = '<img alt="QR" width="224" height="224" src="https://api.qrserver.com/v1/create-qr-code/?size=224x224&data='+encodeURIComponent(link)+'">';
  }
  abrir('ovQR');
}
function descargarQR(){
  const box = $('qrBox');
  const canvas = box.querySelector('canvas');
  const img = box.querySelector('img');
  let url = '';
  if (canvas) { try{ url = canvas.toDataURL('image/png'); }catch(e){} }
  if (!url && img) url = img.src;
  if (!url) { toast('No se pudo generar la imagen'); return; }
  const a = document.createElement('a');
  a.href = url; a.download = 'qr-comida-rapida.png';
  document.body.appendChild(a); a.click(); a.remove();
}
async function copiarLink(){
  try { await navigator.clipboard.writeText(getLinkTienda()); toast('🔗 Link copiado'); }
  catch(e){ toast('Copialo desde el texto de arriba 🙂'); }
}

/* ===================== VENTAS / PEDIDOS ===================== */
let ventasCache = [];
let _ventasIds = null;
let _ventasTimer = null;

function fmtFechaCorta(ts){
  try{ const d=new Date(ts);
    return d.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit'})+' '+d.toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'});
  }catch(e){ return ''; }
}

async function refrescarVentasNube(){
  const codigo = _crCodigo();
  if (!codigo) return;
  const bearer = (await authToken()) || SB_KEY;
  try{
    const res = await fetch(
      `${SB_URL}/rest/v1/${CR_BACKUPS}?tenant_id=eq.${encodeURIComponent(codigo)}&select=datos&limit=1`,
      { cache:'no-store', headers:{ apikey:SB_KEY, Authorization:'Bearer '+bearer } });
    if (!res.ok) return;
    const rows = await res.json();
    let ventas = [];
    if (rows && rows.length && rows[0].datos){
      try{ ventas = JSON.parse(rows[0].datos.ventas || '[]'); }catch(e){ ventas = []; }
    }
    ventas.sort((a,b)=>(b.fecha||0)-(a.fecha||0));
    const ids = new Set(ventas.map(v=>v.id));
    if (_ventasIds !== null){
      const nuevas = ventas.filter(v=>!_ventasIds.has(v.id));
      if (nuevas.length){
        toast('🔔 ¡Nuevo pedido! Código '+nuevas[0].codigo);
        $('tabVentas').classList.add('on'); // resaltar
      }
    }
    _ventasIds = ids;
    ventasCache = ventas;
    pintarVentas();
    actualizarBadgeVentas();
  }catch(e){ console.warn('ventas:', e); }
}

function actualizarBadgeVentas(){
  const pend = ventasCache.filter(v=>(v.estado||'pendiente')==='pendiente').length;
  const b = $('ventasBadge');
  if (pend>0){ b.textContent=pend; b.style.display='inline-grid'; }
  else b.style.display='none';
}

function pintarVentas(){
  const cont = $('listaVentas');
  if (!ventasCache.length){
    cont.innerHTML = `<div class="empty"><span class="e">🛍️</span>Todavía no hay pedidos.</div>`;
    return;
  }
  const lbl = {pendiente:'⏳ Pendiente', listo:'✅ Listo para retirar', entregado:'📦 Entregado'};
  cont.innerHTML = ventasCache.map(v=>{
    const est = v.estado || 'pendiente';
    const items = (v.items||[]).map(i=>`${i.cantidad||1}× ${escHtml(i.nombre||'')}`).join(' · ');
    const tel = (v.cliente && v.cliente.telefono) || '';
    const telLink = tel ? `<a href="https://wa.me/${tel.replace(/\D/g,'')}" target="_blank">📞 ${escHtml(tel)}</a>` : '';
    let acc = '';
    if (est!=='listo')     acc += `<button class="btn btn-soft btn-sm" data-vest="${v.id}|listo">✅ Listo</button>`;
    if (est!=='entregado') acc += `<button class="btn btn-sm" data-vest="${v.id}|entregado">📦 Entregado</button>`;
    if (est!=='pendiente') acc += `<button class="btn btn-ghost btn-sm" data-vest="${v.id}|pendiente">↩️ Reabrir</button>`;
    return `<div class="venta-card e-${est}">
      <div class="vc-top"><span class="vc-cod">${escHtml(v.codigo)}</span><span class="vc-est ${est}">${lbl[est]||est}</span></div>
      <div class="vc-cli">👤 <b>${escHtml((v.cliente&&v.cliente.nombre)||'')}</b> · ${telLink}</div>
      <div class="vc-items">${items}</div>
      <div class="vc-foot"><span class="vc-total">Total: <b>${fmtMoney(v.total)}</b></span><span class="vc-fecha">${fmtFechaCorta(v.fecha)}</span></div>
      <div class="vc-acc">${acc}</div>
    </div>`;
  }).join('');
}

async function cambiarEstadoVenta(id, estado){
  const codigo = _crCodigo();
  if (!codigo) return;
  const quien = nombreUsuario();
  ventasCache = ventasCache.map(v=>v.id===id?Object.assign({}, v, {estado, atendidoPor:quien}):v);
  pintarVentas(); actualizarBadgeVentas();
  const bearer = (await authToken()) || SB_KEY;
  try{
    const res = await fetch(
      `${SB_URL}/rest/v1/${CR_BACKUPS}?tenant_id=eq.${encodeURIComponent(codigo)}&select=datos&limit=1`,
      { cache:'no-store', headers:{ apikey:SB_KEY, Authorization:'Bearer '+bearer } });
    let datos = {};
    if (res.ok){ const rows = await res.json(); if (rows && rows.length && rows[0].datos) datos = rows[0].datos; }
    let ventas = [];
    try{ ventas = JSON.parse(datos.ventas || '[]'); }catch(e){ ventas = []; }
    ventas = ventas.map(v=>v.id===id?Object.assign({}, v, {estado, atendidoPor:quien}):v);
    datos.ventas = JSON.stringify(ventas);
    await fetch(`${SB_URL}/rest/v1/${CR_BACKUPS}`, {
      method:'POST',
      headers:{ apikey:SB_KEY, Authorization:'Bearer '+bearer, 'Content-Type':'application/json', Prefer:'resolution=merge-duplicates' },
      body: JSON.stringify({ tenant_id:codigo, datos, updated_at:new Date().toISOString() })
    });
  }catch(e){ console.warn('estado venta:', e); toast('⚠️ No se pudo guardar el cambio'); }
}

function iniciarVentas(){
  refrescarVentasNube();
  if (_ventasTimer) clearInterval(_ventasTimer);
  _ventasTimer = setInterval(refrescarVentasNube, 20000);
}

/* ===================== SEGURIDAD ===================== */
const _PASS_DEBILES = ['1234','12345','123456','1234567','12345678','0000','00000','000000','1111','111111','password','contraseña','contrasena','qwerty','admin','abc123','123123','654321'];
function claveFuerte(pass, usuario){
  const p = String(pass||'');
  if (p.length < 6) return { ok:false, msg:'La contraseña debe tener al menos 6 caracteres.' };
  if (/^(.)\1+$/.test(p)) return { ok:false, msg:'Evitá repetir el mismo carácter.' };
  if (_PASS_DEBILES.includes(p.toLowerCase())) return { ok:false, msg:'Esa contraseña es muy común. Elegí otra.' };
  if (usuario && p.toLowerCase() === String(usuario).toLowerCase()) return { ok:false, msg:'La contraseña no puede ser igual al usuario.' };
  return { ok:true, msg:'' };
}

async function pintarCuentaSegura(){
  const box = $('cuentaSeguraBox'); if(!box) return;
  if (!authLogueado()){
    box.innerHTML = '<span class="hint">⚠️ Tu cuenta segura se activa sola la próxima vez que inicies sesión.</span>';
    return;
  }
  box.innerHTML = '<span class="hint">⏳ Verificando…</span>';
  try{
    const tok = await authToken();
    const uid = authUserId();
    const r = await fetch(`${SB_URL}/rest/v1/${CR_MIEMBROS}?select=tenant_id,rol,usuario&user_id=eq.${uid}`,
      { cache:'no-store', headers:{ apikey:SB_KEY, Authorization:'Bearer '+(tok||SB_KEY) } });
    const rows = r.ok ? await r.json() : [];
    if (rows && rows.length){
      const m = rows[0];
      box.innerHTML = '✅ <b>Cuenta segura activa</b><br><span class="hint">Rol: '+escHtml(m.rol)+' · Local: '+escHtml(m.tenant_id)+'</span>';
    } else {
      box.innerHTML = '<span class="hint">🟡 Cuenta creada pero sin vincular. Cerrá sesión y volvé a entrar.</span>';
    }
  }catch(e){
    box.innerHTML = '<span class="hint">No se pudo verificar ahora. Reintentá más tarde.</span>';
  }
}

/* ===================== MODALES ===================== */
function abrir(id){ $(id).classList.add('show'); document.body.style.overflow='hidden'; }
function cerrarTodo(){ document.querySelectorAll('.overlay').forEach(o=>o.classList.remove('show')); document.body.style.overflow=''; }

/* ===================== EVENTOS ===================== */
$('loginBtn').addEventListener('click', async ()=>{
  const u=$('loginUser').value, p=$('loginPass').value;
  let rol=null, nombre='';
  const tenant = _crCodigo();

  // 1) Intentar por la cuenta segura (Supabase Auth)
  try {
    const sess = await authSignIn(_emailDe(u, tenant), p);
    if (sess){
      const m = await miMembresia();
      if (m){ rol = m.rol; nombre = (m.rol==='dueno' ? 'Dueño' : (m.usuario||u)); }
      else { authSignOut(); }
    }
  } catch(e){ console.warn('login seguro:', e); }

  // 2) Fallback (primera vez): crea la cuenta segura
  if (!rol){
    if (await loginAdmin(u,p)) {
      let r2;
      try { r2 = await asegurarCuentaSeguraDueno(localStorage.getItem('admin_user')||u, p, tenant); }
      catch(e){ r2 = { ok:false, msg:(e&&e.message)||'Error de conexión' }; }
      if (!r2 || !r2.ok){
        const e=$('loginErr');
        e.textContent = '⚠️ ' + ((r2&&r2.msg) || 'No se pudo crear tu cuenta segura.') + ' Tu página no se publicará. Pedí al administrador una contraseña de 6 caracteres o más.';
        e.style.display='block'; $('loginPass').value=''; return;
      }
      rol='dueno'; nombre='Dueño';
    } else {
      const r = await asegurarCuentaSeguraColab(u, p, tenant);
      if (r.ok){ rol='colab'; const m = await miMembresia(); nombre = (m && m.usuario) || u; }
    }
  }
  if (!rol){
    const e=$('loginErr'); e.textContent='⚠️ Usuario o contraseña incorrectos.'; e.style.display='block'; $('loginPass').value=''; return;
  }
  sessionStorage.setItem('cr_logged','true');
  sessionStorage.setItem('cr_rol', rol);
  sessionStorage.setItem('cr_user', nombre);
  mostrarPanel();
});
$('loginPass').addEventListener('keydown', e=>{ if(e.key==='Enter') $('loginBtn').click(); });
$('linkActivar').addEventListener('click', ()=>abrir('ovLic'));
$('linkRecuperar').addEventListener('click', ()=>abrir('ovRecuperar'));
$('btnRecActivar').addEventListener('click', ()=>{ cerrarTodo(); abrir('ovLic'); });

$('btnActivar').addEventListener('click', async ()=>{
  const code = $('inputCodigo').value.trim();
  const err=$('licErr'), msg=$('licMsg');
  err.style.display='none'; msg.textContent='Validando...';
  const ok = await activarLicencia(code);
  if (ok){
    msg.textContent='';
    let u=''; try{ u=(obtenerLicencia()||{}).usuario||''; }catch(e){}
    cerrarTodo();
    if (u) $('loginUser').value = u;
    $('loginPass').focus();
    toast('✅ Licencia activada. Entrá con tu usuario y contraseña.');
  } else {
    msg.textContent=''; err.textContent='❌ Código inválido o no encontrado.'; err.style.display='block';
  }
});

$('btnAddProd').addEventListener('click', ()=>abrirProd(null));
$('btnGuardarProd').addEventListener('click', guardarProd);
$('prodFile').addEventListener('change', e=>{
  const f=e.target.files[0]; if(!f) return;
  comprimirImagen(f, 800, b64=>{ imagenProd=b64; $('prodUrl').value=''; $('prodPrev').innerHTML=`<img src="${b64}">`; });
});
$('prodUrl').addEventListener('input', e=>{
  const v=e.target.value.trim();
  if(v && !esImg(imagenProd)){ imagenProd=v; $('prodPrev').innerHTML=`<img src="${escHtml(v)}">`; }
});

$('btnAddPromo').addEventListener('click', ()=>abrirPromo(null));
$('btnGuardarPromo').addEventListener('click', guardarPromo);
$('promoFile').addEventListener('change', e=>{
  const f=e.target.files[0]; if(!f) return;
  comprimirImagen(f, 800, b64=>{ promoImg=b64; $('promoUrl').value=''; $('promoPrev').innerHTML=`<img src="${b64}">`; });
});
$('promoUrl').addEventListener('input', e=>{
  const v=e.target.value.trim();
  if(v && !esImg(promoImg)){ promoImg=v; $('promoPrev').innerHTML=`<img src="${escHtml(v)}">`; }
});

$('btnGuardarConfig').addEventListener('click', guardarConfig);
$('cLogoFile').addEventListener('change', e=>{
  const f=e.target.files[0]; if(!f) return;
  comprimirImagen(f, 300, b64=>{ logoImg=b64; $('cLogoPrev').innerHTML=`<img src="${b64}">`; $('cLogoEmoji').value=''; });
});
$('cLogoEmoji').addEventListener('input', e=>{ logoImg=''; const v=e.target.value.trim()||'🍔'; $('cLogoPrev').innerHTML=escHtml(v); });

$('btnVista').addEventListener('click', async ()=>{
  const w = window.open('about:blank', '_blank');
  try { if (typeof crNubeGuardar === 'function') await crNubeGuardar(); } catch(e){}
  const url = getLinkTienda();
  if (w) w.location.href = url; else location.href = url;
});
$('btnSalir').addEventListener('click', logoutAdmin);
$('btnRefVentas').addEventListener('click', refrescarVentasNube);
$('btnQR').addEventListener('click', abrirQR);
$('btnQRDesc').addEventListener('click', descargarQR);
$('btnQRCopy').addEventListener('click', copiarLink);

$('btnCambiarClave').addEventListener('click', async ()=>{
  const a=$('cpActual').value, n=$('cpNueva').value, n2=$('cpNueva2').value;
  const err=$('cpErr'); err.textContent='';
  if(!a || !n){ err.textContent='Completá la contraseña actual y la nueva.'; return; }
  if(n!==n2){ err.textContent='Las contraseñas nuevas no coinciden.'; return; }
  const f=claveFuerte(n, localStorage.getItem('admin_user')||'');
  if(!f.ok){ err.textContent=f.msg; return; }
  const btn=$('btnCambiarClave'); const orig=btn.textContent; btn.disabled=true; btn.textContent='Cambiando…';
  try{
    const r=await cambiarClaveDueno(a, n);
    if(r.ok){ $('cpActual').value=''; $('cpNueva').value=''; $('cpNueva2').value=''; toast('✅ Contraseña cambiada'); pintarCuentaSegura(); }
    else err.textContent=r.msg||'No se pudo cambiar.';
  }catch(e){ err.textContent='Error: '+(e.message||e); }
  btn.disabled=false; btn.textContent=orig;
});

document.addEventListener('click', e=>{
  if (e.target.closest('[data-close]')) { cerrarTodo(); return; }
  if (e.target.classList.contains('overlay')) { cerrarTodo(); return; }
  const tab=e.target.closest('.tab');
  if (tab){ document.querySelectorAll('.tab').forEach(t=>t.classList.remove('on')); tab.classList.add('on');
    document.querySelectorAll('.sec').forEach(s=>s.classList.remove('on')); $(tab.dataset.sec).classList.add('on');
    if (tab.dataset.sec==='secProductos' && !_crPushPendiente) crNubeCargar().then(()=>pintarProductos()).catch(()=>{});
    if (tab.dataset.sec==='secPromos' && !_crPushPendiente) crNubeCargar().then(()=>pintarPromosPanel()).catch(()=>{});
    return; }
  const ve=e.target.closest('[data-vest]'); if(ve){ const a=ve.dataset.vest.split('|'); cambiarEstadoVenta(a[0], a[1]); return; }
  const epr=e.target.closest('[data-editpromo]'); if(epr){ abrirPromo(epr.dataset.editpromo); return; }
  const dpr=e.target.closest('[data-delpromo]'); if(dpr){ eliminarPromo(dpr.dataset.delpromo); return; }
  const ed=e.target.closest('[data-edit]'); if(ed){ abrirProd(ed.dataset.edit); return; }
  const dl=e.target.closest('[data-del]');  if(dl){ eliminarProd(dl.dataset.del); return; }
});

/* ===================== INIT ===================== */
(function init(){
  if (isAdminLogged() && (rolActual()==='colab' || verificarLicencia())) mostrarPanel();
  else mostrarLogin();
})();
