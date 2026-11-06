---
name: subir-a-cloudflare
description: Sube cualquier panel, proyecto o página web a Cloudflare (Pages, con login de Cloudflare Access si es privado, secretos, publicación automática desde GitHub y comprobación de que no haya fugas), ejecutando cada paso él mismo y pidiéndole a la persona SOLO lo imprescindible. Usar cuando digan «sube esto a Cloudflare», «publica esta página/este panel», «ponlo en Cloudflare», «despliega este proyecto» o /subir-a-cloudflare. Invocarla ES el pedido explícito de desplegar.
---

# Skill: subir-a-cloudflare

Lleva un proyecto cualquiera (sitio estático, panel con `functions/`, resultado de un build de Vite/Astro/React…) a **Cloudflare Pages**, igual que se hizo con el Panel de Estudios (`docs/CLOUDFLARE.md`, `panel/cloudflare/`) y el generador web (`web/`).

**Regla de oro: tú ejecutas todo lo que se puede ejecutar; la persona solo hace lo que únicamente ella puede hacer.** Nada de listas largas de «haz esto, luego esto»: avanza tú, y cuando llegues a algo imprescindible dale **un** paso, con la ruta exacta, espera su confirmación y verifica por comando que quedó bien.

Material de la skill (en esta carpeta): `plantillas/` (middleware de Access, `wrangler.toml`, `_headers`, workflow de GitHub) y `herramientas/` (`diagnostico.sh`, `cf_acceso.mjs`, `verificar_acceso.sh`, `probar_herramientas.mjs`). `$S` = la carpeta donde está instalada esta skill (la que contiene este `SKILL.md`: en un proyecto suele ser `.claude/skills/subir-a-cloudflare/`; instalada para el usuario, `~/.claude/skills/subir-a-cloudflare/`). Todas las rutas de abajo son relativas a `$S`.

## Cómo responder (siempre)
- Al empezar cada turno: «paso N de M listo: …. Sigue: …». Si la persona debe actuar, **una** acción, ruta de menús exacta y qué pegar/pulsar; el resto va después.
- Errores en tono neutro: causa y solución. Estimaciones concretas («~5 min»). Sin preámbulos ni cierres de cortesía.
- Máximo 5 ítems por lista; termina con UNA acción de menos de 2 minutos para la persona (o «nada: sigo yo»).

## Lo único que hace la persona (lista cerrada)
1. **Crear el token de API de Cloudflare** (y la cuenta si no la tiene). Solo ella puede.
2. **Activar Zero Trust** la primera vez (elegir el nombre del equipo) — solo si el sitio es privado y Zero Trust no está activo.
3. **Decidir quién entra** (correos o dominio de correo) — solo si el sitio es privado.
4. **Pegar los secretos de la aplicación** (valores que solo ella conoce) — nunca en el chat.
5. **Probar el login** en una ventana de incógnito (solo ella recibe el código en su correo).
6. Solo con publicación automática: cargar 2 secretos en GitHub. Solo con dominio propio: el DNS si no está en Cloudflare.

Todo lo demás (diagnóstico, archivos, build, proyecto de Pages, aplicación de Access, middleware, despliegue, pruebas de fuga, workflow, documentación) lo haces tú.

## Reglas duras
- **Secretos nunca en el chat, en archivos ni en el repo** (tokens, `WORKER_TOKEN`, claves, URLs privadas). Los pega la persona en el formulario seguro, en su terminal o en el panel de Cloudflare. `ACCESS_TEAM_DOMAIN` y `ACCESS_AUD` **no** son secretos (van en `wrangler.toml`).
- **Un sitio privado se despliega SIEMPRE con `functions/_middleware.js`** y desde la carpeta que contiene `functions/`. Un despliegue sin ellas queda público (la fuga del 23/09/2026: la URL `<hash>.pages.dev` siguió sirviendo datos más de 30 min).
- **No borrar** proyectos, despliegues, aplicaciones de Access ni registros DNS sin pedido explícito. Si ya existe algo con el mismo nombre, se reutiliza.
- **Verificar antes de afirmar**: nunca digas «listo» sin haber corrido `verificar_acceso.sh` (o la prueba equivalente) y mostrado su salida.
- Respeta las convenciones de commits del proyecto (en el repo de FLR: convencionales, en español, sin atribución a IA). No hacer commit ni push sin que lo pidan (la publicación automática solo se instala si la persona la acepta).

## Pasos

