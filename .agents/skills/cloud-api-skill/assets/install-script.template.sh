#!/usr/bin/env bash
# Optional Linux Node-project example. Keep an existing verified install script.
set -eu

command -v git >/dev/null || { echo 'MISSING: git'; exit 1; }
repo_root=$(git rev-parse --show-toplevel) || exit 1
cd "$repo_root"
command -v node >/dev/null || { echo 'MISSING: project-approved Node runtime'; exit 1; }
node --version

# Review package.json engines/packageManager and project instructions before use.
families=0
manager=''
if [[ -f bun.lock || -f bun.lockb ]]; then families=$((families+1)); manager='bun'; fi
if [[ -f package-lock.json || -f npm-shrinkwrap.json ]]; then families=$((families+1)); manager='npm'; fi
if [[ -f pnpm-lock.yaml ]]; then families=$((families+1)); manager='pnpm'; fi
if [[ -f yarn.lock ]]; then families=$((families+1)); manager='yarn'; fi
[[ "$families" -eq 1 ]] || { echo 'REVIEW: require one project lockfile family'; exit 1; }

case "$manager" in
  bun) command -v bun >/dev/null || { echo 'MISSING: project-approved Bun'; exit 1; }; bun install --frozen-lockfile ;;
  npm) command -v npm >/dev/null || { echo 'MISSING: project-approved npm'; exit 1; }; npm ci ;;
  pnpm) command -v pnpm >/dev/null || { echo 'MISSING: project-approved pnpm'; exit 1; }; pnpm install --frozen-lockfile ;;
  yarn) echo 'REVIEW: use repository Yarn version and its locked-install command'; exit 1 ;;
esac

# No API-key values, proxy credentials, browser passwords or deployment in setup logs.
