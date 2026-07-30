#!/usr/bin/env bash
#
# Publish to GitHub Pages.
#
#   bash tools/deploy.sh
#
# Run it yourself. It needs a GitHub login, and this project's assistant is not
# allowed to create or push to public repositories on your behalf.
#
# WHAT GETS PUBLISHED, and it is worth reading once. The site is world-readable:
#
#   - assets/ holds likenesses of three named employees
#   - src/core/constants.ts holds their real names
#   - the batter wears the company logo on his back
#
# Permission to use those inside the company is not permission to publish them
# to the open internet. If that is not what you want, docs/PLAY-ON-PHONE.md has
# an offline route that needs no hosting at all, or this can go behind
# Cloudflare Access with an email allow-list instead.
#
# WHY IT PUBLISHES A SEPARATE BRANCH. GitHub Pages serves the repository as-is,
# and the two things the game cannot run without — the compiled dist/ and the
# extracted character art — are both in .gitignore, because they are build
# output and the source repository is right not to carry them. The first attempt
# at this deployed master and produced a site that 404'd on its own entry point.
# So the site is assembled here and force-pushed to gh-pages: master stays a
# source tree, gh-pages is exactly what a browser needs, and neither can drift
# from the other because this script rebuilds both every time.

set -euo pipefail
cd "$(dirname "$0")/.."

REPO="${REPO:-homerun-derby}"
STAGE=".publish"

command -v gh >/dev/null 2>&1 || { echo "gh is not installed: https://cli.github.com/" >&2; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Not logged in. Run:  gh auth login" >&2; exit 1; }

echo "==> build (this also regenerates the service worker's precache list)"
npm run build

echo "==> tests"
npm test >/dev/null
echo "    all green"

echo "==> commit the source"
git add -A
git commit -qm "deploy: $(date +%Y-%m-%d)" || true

OWNER="$(gh api user --jq .login)"
if ! git remote get-url origin >/dev/null 2>&1; then
  echo "==> create the repository"
  gh repo create "$REPO" --public --source=. --push
else
  git push -q -u origin HEAD
fi

echo "==> assemble the site"
rm -rf "$STAGE"
mkdir -p "$STAGE"
cp index.html manifest.webmanifest sw.js "$STAGE/"
touch "$STAGE/.nojekyll"
cp -r dist "$STAGE/dist"
cp -r assets "$STAGE/assets"
rm -rf "$STAGE/dist/tests" "$STAGE/assets/src"

# Every file the service worker promises to cache has to be here. addAll is
# atomic: one missing entry and NOTHING is cached, and the failure only shows up
# away from the network, which is the one place it cannot be diagnosed.
MISSING=0
while IFS= read -r f; do
  [ -e "$STAGE/$f" ] || { echo "    MISSING: $f" >&2; MISSING=$((MISSING + 1)); }
done < <(grep -oE "'\./[^']+'" sw.js | tr -d "'" | sed 's|^\./||' | grep -v '^$')
if [ "$MISSING" -gt 0 ]; then
  echo "$MISSING precached files are not in the site. Aborting." >&2
  exit 1
fi
echo "    $(find "$STAGE" -type f | wc -l) files, precache complete"

echo "==> push gh-pages"
(
  cd "$STAGE"
  git init -q
  git add -A
  git -c user.email=deploy@local -c user.name=deploy commit -qm "site $(date +%Y-%m-%dT%H:%M)"
  git push -q -f "https://github.com/$OWNER/$REPO.git" HEAD:gh-pages
)
rm -rf "$STAGE"

echo "==> point Pages at gh-pages"
BODY='{"source":{"branch":"gh-pages","path":"/"}}'
printf '%s' "$BODY" | gh api -X POST "repos/$OWNER/$REPO/pages" --input - >/dev/null 2>&1 \
  || printf '%s' "$BODY" | gh api -X PUT "repos/$OWNER/$REPO/pages" --input - >/dev/null

echo "==> waiting for the build"
for _ in $(seq 1 40); do
  STATE="$(gh api "repos/$OWNER/$REPO/pages" --jq .status 2>/dev/null || echo '')"
  if [ "$STATE" = "built" ]; then break; fi
  sleep 6
done

echo
echo "Done:"
echo
echo "    https://$OWNER.github.io/$REPO/"
echo
echo "On the phone: open it, then Share -> Add to Home Screen."
echo "Then turn on airplane mode and open it again. If it plays, it is cached;"
echo "if it does not, it was never going to work away from the house."
