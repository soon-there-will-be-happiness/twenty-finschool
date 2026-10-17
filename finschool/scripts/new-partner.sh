#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

SLUG="${1:-}"
DOMAIN="${2:-}"
HOST_PORT="${3:-}"
SSO_PORT="${4:-}"

if [[ -z "$SLUG" || -z "$DOMAIN" ]]; then
  echo "Usage: $0 <slug> <https-host-or-url> [host_port] [sso_port]"
  echo "Example: $0 acme crm-acme.finschool.pro 3101 3199"
  exit 1
fi

if [[ "$DOMAIN" != http://* && "$DOMAIN" != https://* ]]; then
  DOMAIN="https://${DOMAIN}"
fi

DEST="$ROOT/partners/$SLUG"
if [[ -e "$DEST" ]]; then
  echo "Partner dir already exists: $DEST"
  exit 1
fi

cp -R "$ROOT/partners/_template" "$DEST"
# drop template readme noise
rm -f "$DEST/README.md"

HOST_PORT="${HOST_PORT:-3000}"
SSO_PORT="${SSO_PORT:-3099}"

sed \
  -e "s/PARTNER_SLUG/${SLUG}/g" \
  -e "s|https://crm-PARTNER_SLUG.finschool.pro|${DOMAIN}|g" \
  -e "s/^HOST_PORT=.*/HOST_PORT=${HOST_PORT}/" \
  -e "s/^SSO_HOST_PORT=.*/SSO_HOST_PORT=${SSO_PORT}/" \
  "$DEST/.env.example" > "$DEST/.env.example.tmp"
mv "$DEST/.env.example.tmp" "$DEST/.env.example"
cp "$DEST/.env.example" "$DEST/.env"

# Generate secrets if openssl available
if command -v openssl >/dev/null 2>&1; then
  APP_SECRET="$(openssl rand -hex 32)"
  ENC_KEY="$(openssl rand -base64 32)"
  if [[ "$(uname)" == Darwin ]]; then
    sed -i '' -e "s/^APP_SECRET=.*/APP_SECRET=${APP_SECRET}/" -e "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=${ENC_KEY}|" "$DEST/.env"
  else
    sed -i -e "s/^APP_SECRET=.*/APP_SECRET=${APP_SECRET}/" -e "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=${ENC_KEY}|" "$DEST/.env"
  fi
fi

cat > "$DEST/README.md" <<EOF
# Partner: ${SLUG}

- URL: ${DOMAIN}
- Ports: CRM ${HOST_PORT}, SSO ${SSO_PORT}

\`\`\`bash
cd $(dirname "$DEST")/../..
# or from this directory:
docker compose -f ../../compose/docker-compose.yml -f docker-compose.override.yml --env-file .env up -d
\`\`\`
EOF

echo "Created $DEST"
echo "Edit $DEST/.env then bring the stack up."
