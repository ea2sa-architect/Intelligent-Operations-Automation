#!/usr/bin/env bash
# Cookie-gated pre-cutover canary for ioa.ea2sa.com. Run ON gilbert (needs sudo).
#
#   canary-nginx.sh enable    # browsers holding the secret cookie get /api/ routed to the k8s cluster
#   canary-nginx.sh disable   # remove the canary completely (also the rollback)
#   canary-nginx.sh status
#
# Everyone without the cookie keeps hitting live (phoenix:8000), exactly as before. The SPA is the same
# static build for both, so this exercises the real production UI against the cluster. Use a PRIVATE
# window: login cookies are set at path / on the same host and would otherwise replace your live session.
#
# Safety: backs up the site file first, validates with `nginx -t` before reloading, and restores the
# backup + removes its files if validation fails. The secret lives only in root-readable nginx files
# (mode 640) and in $LINK_FILE (mode 600); it is never printed.
#
# Limitation: n8n cloud calls back to https://ioa.ea2sa.com/... without the cookie, so workflow-analysis
# callbacks still land on LIVE during the canary; those jobs will look pending on the cluster side.
set -euo pipefail

SITE="${SITE:-/etc/nginx/sites-available/ioa.ea2sa.com.conf}"
CONFD="${CONFD:-/etc/nginx/conf.d}"
SNIP="${SNIP:-/etc/nginx/snippets}"
LIVE_UPSTREAM="${LIVE_UPSTREAM:-phoenix:8000}"
K8S_UPSTREAM="${K8S_UPSTREAM:-phoenix:18080}"
HOST="${HOST:-ioa.ea2sa.com}"
SUDO="${SUDO-sudo}"
NGINX="${NGINX:-/usr/sbin/nginx}"
RELOAD="${RELOAD:-systemctl reload nginx}"
LINK_FILE="${LINK_FILE:-$HOME/ioa-k8s-canary-link.txt}"
CONF="$CONFD/ioa-k8s-canary.conf"
SNIPPET="$SNIP/ioa-k8s-canary.conf"

enabled() { grep -q 'ioa_backend' "$SITE"; }
validate_and_reload() { $SUDO $NGINX -t >/dev/null 2>&1 && $SUDO $RELOAD; }

patch_site() { # patch_site enable|disable
  $SUDO python3 - "$SITE" "$1" "$LIVE_UPSTREAM" <<'PY'
import re, sys
path, mode, live = sys.argv[1:4]
s = open(path).read()
marker = '    # ------------------------------------------------------------\n    # API REVERSE PROXY'
inc = ('    # Pre-cutover canary: cookie-gated routing of /api/ to the k8s cluster (conf.d/ioa-k8s-canary.conf)\n'
       '    include /etc/nginx/snippets/ioa-k8s-canary.conf;\n\n')
live_re = re.compile(r'(proxy_pass\s+)http://' + re.escape(live) + ';')
if mode == 'enable':
    assert len(live_re.findall(s)) == 1, 'expected exactly one proxy_pass to the live upstream'
    assert s.count(marker) == 1, 'unexpected site layout (API REVERSE PROXY marker)'
    s = live_re.sub(r'\1http://$ioa_backend;', s, count=1)
    s = s.replace(marker, inc + marker, 1)
else:
    assert s.count(inc) == 1, 'canary include block not found'
    s = s.replace(inc, '', 1)
    s = s.replace('proxy_pass         http://$ioa_backend;', 'proxy_pass         http://' + live + ';', 1)
open(path, 'w').write(s)
PY
}

write_conf() { # write_conf <secret>
  $SUDO tee "$CONF" >/dev/null <<EOF
# Cookie-gated canary: a browser holding the secret cookie gets /api/ sent to the k8s cluster; all others -> live.
upstream ioa_api_live { server $LIVE_UPSTREAM; }
upstream ioa_api_k8s  { server $K8S_UPSTREAM; }
map \$cookie_ioa_env \$ioa_backend {
    default            ioa_api_live;
    "$1"          ioa_api_k8s;
}
EOF
  $SUDO tee "$SNIPPET" >/dev/null <<EOF
location = /_k8s-enter {
    if (\$arg_t != "$1") { return 404; }
    add_header Set-Cookie "ioa_env=$1; Path=/; Max-Age=28800; Secure; HttpOnly; SameSite=Lax" always;
    add_header Cache-Control "no-store" always;
    return 302 /;
}
location = /_k8s-exit {
    add_header Set-Cookie "ioa_env=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax" always;
    add_header Cache-Control "no-store" always;
    return 302 /;
}
EOF
  $SUDO chmod 640 "$CONF" "$SNIPPET"
}

case "${1:-status}" in
  status)
    if enabled; then echo "canary: ENABLED  (link file: $LINK_FILE)"; else echo "canary: disabled"; fi ;;

  enable)
    if enabled; then echo "already enabled" >&2; exit 1; fi
    ts="$(date +%Y%m%d%H%M%S)"; bak="$SITE.bak-$ts-pre-canary"
    $SUDO cp -p "$SITE" "$bak"; echo "backup: $bak"
    secret="$(openssl rand -hex 12)"   # 24 chars: fits nginx's default map_hash_bucket_size (48 did not)
    $SUDO mkdir -p "$SNIP"
    write_conf "$secret"
    if patch_site enable && validate_and_reload; then
      ( umask 077; printf 'https://%s/_k8s-enter?t=%s\n' "$HOST" "$secret" > "$LINK_FILE" )
      echo "ENABLED. Open the link in a PRIVATE window:  cat $LINK_FILE"
      echo "Leave that session with https://$HOST/_k8s-exit, or run: $0 disable"
    else
      echo "FAILED — rolling back" >&2
      $SUDO cp -p "$bak" "$SITE"; $SUDO rm -f "$CONF" "$SNIPPET"
      validate_and_reload || true
      exit 1
    fi ;;

  disable)
    if ! enabled; then echo "not enabled"; exit 0; fi
    ts="$(date +%Y%m%d%H%M%S)"; bak="$SITE.bak-$ts-pre-canary-disable"
    $SUDO cp -p "$SITE" "$bak"
    if patch_site disable && validate_and_reload; then
      $SUDO rm -f "$CONF" "$SNIPPET"; rm -f "$LINK_FILE"
      echo "canary removed; live config restored (backup of the previous state: $bak)"
    else
      echo "FAILED — restoring previous state" >&2
      $SUDO cp -p "$bak" "$SITE"; validate_and_reload || true
      exit 1
    fi ;;

  *) echo "usage: $0 enable|disable|status" >&2; exit 2 ;;
esac
