#!/usr/bin/env bash
# Verifica que un sitio en Cloudflare Pages esté cerrado (o abierto, si es público) como corresponde.
#
# Uso:
#   bash verificar_acceso.sh <dominio_produccion> [--despliegue <url>] [--marca <texto>] [--publico]
#   bash verificar_acceso.sh mi-panel.pages.dev --despliegue https://1a2b3c4d.mi-panel.pages.dev/ --marca DATOS_PRIVADOS
#
#   <dominio_produccion>  el dominio con que entra la gente (proyecto.pages.dev o el propio)
#   --despliegue          URL <hash>.proyecto.pages.dev del despliegue recién hecho (la imprime wrangler)
#   --marca               texto que SOLO existe en la página real (un dato privado): no debe aparecer en ninguna
#                         respuesta sin login
#   --publico             sitio público a propósito: espera 200 en producción y que NO pida login
#
# Sitio privado, esperado:
#   - https://<dominio>/                -> 302 hacia *.cloudflareaccess.com (lo corta Access)
#   - <despliegue>/ , <despliegue>/api/prueba, y con el encabezado de correo falsificado -> 302 (Access cubre el
#     comodín) o 403 (lo corta functions/_middleware.js); NUNCA 200
# Sale con código 0 solo si todo se cumple.

set -u

DOMINIO=""; DESPLIEGUE=""; MARCA=""; PUBLICO=0
while [ $# -gt 0 ]; do
  case "$1" in
    --despliegue) DESPLIEGUE="${2:-}"; shift 2 ;;
    --marca) MARCA="${2:-}"; shift 2 ;;
    --publico) PUBLICO=1; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) if [ -z "$DOMINIO" ]; then DOMINIO="$1"; shift; else echo "Argumento no reconocido: $1"; exit 2; fi ;;
  esac
done
[ -z "$DOMINIO" ] && { sed -n '2,20p' "$0"; exit 2; }

DOMINIO="${DOMINIO#https://}"; DOMINIO="${DOMINIO%%/*}"
if [ -n "$DESPLIEGUE" ]; then
  DESPLIEGUE="${DESPLIEGUE%/}"
  case "$DESPLIEGUE" in http*://*) ;; *) DESPLIEGUE="https://$DESPLIEGUE" ;; esac
fi

CUERPO="$(mktemp)"; CABEZAS="$(mktemp)"
trap 'rm -f "$CUERPO" "$CABEZAS"' EXIT
FALLAS=0

# curl de Git Bash en Windows (schannel) necesita --ssl-no-revoke.
pedir() {  # pedir URL [args extra de curl...]  -> imprime el código HTTP
  local url="$1"; shift
  curl -s --ssl-no-revoke --max-time 30 -D "$CABEZAS" -o "$CUERPO" -w "%{http_code}" "$@" "$url"
}

fuga_de_datos() {  # 0 si la marca aparece en el último cuerpo
  [ -n "$MARCA" ] && grep -q -- "$MARCA" "$CUERPO" 2>/dev/null
}

va_a_access() { grep -qi "^location:.*cloudflareaccess\.com" "$CABEZAS"; }

cerrado() {  # NOMBRE CODIGO : cerrado = 302 a Access o 403, y sin la marca
  local nombre="$1" codigo="$2"
  if { { [ "$codigo" = "302" ] && va_a_access; } || [ "$codigo" = "403" ]; } && ! fuga_de_datos; then
    echo "OK     $codigo  cerrado  $nombre"
  else
    echo "FALLA  $codigo  esperaba 302 a Access o 403 sin datos  $nombre"
    FALLAS=$((FALLAS + 1))
  fi
}

if [ "$PUBLICO" = "1" ]; then
  code=$(pedir "https://$DOMINIO/")
  if [ "$code" = "200" ] && ! va_a_access; then
    echo "OK     $code  público  https://$DOMINIO/"
  else
    echo "FALLA  $code  esperaba 200 sin login  https://$DOMINIO/"
    FALLAS=$((FALLAS + 1))
  fi
else
  code=$(pedir "https://$DOMINIO/")
  if [ "$code" = "302" ] && va_a_access && ! fuga_de_datos; then
    echo "OK     $code  https://$DOMINIO/ -> Cloudflare Access"
  else
    echo "FALLA  $code  https://$DOMINIO/ debía redirigir a *.cloudflareaccess.com"
    FALLAS=$((FALLAS + 1))
  fi
  code=$(pedir "https://$DOMINIO/api/prueba" -X POST -H "Content-Type: application/json" -d '{}')
  cerrado "POST https://$DOMINIO/api/prueba (sin login)" "$code"

  if [ -n "$DESPLIEGUE" ]; then
    code=$(pedir "$DESPLIEGUE/");                cerrado "$DESPLIEGUE/" "$code"
    code=$(pedir "$DESPLIEGUE/api/prueba");      cerrado "$DESPLIEGUE/api/prueba" "$code"
    code=$(pedir "$DESPLIEGUE/" -H "Cf-Access-Authenticated-User-Email: alguien@ejemplo.com")
    cerrado "$DESPLIEGUE/ (encabezado de correo falsificado)" "$code"
    code=$(pedir "$DESPLIEGUE/" -H "Cf-Access-Jwt-Assertion: a.b.c")
    cerrado "$DESPLIEGUE/ (JWT falso)" "$code"
  else
    echo "AVISO  sin --despliegue: no se probó la URL <hash>.pages.dev del despliegue (donde ocurren las fugas)"
  fi
fi

if [ "$FALLAS" -eq 0 ]; then
  echo "RESULTADO: OK"
else
  echo "RESULTADO: $FALLAS falla(s)"
  exit 1
fi
