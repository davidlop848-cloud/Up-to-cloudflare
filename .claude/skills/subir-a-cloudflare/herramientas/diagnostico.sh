#!/usr/bin/env bash
# Reconoce un proyecto antes de subirlo a Cloudflare. Solo lee: no instala, no despliega, no imprime secretos.
#
# Uso:  bash diagnostico.sh [carpeta_del_proyecto]      (por omisión, la carpeta actual)
# Salida: líneas «clave: valor» para que Claude decida (tipo de sitio, carpeta de salida, secretos que pide, etc.).

set -u
RAIZ="${1:-.}"
cd "$RAIZ" || { echo "No existe la carpeta $RAIZ"; exit 2; }

echo "carpeta: $(pwd)"
echo "node: $(node --version 2>/dev/null || echo NO_INSTALADO)"
echo "npm: $(npm --version 2>/dev/null || echo NO_INSTALADO)"
if git rev-parse --git-dir >/dev/null 2>&1; then
  echo "git_rama: $(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
  echo "git_remoto: $(git remote get-url origin 2>/dev/null | sed -E 's#://[^@/]*@#://#')"
else
  echo "git: NO_ES_REPOSITORIO"
fi

# --- tipo de proyecto -------------------------------------------------------
marco="estatico"
if [ -f package.json ]; then
  echo "package_json: si (name=$(node -e 'try{console.log(require("./package.json").name||"")}catch(e){}' 2>/dev/null))"
  echo "scripts: $(node -e 'try{console.log(Object.keys(require("./package.json").scripts||{}).join(","))}catch(e){}' 2>/dev/null)"
  deps="$(node -e 'try{const p=require("./package.json");console.log(Object.keys({...p.dependencies,...p.devDependencies}).join(" "))}catch(e){}' 2>/dev/null)"
  for m in next nuxt astro @sveltejs/kit vite react-scripts @angular/core gatsby @remix-run/react; do
    case " $deps " in *" $m "*) marco="$m"; break ;; esac
  done
else
  echo "package_json: no"
fi
echo "marco: $marco"

# --- carpeta de salida (donde está el index.html final) ----------------------
salida=""
for d in dist build out public .output/public _site site docs .; do
  if [ -f "$d/index.html" ]; then salida="$d"; break; fi
done
echo "salida_probable: ${salida:-NO_ENCONTRADA (hay que armar el proyecto primero)}"

# --- lo que ya hay de Cloudflare ----------------------------------------------
for f in wrangler.toml wrangler.json wrangler.jsonc functions/_middleware.js functions/_middleware.ts _headers _redirects public/_headers; do
  [ -e "$f" ] && echo "existe: $f"
done
[ -d functions ] && echo "functions: si ($(find functions -type f | wc -l | tr -d ' ') archivos)" || echo "functions: no"
if [ -d .github/workflows ] && grep -rlq "wrangler" .github/workflows 2>/dev/null; then
  echo "ci_cloudflare: ya hay un workflow con wrangler"
fi

# --- variables que el código espera (nombres, nunca valores) ---------------------
if [ -d functions ]; then
  nombres="$(grep -rhoE 'env\.[A-Z][A-Z0-9_]+' functions 2>/dev/null | sed 's/^env\.//' | sort -u | tr '\n' ' ')"
  echo "variables_que_pide_functions: ${nombres:-ninguna}"
fi

# --- cosas que NO deben subirse ---------------------------------------------------
for f in .env .env.local .dev.vars .secreto; do
  [ -e "$f" ] && echo "AVISO_secreto_local: $f existe (no se sube; confirmar que está en .gitignore)"
done
if git rev-parse --git-dir >/dev/null 2>&1; then
  for f in .env .dev.vars node_modules/x; do
    git check-ignore -q "$f" || echo "AVISO_gitignore: ${f%/x} no está ignorado por git (agregarlo a .gitignore)"
  done
fi

# --- sesión de Cloudflare (solo si ya hay credencial en el entorno) -------------------
if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "cloudflare_token: presente en el entorno (no se muestra)"
  echo "cloudflare_cuenta_id: ${CLOUDFLARE_ACCOUNT_ID:-no definido}"
else
  echo "cloudflare_token: AUSENTE"
fi
