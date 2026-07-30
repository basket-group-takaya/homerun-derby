#!/usr/bin/env bash
#
# Publish to GitHub Pages.
#
#   bash tools/deploy.sh
#
# Run it yourself. It needs a GitHub login, and logging in on your behalf is the
# one thing this project's assistant is not allowed to do — so `gh auth login`
# has to come from you. Everything after that is automatic.
#
# BEFORE YOU RUN IT, read this once. The site is world-readable:
#
#   - assets/ holds likenesses of three named employees
#   - src/core/constants.ts holds their real names
#   - the batter wears the company logo on his back
#
# Permission to use those inside the company is not the same as permission to
# publish them to the open internet. If that is not what you want, the offline
# route in docs/PLAY-ON-PHONE.md needs no hosting at all, or say the word and
# this can go behind Cloudflare Access with an email allow-list instead.

set -euo pipefail
cd "$(dirname "$0")/.."

REPO="${REPO:-homerun-derby}"

if ! command -v gh >/dev/null 2>&1; then
  echo "gh (GitHub CLI) is not installed: https://cli.github.com/" >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "Not logged in. Run:  gh auth login" >&2
  exit 1
fi

echo "==> build (this also regenerates the service worker's precache list)"
npm run build

echo "==> tests"
npm test >/dev/null
echo "    all green"

echo "==> commit"
git add -A
git commit -m "deploy: $(git rev-parse --short HEAD 2>/dev/null || echo initial)" || true

if ! git remote get-url origin >/dev/null 2>&1; then
  echo "==> create the repository"
  gh repo create "$REPO" --public --source=. --push
else
  git push -u origin HEAD
fi

echo "==> turn on Pages"
OWNER="$(gh api user --jq .login)"
gh api -X POST "repos/$OWNER/$REPO/pages" \
  -f "source[branch]=$(git rev-parse --abbrev-ref HEAD)" \
  -f "source[path]=/" >/dev/null 2>&1 || \
gh api -X PUT "repos/$OWNER/$REPO/pages" \
  -f "source[branch]=$(git rev-parse --abbrev-ref HEAD)" \
  -f "source[path]=/" >/dev/null

echo
echo "Done. The URL takes a minute or two to go live:"
echo
echo "    https://$OWNER.github.io/$REPO/"
echo
echo "On the phone: open it, then Share -> Add to Home Screen."
echo "Then turn on airplane mode and open it again — if it plays, it is cached."
