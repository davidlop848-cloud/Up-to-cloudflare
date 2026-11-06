#!/usr/bin/env node
/**
 * Crea (o reutiliza) la aplicación de Cloudflare Access que protege un sitio y entrega los dos datos que necesita
 * functions/_middleware.js: el dominio del equipo (ACCESS_TEAM_DOMAIN) y el AUD de la aplicación (ACCESS_AUD).
 *
 * Uso:
 *   CLOUDFLARE_API_TOKEN=… node cf_acceso.mjs --cuenta <ID> --nombre "Panel X" \
 *     --dominio proyecto.pages.dev[,otro.midominio.cl] [--previews] \
 *     --correos a@x.cl,b@x.cl [--dominio-correo x.cl] [--sesion 24h] [--simular]
 *
 *   --previews   agrega también *.<primer dominio> (las URL <hash>.proyecto.pages.dev de cada despliegue)
 *   --simular    solo muestra qué enviaría (sin llamar a Cloudflare)
 *   --actualizar si la aplicación ya existe, le SUMA los dominios pedidos (p. ej. un dominio propio, que va a Access
 *                recién cuando Pages ya lo tiene activo); nunca quita dominios ni cambia la política
 *
 * El token (permiso «Access: Apps and Policies Write» y lectura de la organización de Zero Trust) sale del entorno;
 * nunca se imprime. No borra nada: si ya existe una aplicación con ese nombre, la reutiliza y muestra su AUD.
 *
 * Salida (stdout, una línea JSON): { "team_domain", "aud", "app_id", "reutilizada" }
 * Códigos de salida: 0 bien · 2 error de la API (el mensaje de Cloudflare va a stderr) · 3 Zero Trust sin activar
 *                    4 faltan datos de entrada
 */

const API = 'https://api.cloudflare.com/client/v4';

export function parsearArgumentos(argv) {
  const o = { dominios: [], correos: [], previews: false, simular: false, actualizar: false, sesion: '24h' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], sig = () => argv[++i];
    if (a === '--cuenta') o.cuenta = sig();
    else if (a === '--nombre') o.nombre = sig();
    else if (a === '--dominio') o.dominios.push(...String(sig() || '').split(',').map((x) => x.trim()).filter(Boolean));
    else if (a === '--correos') o.correos.push(...String(sig() || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean));
    else if (a === '--dominio-correo') o.dominioCorreo = String(sig() || '').trim().toLowerCase().replace(/^@/, '');
    else if (a === '--sesion') o.sesion = sig();
    else if (a === '--previews') o.previews = true;
    else if (a === '--simular') o.simular = true;
    else if (a === '--actualizar') o.actualizar = true;
  }
  return o;
}

/** Cuerpo del POST /accounts/{id}/access/apps (ver developers.cloudflare.com → Access applications API). */
export function cuerpoDeAplicacion(o) {
  const hosts = o.dominios.slice();
  if (o.previews && o.dominios[0]) hosts.push('*.' + o.dominios[0]);
  const include = o.correos.map((email) => ({ email: { email } }));
  if (o.dominioCorreo) include.push({ email_domain: { domain: o.dominioCorreo } });
  return {
    name: o.nombre,
    type: 'self_hosted',
    domain: hosts[0],
    destinations: hosts.map((uri) => ({ type: 'public', uri })),
    session_duration: o.sesion || '24h',
    policies: [{ name: 'Personas autorizadas', decision: 'allow', include }],
  };
}

export function validar(o) {
  const faltan = [];
  if (!o.cuenta) faltan.push('--cuenta');
  if (!o.nombre) faltan.push('--nombre');
  if (!o.dominios.length) faltan.push('--dominio');
  if (!o.actualizar && !o.correos.length && !o.dominioCorreo) faltan.push('--correos (o --dominio-correo)');
  return faltan;
}

