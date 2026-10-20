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

# TEMPORARY one-time bootstrap — remove once /api/push/vapid-key answers 200.
# The Worker needs VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT secrets
# for Web Push and the owner cannot set them by hand, so set them here, inside
# the one pipeline that already holds Cloudflare credentials.
# Idempotency guard: if the key endpoint already answers 200, do nothing —
# rotating keys after browsers have subscribed would orphan every existing
# subscription. The private key is generated in this shell, piped straight to
# `wrangler secret put`, and never echoed.
echo "▶ checking Web Push (VAPID) configuration…"
vapid_code=$(curl -s -o /dev/null -w '%{http_code}' https://bid-wit-me.pages.dev/api/push/vapid-key || echo 000)
if [[ "$vapid_code" == "200" ]]; then
  echo "✓ VAPID already configured, skipping bootstrap"
elif [[ "$vapid_code" == "000" ]]; then
  echo "⚠ could not reach the vapid-key endpoint — skipping VAPID bootstrap this run"
else
  echo "VAPID endpoint returned HTTP $vapid_code — generating a fresh key pair"
  vapid_keys=$(npx -y web-push generate-vapid-keys 2>/dev/null)
  vapid_pub=$(printf '%s' "$vapid_keys" | grep -oE '\b[A-Za-z0-9_-]{87}\b' | head -1 || true)
  vapid_priv=$(printf '%s' "$vapid_keys" | grep -oE '\b[A-Za-z0-9_-]{43}\b' | head -1 || true)
  if [[ -z "$vapid_pub" || -z "$vapid_priv" ]]; then echo "✘ failed to generate a VAPID key pair" >&2; exit 1; fi
  echo "Public key: $vapid_pub"
  (cd apps/server && printf '%s' "$vapid_pub" | $W secret put VAPID_PUBLIC_KEY)
  (cd apps/server && printf '%s' "$vapid_priv" | $W secret put VAPID_PRIVATE_KEY)
  (cd apps/server && printf '%s' 'mailto:demetrius@bidwitme.com' | $W secret put VAPID_SUBJECT)
  echo "✓ VAPID secrets set on bid-wit-me-server"
fi
