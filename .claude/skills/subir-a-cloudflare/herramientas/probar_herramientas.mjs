#!/usr/bin/env node
/**
 * Pruebas de las plantillas y herramientas de la skill (sin red ni Cloudflare): middleware de Access con un JWT
 * firmado de verdad (RSA generada aquí) y cf_acceso.mjs con un fetch simulado.
 *
 * Uso:  node probar_herramientas.mjs      → «TODAS PASAN» o el detalle de lo que falló (código 1)
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const pruebas = [];
const prueba = (nombre, fn) => pruebas.push([nombre, fn]);

// --- middleware (se copia a un .mjs temporal: la plantilla es ESM pero se llama .js) -------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-cf-'));
fs.copyFileSync(path.join(aqui, '..', 'plantillas', '_middleware.js'), path.join(tmp, 'middleware.mjs'));
const { onRequest } = await import(pathToFileURL(path.join(tmp, 'middleware.mjs')).href);

const DOMINIO = 'equipo.cloudflareaccess.com';
const AUD = 'aud-de-prueba-123';
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const par = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const par2 = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwkPublica = { ...(await crypto.subtle.exportKey('jwk', par.publicKey)), kid: 'k1' };

async function firmar(datos, { clave = par.privateKey, kid = 'k1', alg = 'RS256' } = {}) {
  const h = b64u(JSON.stringify({ alg, kid, typ: 'JWT' }));
  const p = b64u(JSON.stringify(datos));
  const s = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', clave, new TextEncoder().encode(h + '.' + p));
  return h + '.' + p + '.' + b64u(s);
}
const ahora = () => Math.floor(Date.now() / 1000);
const valido = (extra = {}) => ({ aud: [AUD], iss: 'https://' + DOMINIO, exp: ahora() + 600, email: 'Ana@Ejemplo.CL', ...extra });

globalThis.fetch = async (url) => {
  assert.equal(String(url), 'https://' + DOMINIO + '/cdn-cgi/access/certs');
  return new Response(JSON.stringify({ keys: [jwkPublica] }), { status: 200 });
};

async function pedir(headers = {}, env = { ACCESS_TEAM_DOMAIN: DOMINIO, ACCESS_AUD: AUD }, url = 'https://sitio.pages.dev/') {
  const data = {};
  let siguio = false;
  const r = await onRequest({
    request: new Request(url, { headers }), env, data,
    next: async () => { siguio = true; return new Response('PAGINA', { status: 200 }); },
  });
  return { status: r.status, siguio, email: data.email };
}

prueba('middleware: sin credencial → 403 y no sigue', async () => {
  const r = await pedir();
  assert.deepEqual([r.status, r.siguio], [403, false]);
});
prueba('middleware: correo falsificado en el encabezado NO sirve', async () => {
  const r = await pedir({ 'Cf-Access-Authenticated-User-Email': 'ana@ejemplo.cl' });
  assert.deepEqual([r.status, r.siguio], [403, false]);
});
prueba('middleware: JWT válido (encabezado) → sigue y deja el correo en minúscula', async () => {
  const r = await pedir({ 'Cf-Access-Jwt-Assertion': await firmar(valido()) });
  assert.deepEqual([r.status, r.siguio, r.email], [200, true, 'ana@ejemplo.cl']);
});
prueba('middleware: JWT válido por cookie CF_Authorization → sigue', async () => {
  const r = await pedir({ Cookie: 'otra=1; CF_Authorization=' + encodeURIComponent(await firmar(valido())) });
  assert.deepEqual([r.status, r.siguio], [200, true]);
});
prueba('middleware: firma de otra llave → 403', async () => {
  const r = await pedir({ 'Cf-Access-Jwt-Assertion': await firmar(valido(), { clave: par2.privateKey }) });
  assert.deepEqual([r.status, r.siguio], [403, false]);
});
prueba('middleware: audiencia de otra aplicación → 403', async () => {
  const r = await pedir({ 'Cf-Access-Jwt-Assertion': await firmar(valido({ aud: ['otra'] })) });
  assert.deepEqual([r.status, r.siguio], [403, false]);
});
prueba('middleware: emisor distinto → 403', async () => {
  const r = await pedir({ 'Cf-Access-Jwt-Assertion': await firmar(valido({ iss: 'https://otro.cloudflareaccess.com' })) });
  assert.deepEqual([r.status, r.siguio], [403, false]);
});
prueba('middleware: vencido → 403', async () => {
  const r = await pedir({ 'Cf-Access-Jwt-Assertion': await firmar(valido({ exp: ahora() - 10 })) });
  assert.deepEqual([r.status, r.siguio], [403, false]);
});
prueba('middleware: sin correo en la credencial (token de servicio) → 403', async () => {
  const r = await pedir({ 'Cf-Access-Jwt-Assertion': await firmar(valido({ email: undefined })) });
  assert.deepEqual([r.status, r.siguio], [403, false]);
});
prueba('middleware: algoritmo none o mal formado → 403', async () => {
  const sinFirma = b64u(JSON.stringify({ alg: 'none' })) + '.' + b64u(JSON.stringify(valido())) + '.';
  assert.equal((await pedir({ 'Cf-Access-Jwt-Assertion': sinFirma })).status, 403);
  assert.equal((await pedir({ 'Cf-Access-Jwt-Assertion': 'a.b.c' })).status, 403);
  assert.equal((await pedir({ 'Cf-Access-Jwt-Assertion': 'basura' })).status, 403);
});
prueba('middleware: sin ACCESS_TEAM_DOMAIN / ACCESS_AUD queda CERRADO (500), nunca abierto', async () => {
  const r = await pedir({ 'Cf-Access-Jwt-Assertion': await firmar(valido()) }, {});
  assert.deepEqual([r.status, r.siguio], [500, false]);
});
prueba('middleware: DEV_EMAIL solo vale en localhost', async () => {
  const local = await pedir({}, { DEV_EMAIL: 'Dev@Ejemplo.cl' }, 'http://localhost:8788/');
  assert.deepEqual([local.status, local.siguio, local.email], [200, true, 'dev@ejemplo.cl']);
  const nube = await pedir({}, { DEV_EMAIL: 'dev@ejemplo.cl', ACCESS_TEAM_DOMAIN: DOMINIO, ACCESS_AUD: AUD });
  assert.deepEqual([nube.status, nube.siguio], [403, false]);
});

// --- cf_acceso.mjs -----------------------------------------------------------------------------------------------
const acceso = await import(pathToFileURL(path.join(aqui, 'cf_acceso.mjs')).href);

function apiSimulada({ conOrg = true, apps = [], falloCrear = false, destinosActuales = [] } = {}) {
  const llamadas = [];
  const fetchFn = async (url, init = {}) => {
    const ruta = String(url).replace('https://api.cloudflare.com/client/v4', '');
    llamadas.push({ metodo: init.method, ruta, cuerpo: init.body ? JSON.parse(init.body) : null, auth: init.headers && init.headers.Authorization });
    const resp = (status, success, result, errors = []) => new Response(JSON.stringify({ success, result, errors }), { status });
    if (ruta === '/accounts/C1/access/organizations') {
      return conOrg ? resp(200, true, { auth_domain: 'equipo.cloudflareaccess.com' }) : resp(404, false, null, [{ code: 7003, message: 'sin organización' }]);
    }
    if (ruta === '/accounts/C1/access/apps' && init.method === 'GET') return resp(200, true, apps);
    if (ruta === '/accounts/C1/access/apps/VIEJA' && init.method === 'GET') {
      return resp(200, true, { id: 'VIEJA', name: 'Panel X', aud: 'AUD-VIEJO', policies: [{ id: 'POL1' }], destinations: destinosActuales });
    }
    if (ruta === '/accounts/C1/access/apps/VIEJA' && init.method === 'PUT') return resp(200, true, { id: 'VIEJA' });
    if (ruta === '/accounts/C1/access/apps' && init.method === 'POST') {
      return falloCrear ? resp(403, false, null, [{ code: 10000, message: 'Authentication error' }]) : resp(200, true, { id: 'APP1', aud: 'AUD-NUEVO' });
    }
    return resp(404, false, null, [{ message: 'ruta no simulada ' + ruta }]);
  };
  return { fetchFn, llamadas };
}

const base = ['--cuenta', 'C1', '--nombre', 'Panel X', '--dominio', 'x.pages.dev,x.midominio.cl', '--previews', '--correos', 'Ana@Ejemplo.cl,beto@ejemplo.cl'];

prueba('cf_acceso: cuerpo con destinos (incluye el comodín de previews), política allow y correos en minúscula', () => {
  const o = acceso.parsearArgumentos(base);
  const c = acceso.cuerpoDeAplicacion(o);
  assert.equal(c.type, 'self_hosted');
  assert.deepEqual(c.destinations.map((d) => d.uri), ['x.pages.dev', 'x.midominio.cl', '*.x.pages.dev']);
  assert.ok(c.destinations.every((d) => d.type === 'public'));
  assert.deepEqual(c.policies[0].include, [{ email: { email: 'ana@ejemplo.cl' } }, { email: { email: 'beto@ejemplo.cl' } }]);
  assert.equal(c.policies[0].decision, 'allow');
});
prueba('cf_acceso: crea la aplicación y devuelve team_domain y AUD; el token va solo en la cabecera', async () => {
  const { fetchFn, llamadas } = apiSimulada();
  const salida = []; const errores = [];
  const codigo = await acceso.main(base, { CLOUDFLARE_API_TOKEN: 'TOKEN-SECRETO' }, fetchFn, (t) => salida.push(t), (t) => errores.push(t));
  assert.equal(codigo, 0);
  assert.deepEqual(JSON.parse(salida[0]), { team_domain: 'equipo.cloudflareaccess.com', aud: 'AUD-NUEVO', app_id: 'APP1', reutilizada: false });
  assert.ok(llamadas.every((l) => l.auth === 'Bearer TOKEN-SECRETO'));
  assert.ok(![...salida, ...errores].join('\n').includes('TOKEN-SECRETO'), 'el token no se imprime');
});
prueba('cf_acceso: si ya existe una aplicación con ese nombre, la reutiliza sin crear otra ni borrar nada', async () => {
  const { fetchFn, llamadas } = apiSimulada({ apps: [{ id: 'VIEJA', name: 'Panel X', aud: 'AUD-VIEJO' }] });
  const salida = [];
  const codigo = await acceso.main(base, { CLOUDFLARE_API_TOKEN: 't' }, fetchFn, (t) => salida.push(t), () => {});
  assert.equal(codigo, 0);
  assert.deepEqual(JSON.parse(salida[0]), { team_domain: 'equipo.cloudflareaccess.com', aud: 'AUD-VIEJO', app_id: 'VIEJA', reutilizada: true });
  assert.deepEqual(llamadas.map((l) => l.metodo), ['GET', 'GET']);
});
prueba('cf_acceso --actualizar: suma el dominio nuevo sin quitar los que había ni tocar la política', async () => {
  const destinosActuales = [{ type: 'public', uri: 'x.pages.dev' }, { type: 'public', uri: '*.x.pages.dev' }];
  const { fetchFn, llamadas } = apiSimulada({ apps: [{ id: 'VIEJA', name: 'Panel X', aud: 'AUD-VIEJO' }], destinosActuales });
  const salida = [];
  const args = ['--cuenta', 'C1', '--nombre', 'Panel X', '--dominio', 'x.pages.dev,app.midominio.cl', '--actualizar'];
  const codigo = await acceso.main(args, { CLOUDFLARE_API_TOKEN: 't' }, fetchFn, (t) => salida.push(t), () => {});
  assert.equal(codigo, 0);
  const put = llamadas.find((l) => l.metodo === 'PUT');
  assert.deepEqual(put.cuerpo.destinations.map((d) => d.uri), ['x.pages.dev', '*.x.pages.dev', 'app.midominio.cl']);
  assert.deepEqual(put.cuerpo.policies, [{ id: 'POL1' }], 'la política queda como estaba');
  assert.deepEqual(JSON.parse(salida[0]).dominios_agregados, ['app.midominio.cl']);
  assert.ok(!llamadas.some((l) => l.metodo === 'POST' || l.metodo === 'DELETE'), 'no crea otra ni borra nada');
});
prueba('cf_acceso --actualizar: si el dominio ya está, no hace PUT', async () => {
  const destinosActuales = [{ type: 'public', uri: 'x.pages.dev' }];
  const { fetchFn, llamadas } = apiSimulada({ apps: [{ id: 'VIEJA', name: 'Panel X', aud: 'AUD-VIEJO' }], destinosActuales });
  const codigo = await acceso.main(['--cuenta', 'C1', '--nombre', 'Panel X', '--dominio', 'x.pages.dev', '--actualizar'], { CLOUDFLARE_API_TOKEN: 't' }, fetchFn, () => {}, () => {});
  assert.equal(codigo, 0);
  assert.ok(!llamadas.some((l) => l.metodo === 'PUT'));
});
prueba('cf_acceso: Zero Trust sin activar → código 3 y mensaje claro', async () => {
  const { fetchFn } = apiSimulada({ conOrg: false });
  const errores = [];
  const codigo = await acceso.main(base, { CLOUDFLARE_API_TOKEN: 't' }, fetchFn, () => {}, (t) => errores.push(t));
  assert.equal(codigo, 3);
  assert.match(errores.join(' '), /Zero Trust sin activar/);
});
prueba('cf_acceso: error de permisos al crear → código 2 con el mensaje de Cloudflare y la pista del permiso', async () => {
  const { fetchFn } = apiSimulada({ falloCrear: true });
  const errores = [];
  const codigo = await acceso.main(base, { CLOUDFLARE_API_TOKEN: 't' }, fetchFn, () => {}, (t) => errores.push(t));
  assert.equal(codigo, 2);
  assert.match(errores.join(' '), /Authentication error/);
  assert.match(errores.join(' '), /Apps and Policies/);
});
prueba('cf_acceso: faltan datos o token → código 4; --simular no llama a Cloudflare', async () => {
  const sinLlamar = async () => { throw new Error('no debía llamar'); };
  assert.equal(await acceso.main(['--cuenta', 'C1'], {}, sinLlamar, () => {}, () => {}), 4);
  assert.equal(await acceso.main(base, {}, sinLlamar, () => {}, () => {}), 4);
  const salida = [];
  assert.equal(await acceso.main([...base, '--simular'], {}, sinLlamar, (t) => salida.push(t), () => {}), 0);
  assert.equal(JSON.parse(salida[0]).name, 'Panel X');
});

// --- ejecutar ------------------------------------------------------------------------------------------------------
let fallas = 0;
for (const [nombre, fn] of pruebas) {
  try { await fn(); console.log('ok     ' + nombre); }
  catch (e) { fallas++; console.log('FALLA  ' + nombre + '\n       ' + String(e && e.message || e).split('\n').join('\n       ')); }
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fallas ? fallas + ' prueba(s) fallaron' : 'TODAS PASAN (' + pruebas.length + ')');
process.exit(fallas ? 1 : 0);