### 0. Reconocer el proyecto (tú, ~1 min)
```bash
bash $S/herramientas/diagnostico.sh <carpeta>
```
Con su salida decide **sin preguntar**: nombre del proyecto (minúsculas, números y guiones, ≤ 58 caracteres; a partir del repo/carpeta), rama de producción `main`, carpeta de salida (`salida_probable`; si dice `NO_ENCONTRADA`, arma primero con `npm run build`), si hay `functions/`, y qué variables pide (`variables_que_pide_functions` = los **secretos** del paso 6). Si hay avisos de `.gitignore` o `.env`, arréglalos o avisa.

**Pregunta una sola vez, si no es evidente:** «¿Es **privado** (solo gente autorizada) o **público**?». Si hay datos de clientes, login, planillas, APIs o secretos → privado por defecto; si dudas, privado. Un sitio público salta los pasos 4 y 5 y se verifica con `--publico`.

### 1. Preparar el proyecto (tú, ~5 min)
- Crea/ajusta `wrangler.toml` desde `$S/plantillas/wrangler.toml` (reemplaza `__NOMBRE__`, `__SALIDA__`, `__FECHA__` con la fecha de hoy). Si ya existe, respétalo y solo completa `[vars]`.
- Copia `$S/plantillas/_headers` a la carpeta de salida si no tiene uno propio (ajusta o quita la sección `/assets/*` si no aplica).
- Si el proyecto necesita build, córrelo y confirma que la carpeta de salida tiene `index.html`.
- Si hay `functions/`, confirma que ninguna lee secretos de archivos locales (`.env`): deben salir de `env.NOMBRE`.
- Framework con servidor propio (Next.js con SSR, Nuxt SSR…) necesita su adaptador de Cloudflare: busca la guía vigente con la herramienta de documentación de Cloudflare si está disponible, y avisa si el cambio es grande antes de seguir.

### 2. Credenciales (persona → tú verificas)
Primero mira si ya hay sesión: `npx --yes wrangler@4 whoami` (o `cloudflare_token: presente` en el diagnóstico). Si sirve, **salta este paso**.

Si no, la persona crea **un token** (una vez): <https://dash.cloudflare.com/profile/api-tokens> → *Create Token* → *Create Custom Token* con permisos de **cuenta**:
- *Cloudflare Pages* → **Edit**
- *Access: Apps and Policies* → **Edit** y *Access: Organizations, Identity Providers, and Groups* → **Read** (solo sitio privado)
- con dominio propio en Cloudflare, además *Zone* → *DNS* → **Edit** y *Zone* → **Read**.

(Los nombres exactos pueden variar un poco en pantalla; si algo falla, el mensaje de la API dice qué permiso falta.) Cómo entra el token, según dónde corra Claude:
- **Sesión en la nube** (sin navegador): pídelo con la herramienta segura de credenciales de la sesión (host `api.cloudflare.com`; la persona lo escribe en el formulario y tú nunca lo ves). Después usa `CLOUDFLARE_API_TOKEN` con un valor ficticio de 40 caracteres: el proxy pone el real. Si responde 401/403, espera ~1 min y reintenta. Si el host está bloqueado por la red de la sesión, propone con las herramientas de entorno de la sesión agregar `api.cloudflare.com` (y el dominio del sitio, para verificarlo); la persona aprueba.
- **PC de la persona**: que lo guarde como variable de entorno **en su propia terminal** (Windows: `setx CLOUDFLARE_API_TOKEN "…"` y reabrir Claude Code; Mac/Linux: `export …` en su perfil). Nunca pegado en el chat.

Verifica y obtén el *Account ID*:
- `npx --yes wrangler@4 whoami` lo muestra (si hay varias cuentas, pregunta cuál). Si falla con «Failed to automatically retrieve account IDs», el token no puede listar cuentas (no es un problema del token para desplegar): pídele a la persona el **Account ID** (no es secreto: Cloudflare → *Workers & Pages* → columna derecha) y úsalo como `CLOUDFLARE_ACCOUNT_ID`.
- Con el ID, prueba el permiso real: `CLOUDFLARE_ACCOUNT_ID=<id> npx --yes wrangler@4 pages project list`. Si responde (aunque la lista esté vacía), las credenciales sirven; un error de autenticación aquí sí es del token (permiso *Cloudflare Pages · Edit* o token mal copiado).

### 3. Crear el proyecto de Pages (tú, ~1 min)
```bash
npx --yes wrangler@4 pages project list            # ¿ya existe? entonces se reutiliza
npx --yes wrangler@4 pages project create <nombre> --production-branch main
```
Anota la URL de producción: `https://<nombre>.pages.dev`.