async function llamar(fetchFn, token, metodo, ruta, cuerpo) {
  const r = await fetchFn(API + ruta, {
    method: metodo,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  let j = null;
  try { j = await r.json(); } catch (e) { j = null; }
  return { http: r.status, ok: !!(j && j.success), resultado: j && j.result, errores: (j && j.errors) || [] };
}

const textoErrores = (r) => r.errores.map((e) => (e.code ? e.code + ': ' : '') + (e.message || '')).join(' | ') || ('HTTP ' + r.http);

/** → { codigo, salida?, error? } (sin imprimir: lo hace main). `fetchFn` se inyecta en las pruebas. */
export async function ejecutar(o, token, fetchFn) {
  const org = await llamar(fetchFn, token, 'GET', '/accounts/' + o.cuenta + '/access/organizations');
  if (!org.ok || !org.resultado || !org.resultado.auth_domain) {
    // Sin organización de Zero Trust (o el token no la puede leer): hay que activarla una vez en el panel.
    return { codigo: 3, error: 'Zero Trust sin activar o sin permiso para leerlo (' + textoErrores(org) + ').' };
  }
  const teamDomain = String(org.resultado.auth_domain).replace(/^https?:\/\//, '').replace(/\/+$/, '');

  const lista = await llamar(fetchFn, token, 'GET', '/accounts/' + o.cuenta + '/access/apps');
  if (!lista.ok) return { codigo: 2, error: 'No se pudieron leer las aplicaciones de Access: ' + textoErrores(lista) };
  const previa = (lista.resultado || []).find((a) => a.name === o.nombre);
  if (previa && o.actualizar) {
    // Suma los dominios pedidos a la aplicación existente (nunca quita ninguno). Cloudflare pide el objeto completo en el PUT.
    const actual = await llamar(fetchFn, token, 'GET', '/accounts/' + o.cuenta + '/access/apps/' + previa.id);
    if (!actual.ok || !actual.resultado) return { codigo: 2, error: 'No se pudo leer la aplicación de Access: ' + textoErrores(actual) };
    const app = actual.resultado;
    const destinos = (app.destinations || []).slice();
    const ya = new Set(destinos.map((d) => d.type + ':' + (d.uri || '')));
    const nuevos = cuerpoDeAplicacion(o).destinations.filter((d) => !ya.has(d.type + ':' + d.uri));
    if (nuevos.length) {
      const puesto = await llamar(fetchFn, token, 'PUT', '/accounts/' + o.cuenta + '/access/apps/' + previa.id, { ...app, destinations: destinos.concat(nuevos) });
      if (!puesto.ok) return { codigo: 2, error: 'No se pudo actualizar la aplicación de Access: ' + textoErrores(puesto) };
    }
    return { codigo: 0, salida: { team_domain: teamDomain, aud: app.aud || previa.aud || '', app_id: previa.id, reutilizada: true, dominios_agregados: nuevos.map((d) => d.uri) } };
  }
  if (previa) {
    return { codigo: 0, salida: { team_domain: teamDomain, aud: previa.aud || '', app_id: previa.id, reutilizada: true } };
  }

  const nueva = await llamar(fetchFn, token, 'POST', '/accounts/' + o.cuenta + '/access/apps', cuerpoDeAplicacion(o));
  if (!nueva.ok || !nueva.resultado) {
    return { codigo: 2, error: 'No se pudo crear la aplicación de Access: ' + textoErrores(nueva) +
      ' (revisa que el token tenga «Access: Apps and Policies · Edit»).' };
  }
  return { codigo: 0, salida: { team_domain: teamDomain, aud: nueva.resultado.aud || '', app_id: nueva.resultado.id, reutilizada: false } };
}

export async function main(argv, env, fetchFn, salida = console.log, errores = console.error) {
  const o = parsearArgumentos(argv);
  const faltan = validar(o);
  if (faltan.length) { errores('Faltan datos: ' + faltan.join(', ') + '. Ver el encabezado de cf_acceso.mjs.'); return 4; }
  if (o.simular) { salida(JSON.stringify(cuerpoDeAplicacion(o), null, 2)); return 0; }
  if (!env.CLOUDFLARE_API_TOKEN) { errores('Falta CLOUDFLARE_API_TOKEN en el entorno.'); return 4; }
  const r = await ejecutar(o, env.CLOUDFLARE_API_TOKEN, fetchFn);
  if (r.error) errores(r.error);
  if (r.salida) {
    if (!r.salida.aud) errores('Cloudflare no devolvió el AUD: cópialo de Zero Trust → Access controls → Applications → Edit → Additional settings.');
    salida(JSON.stringify(r.salida));
  }
  return r.codigo;
}

const esPrincipal = process.argv[1] && import.meta.url === new URL('file://' + process.argv[1].replace(/\\/g, '/')).href;
if (esPrincipal) {
  main(process.argv.slice(2), process.env, (...a) => fetch(...a)).then((c) => process.exit(c));
}
