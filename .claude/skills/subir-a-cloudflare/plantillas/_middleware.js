/**
 * functions/_middleware.js — cierra TODO el sitio detrás de Cloudflare Access (Pages Functions).
 *
 * Por qué existe: Access protege los dominios que se le declaran (proyecto.pages.dev, su comodín y el dominio propio),
 * pero cada despliegue tiene además su URL <hash>.proyecto.pages.dev. Si esa URL no quedó cubierta, sirve el sitio
 * público. Este archivo verifica en el servidor el JWT firmado que Access agrega a cada pedido; sin él (o con uno
 * falso, vencido o de otra aplicación) responde 403. El encabezado Cf-Access-Authenticated-User-Email NO sirve de
 * prueba: se falsifica en cualquier URL sin Access.
 *
 * Configuración (wrangler.toml → [vars]; NO son secretos):
 *   ACCESS_TEAM_DOMAIN  dominio del equipo de Zero Trust, ej. "miequipo.cloudflareaccess.com"
 *   ACCESS_AUD          «Application Audience (AUD) Tag» de la aplicación de Access
 * Sin esas dos variables el sitio responde 500 «falta configurar»: queda CERRADO, nunca abierto.
 *
 * Solo desarrollo local (`wrangler pages dev`): con DEV_EMAIL definido y host localhost, usa ese correo.
 * El correo verificado queda en context.data.email para las funciones siguientes.
 *
 * Se despliega SIEMPRE desde la carpeta que contiene `functions/` (un despliegue sin functions/ queda público).
 */

const cache = { dominio: '', llaves: null, hasta: 0, releidas: 0 };

function bytesDeBase64url(t) {
  const b64 = t.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((t.length + 3) % 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

const jsonDeBase64url = (t) => JSON.parse(new TextDecoder().decode(bytesDeBase64url(t)));

function leerCookie(request, nombre) {
  const c = request.headers.get('Cookie') || '';
  const m = c.match(new RegExp('(?:^|;\\s*)' + nombre + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : '';
}

async function llavesDeAccess(dominio, forzar) {
  const ahora = Math.floor(Date.now() / 1000);
  if (!forzar && cache.dominio === dominio && cache.llaves && cache.hasta > ahora) return cache.llaves;
  const r = await fetch('https://' + dominio + '/cdn-cgi/access/certs');
  if (!r.ok) throw new Error('No se pudieron leer las llaves de Access (' + r.status + ').');
  cache.dominio = dominio;
  cache.llaves = (await r.json()).keys || [];
  cache.hasta = ahora + 3600;
  return cache.llaves;
}

/** → { email } si el JWT es válido; lanza Error con el motivo si no. */
async function verificar(jwt, dominio, aud) {
  const partes = jwt.split('.');
  if (partes.length !== 3) throw new Error('Credencial mal formada.');
  const cabecera = jsonDeBase64url(partes[0]);
  const datos = jsonDeBase64url(partes[1]);
  if (cabecera.alg !== 'RS256') throw new Error('Algoritmo no aceptado.');

  let jwk = (await llavesDeAccess(dominio, false)).find((k) => k.kid === cabecera.kid);
  // Access rota su llave de firma cada tantas semanas: una llave nueva que no está en la caché se busca de nuevo
  // (a lo más una vez por minuto, para que un kid inventado no fuerce lecturas).
  const ahoraLlaves = Math.floor(Date.now() / 1000);
  if (!jwk && cache.releidas <= ahoraLlaves - 60) {
    cache.releidas = ahoraLlaves;
    jwk = (await llavesDeAccess(dominio, true)).find((k) => k.kid === cabecera.kid);
  }
  if (!jwk) throw new Error('La credencial no es de este equipo de Access.');

  const llave = await crypto.subtle.importKey(
    'jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const firmaOk = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', llave, bytesDeBase64url(partes[2]),
    new TextEncoder().encode(partes[0] + '.' + partes[1]));
  if (!firmaOk) throw new Error('Firma inválida.');

  const auds = Array.isArray(datos.aud) ? datos.aud : [datos.aud];
  if (auds.indexOf(aud) < 0) throw new Error('La credencial es de otra aplicación.');
  if (datos.iss !== 'https://' + dominio) throw new Error('Emisor no reconocido.');
  const ahora = Math.floor(Date.now() / 1000);
  if (!datos.exp || datos.exp < ahora) throw new Error('Credencial vencida.');
  if (datos.nbf && datos.nbf > ahora + 60) throw new Error('Credencial todavía no válida.');
  if (!datos.email) throw new Error('La credencial no trae correo.');
  return { email: String(datos.email).trim().toLowerCase() };
}

function respuesta(status, texto) {
  return new Response(texto, {
    status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function onRequest(context) {
  const { request, env } = context;

  const host = new URL(request.url).hostname;
  if (env.DEV_EMAIL && (host === 'localhost' || host === '127.0.0.1')) {
    context.data.email = String(request.headers.get('X-Dev-Email') || env.DEV_EMAIL).trim().toLowerCase();
    return context.next();
  }

  const dominio = String(env.ACCESS_TEAM_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const aud = String(env.ACCESS_AUD || '');
  if (!dominio || !aud) return respuesta(500, 'Falta configurar ACCESS_TEAM_DOMAIN y ACCESS_AUD.');

  const jwt = request.headers.get('Cf-Access-Jwt-Assertion') || leerCookie(request, 'CF_Authorization');
  if (!jwt) return respuesta(403, 'Acceso restringido.');
  try {
    const { email } = await verificar(jwt, dominio, aud);
    context.data.email = email;
  } catch (e) {
    return respuesta(403, 'Acceso restringido.');
  }
  return context.next();
}
