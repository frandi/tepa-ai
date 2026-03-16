#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# tepa-ai · shared shell utilities
# Sourced by deploy.sh, release-notes.sh, release.sh
# ─────────────────────────────────────────────────────────────

# Guard against double-sourcing
[[ -n "${_COMMON_SH_LOADED:-}" ]] && return 0
_COMMON_SH_LOADED=1

# ─── Root directory ──────────────────────────────────────────

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# ─── Colors ──────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m' # No Color

# ─── Helpers ─────────────────────────────────────────────────

info()    { echo -e "${BLUE}ℹ${NC} $*"; }
success() { echo -e "${GREEN}✔${NC} $*"; }
warn()    { echo -e "${YELLOW}⚠${NC} $*"; }
error()   { echo -e "${RED}✖${NC} $*"; }
header()  { echo -e "\n${BOLD}${CYAN}── $* ──${NC}\n"; }

die() { error "$@"; exit 1; }

# ─── Package helpers ─────────────────────────────────────────

get_pkg_name() { node -p "require('./$1/package.json').name"; }
get_pkg_version() { node -p "require('./$1/package.json').version"; }

# ─── Environment ─────────────────────────────────────────────

load_env() {
  if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
    local env_file="$ROOT_DIR/.env"
    if [[ -f "$env_file" ]]; then
      set -a
      # shellcheck disable=SC1090
      source "$env_file"
      set +a
    fi
  fi
}
