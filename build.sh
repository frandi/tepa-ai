#!/usr/bin/env bash
set -euo pipefail

# Build packages that have changed since the last commit.
# Usage:
#   ./build.sh          # build only changed packages
#   ./build.sh --all    # build all packages

# Ordered by dependency: types first, then packages that depend on it.
PACKAGES=(
  "types"
  "tepa"
  "tools"
  "provider-anthropic"
  "provider-openai"
  "provider-gemini"
)

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_ALL=false

if [[ "${1:-}" == "--all" ]]; then
  BUILD_ALL=true
fi

# Detect which packages have changed (staged + unstaged + untracked) relative
# to HEAD.  Falls back to building everything when detection fails.
changed_packages() {
  local changed_files
  changed_files=$(git diff --name-only HEAD 2>/dev/null || true)
  changed_files+=$'\n'
  changed_files+=$(git diff --name-only --cached 2>/dev/null || true)
  changed_files+=$'\n'
  changed_files+=$(git ls-files --others --exclude-standard 2>/dev/null || true)

  local pkgs=()
  for pkg in "${PACKAGES[@]}"; do
    if echo "$changed_files" | grep -q "^packages/${pkg}/"; then
      pkgs+=("$pkg")
    fi
  done

  # If types changed, rebuild everything that depends on it
  if [[ " ${pkgs[*]} " == *" types "* ]]; then
    echo "${PACKAGES[*]}"
    return
  fi

  echo "${pkgs[*]}"
}

if $BUILD_ALL; then
  to_build=("${PACKAGES[@]}")
else
  read -ra to_build <<< "$(changed_packages)"
fi

if [[ ${#to_build[@]} -eq 0 || -z "${to_build[0]}" ]]; then
  echo "No packages to build."
  exit 0
fi

echo "Building: ${to_build[*]}"
echo ""

for pkg in "${to_build[@]}"; do
  echo "--- Building packages/$pkg ---"
  npm run build --workspace="packages/$pkg"
  echo ""
done

echo "Done."
