#!/usr/bin/env bash
# Deploys the game server (Worker + Durable Objects) and then the web app with the server URL baked in.
# Free plan only. Needs a workers.dev subdomain on the account
# (created the first time someone opens Workers & Pages in the Cloudflare dashboard).
#
# Auth — wrangler 3 reads the environment itself and skips `wrangler login` when a token is set:
#   Local: run `npx wrangler login` once, and leave CLOUDFLARE_API_TOKEN unset.
#   CI:    set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID (GitHub Actions secrets).
#          Non-interactive: no browser, and migration prompts auto-accept because CI=true.
set -euo pipefail
cd "$(dirname "$0")/.."

# Fail before npx downloads wrangler. A missing token in CI would otherwise try to
# open a browser login, which cannot succeed on a runner.
if [[ -n "${CI:-}" || -n "${GITHUB_ACTIONS:-}" ]]; then
  if [[ -z "${CLOUDFLARE_API_TOKEN:-}" || -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
    echo "✘ CI deploy needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID." >&2
    echo "  Add both as repository Actions secrets. Wrangler does not run \`wrangler login\` in CI." >&2
    exit 1
  fi
fi

W="npx --yes wrangler@3"

echo "▶ applying D1 migrations (accounts) to the remote database…"
(cd apps/server && $W d1 migrations apply bid-wit-me --remote)

echo "▶ deploying apps/server (bid-wit-me-server)…"
out=$(cd apps/server && $W deploy 2>&1 | tee /dev/stderr)
url=$(grep -oE 'https://bid-wit-me-server\.[a-z0-9-]+\.workers\.dev' <<<"$out" | head -1 || true)
if [[ -z "${url}" ]]; then echo "✘ couldn't find the workers.dev URL in the deploy output" >&2; exit 1; fi
echo "✓ server: $url"
curl -fsS "$url/health" && echo

echo "▶ building web with VITE_SERVER_URL=$url"
(cd apps/web && VITE_SERVER_URL="$url" npx vite build)

echo "▶ deploying Pages (bid-wit-me)…"
# run from apps/web so wrangler picks up its wrangler.toml (the API service binding) and functions/ (the /api proxy)
(cd apps/web && $W pages deploy dist --project-name=bid-wit-me --branch=main --commit-dirty=true)
echo "✓ done: https://bid-wit-me.pages.dev  ·  server $url"
