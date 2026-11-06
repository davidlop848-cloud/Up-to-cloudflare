# Up-to-cloudflare

Skill de Claude Code **`subir-a-cloudflare`**: lleva cualquier sitio, panel o proyecto web a Cloudflare Pages (con login de Cloudflare Access si es privado, secretos, publicación automática desde GitHub y verificación de fugas).

## Contenido
```
.claude/skills/subir-a-cloudflare/
├── SKILL.md                     instrucciones de la skill
├── herramientas/                diagnostico.sh, cf_acceso.mjs, verificar_acceso.sh, probar_herramientas.mjs
└── plantillas/                  _middleware.js, wrangler.toml, _headers, workflow de GitHub
```

## Uso
- **En este repo:** Claude Code la carga sola desde `.claude/skills/`. Invocar con `/subir-a-cloudflare` o «sube esto a Cloudflare».
- **En cualquier proyecto (instalación de usuario):** copiar la carpeta a `~/.claude/skills/subir-a-cloudflare/`
  (Windows: `%USERPROFILE%\.claude\skills\subir-a-cloudflare\`).

## Probar las herramientas
```bash
node .claude/skills/subir-a-cloudflare/herramientas/probar_herramientas.mjs
```
Debe terminar en `TODAS PASAN (20)`. No usa red ni credenciales.

## Seguridad
Ningún token ni secreto va en este repo. `ACCESS_TEAM_DOMAIN` y `ACCESS_AUD` no son secretos; los tokens se cargan en la terminal, en el formulario seguro de la sesión o en los secretos de GitHub Actions.