### 4. Login con Cloudflare Access (solo privado)
Con la persona define **solo** quién entra: «¿Qué correos pueden entrar? (o un dominio, ej. `@empresa.cl`)». Luego, tú:
```bash
CLOUDFLARE_API_TOKEN=… node $S/herramientas/cf_acceso.mjs --cuenta <ACCOUNT_ID> --nombre "<Nombre legible>" \
  --dominio <nombre>.pages.dev --previews --correos a@x.cl,b@x.cl
```
- `--previews` agrega `*.<nombre>.pages.dev` (las URL de cada despliegue). **Un dominio propio NO va aquí**: Pages no deja agregar un dominio que ya tiene Access; se suma al final, en el paso 10.
- Prueba antes con `--simular` si quieres ver el cuerpo que enviará.
- Salida: una línea JSON con `team_domain` y `aud` → ponlos en `wrangler.toml` (`ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`).
- **Código 3 = Zero Trust sin activar**: la persona entra a <https://one.dash.cloudflare.com/> (menú *Zero Trust*), pone un nombre de equipo (ej. `miempresa`) y elige el plan **Free**; avísame y repites el comando. (Login por defecto: código de un solo uso al correo; ya viene activo.)
- **Código 2** (permisos u otro error de la API): muestra el mensaje tal cual. Si no se resuelve en un intento, usa el camino manual: *Zero Trust → Access controls → Applications → Add an application → Self-hosted*, con los dominios de arriba y una política **Allow → Emails**; la persona copia el **AUD** (*Edit → Additional settings*) y el *Team domain*.
- Reusar una aplicación existente es seguro: `cf_acceso.mjs` no crea duplicados ni borra nada (con `--actualizar` solo le suma dominios).

### 5. Middleware de Access (solo privado, tú, ~2 min)
```bash
mkdir -p functions && cp $S/plantillas/_middleware.js functions/_middleware.js
node $S/herramientas/probar_herramientas.mjs        # 20 pruebas: debe decir TODAS PASAN
```
Si el proyecto ya tiene `functions/_middleware.js`, **intégralo** (no lo pises): el chequeo de Access debe ir primero. Con `wrangler pages dev` local: `DEV_EMAIL` en `.dev.vars` (nunca subirlo) para entrar sin Access.

### 6. Secretos de la aplicación (persona, solo si el código los pide)
Para cada nombre de `variables_que_pide_functions` (menos `ACCESS_*`), **una a la vez**:
> En tu terminal, desde `<carpeta>`: `npx --yes wrangler@4 pages secret put <NOMBRE> --project-name <nombre>` y pega el valor cuando lo pida.
> (Sin terminal: Cloudflare → Workers & Pages → `<nombre>` → Settings → Variables and Secrets → Add → tipo *Secret*.)

Comprueba los nombres con `npx --yes wrangler@4 pages secret list --project-name <nombre>` (no muestra valores). Los secretos se aplican en el **próximo despliegue**.

### 7. Primer despliegue (tú, ~2 min)
Desde la carpeta que tiene `wrangler.toml` y `functions/`:
```bash
npx --yes wrangler@4 pages deploy --branch main
```
Anota la URL del despliegue que imprime (`https://<hash>.<nombre>.pages.dev`) y el id del despliegue anterior si lo hay (`pages deployment list`).

### 8. Verificar (tú) y confirmar el login (persona)
```bash
bash $S/herramientas/verificar_acceso.sh <nombre>.pages.dev --despliegue https://<hash>.<nombre>.pages.dev/ --marca <texto_privado_de_la_página>
# sitio público:  bash $S/herramientas/verificar_acceso.sh <nombre>.pages.dev --publico
```
Esperado en privado: producción → **302** a `*.cloudflareaccess.com`; la URL del despliegue, su `/api/…`, el correo falsificado y un JWT falso → **302 o 403, nunca 200**; la marca no aparece. Muestra la salida completa.

Luego la persona: «Abre `https://<nombre>.pages.dev` en una ventana de incógnito; debe pedirte el correo y un código, y mostrar la página.» (Solo ella recibe el código.)

**Si hay fuga (algún 200 o la marca aparece): retroceder YA.** (1) Cloudflare → proyecto → *Deployments* → el anterior bueno → ⋯ → *Rollback* (o redesplegar el último bueno); (2) `npx --yes wrangler@4 pages deployment delete <id> --project-name <nombre> --force` al que filtra; (3) volver a medir su URL (un despliegue borrado puede seguir respondiendo un rato: la contención es que Access cubra `*.<nombre>.pages.dev`); (4) informar qué URL filtró, desde cuándo, qué datos y qué falta. No cambies Access por cuenta propia fuera de `cf_acceso.mjs`.

