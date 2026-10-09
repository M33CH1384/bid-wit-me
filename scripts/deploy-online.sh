#!/usr/bin/env bash
# Deploys the game server (Worker + Durable Objects) and then the web app with the server URL baked in.
# Free plan only. Requires `wrangler login` and a workers.dev subdomain on the account
# (created the first time someone opens Workers & Pages in the Cloudflare dashboard).
set -euo pipefail
cd "$(dirname "$0")/.."
W="npx --yes wrangler@3"

echo "▶ deploying apps/server (bid-wit-me-server)…"
out=$(cd apps/server && $W deploy 2>&1 | tee /dev/stderr)
url=$(grep -oE 'https://bid-wit-me-server\.[a-z0-9-]+\.workers\.dev' <<<"$out" | head -1 || true)
if [[ -z "${url}" ]]; then echo "✘ couldn't find the workers.dev URL in the deploy output" >&2; exit 1; fi
echo "✓ server: $url"
curl -fsS "$url/health" && echo

echo "▶ building web with VITE_SERVER_URL=$url"
(cd apps/web && VITE_SERVER_URL="$url" npx vite build)

echo "▶ deploying Pages (bid-wit-me)…"
$W pages deploy apps/web/dist --project-name=bid-wit-me --branch=main --commit-dirty=true
echo "✓ done: https://bid-wit-me.pages.dev  ·  server $url"