### 9. Publicación automática desde GitHub (opcional: pregunta UNA vez)
«¿Quieres que cada vez que unas a `main` se publique solo?». Si sí:
1. Copia `$S/plantillas/workflow-cloudflare-pages.yml` a `.github/workflows/cloudflare-pages.yml` (reemplaza `__NOMBRE__` y `__CARPETA__`; quita los `npm` si el proyecto no los usa). Si ya hay un workflow con pruebas, agrega solo el job `publicar`.
2. La persona carga **2 secretos** en GitHub → repositorio → *Settings* → *Secrets and variables* → *Actions* → *New repository secret*: `CLOUDFLARE_API_TOKEN` (el token del paso 2; si quiere, uno aparte solo con *Cloudflare Pages · Edit*) y `CLOUDFLARE_ACCOUNT_ID`.
3. Sin esos secretos el job avisa «no se publica» y termina en verde. Commit/push solo si la persona lo pide; el flujo normal del proyecto es rama → «PUBLICA» → `main`.

### 10. Dominio propio (opcional, solo si lo pide)
**El orden importa** (Pages no deja agregar un dominio que ya tiene una política de Access, y para emitir el certificado necesita llegar a `/.well-known/acme-challenge/*`):
1. Agrega el dominio a Pages **primero**: `POST /accounts/<id>/pages/projects/<nombre>/domains` con `{"name":"app.midominio.cl"}` (o *Workers & Pages → proyecto → Custom domains*).
2. Crea el registro `CNAME app → <nombre>.pages.dev` (proxied). Lo creas tú si el dominio está en esa cuenta de Cloudflare; si no, la persona lo crea en su registrador (único paso suyo). Espera a que el dominio quede **Active** (`GET …/domains`; puede tardar unos minutos).
3. **Privado**: recién entonces súmalo a Access: `node $S/herramientas/cf_acceso.mjs --cuenta <id> --nombre "<Nombre legible>" --dominio app.midominio.cl --actualizar`. Sin este paso la pantalla de login aparece pero no funciona para ese dominio.
4. Vuelve a correr `verificar_acceso.sh app.midominio.cl …`.

### 11. Cerrar (tú)
Deja `CLOUDFLARE.md` (o una sección en el README) en el proyecto, **sin secretos**: nombre y URL, dominios, `ACCESS_*` (valores no secretos), nombres de los secretos y cómo se cargan, cómo actualizar (`wrangler pages deploy` o `main`), cómo verificar y cómo retroceder. Reporta en el formato de arriba: URL, lo que quedó protegido, resultado de `verificar_acceso.sh`, lo pendiente de la persona (si algo).

## Si algo falla
| Síntoma | Causa y arreglo |
|---|---|
| El sitio responde 500 «Falta configurar ACCESS_TEAM_DOMAIN y ACCESS_AUD» | Faltan en `[vars]` de `wrangler.toml` → paso 4 y volver a desplegar |
| 403 aun con login | AUD o team domain de otra aplicación/equipo → compara con *Zero Trust → Applications → Edit* |
| Bucle de login o pantalla de Access que no deja pasar | El dominio no está en la aplicación de Access (típico: dominio propio) → paso 10.3 |
| Pages no deja agregar el dominio propio | Ya tiene una política de Access: quitarlo de la aplicación, agregarlo a Pages y volver a sumarlo (paso 10) |
| `cf_acceso.mjs` sale con 2 y «Authentication error» | El token no tiene *Access: Apps and Policies · Edit* → editar el token en Cloudflare |
| La función dice que falta un secreto | No se cargó o se cargó después del despliegue → paso 6 y redesplegar |
| `wrangler` pide login y no hay navegador | Sesión en la nube: usar el token por la herramienta segura (paso 2) |
| Build falla por versión de Node | Fijar `NODE_VERSION` / `.nvmrc` o el `node-version` del workflow |

Solo si trabajas en el repo de Presupuestos FLR, referencias reales: `panel/cloudflare/` (Pages + Worker + Access + motor en Apps Script), `web/functions/_middleware.js` (middleware de Access), `docs/CLOUDFLARE.md` (puesta en marcha del panel), `tools/verif_fuga.sh` (versión específica de la verificación) y la skill `desplegar-web`.
