#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────
# tepa-ai · npm deployment script
# ─────────────────────────────────────────────────────────────

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# ─── Parse flags ──────────────────────────────────────────────

DRY_RUN=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    -h|--help)
      echo "Usage: $0 [--dry-run]"
      echo ""
      echo "  --dry-run   Run all checks and show what would be published,"
      echo "              but don't actually publish, bump versions, or commit."
      exit 0
      ;;
    *) echo "Unknown option: $arg"; exit 1 ;;
  esac
done

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m' # No Color

# Publishable packages in dependency order
# (types first, then provider-core, then the rest)
ORDERED_PACKAGES=(
  "packages/types"
  "packages/provider-core"
  "packages/tepa"
  "packages/tools"
  "packages/provider-anthropic"
  "packages/provider-openai"
  "packages/provider-gemini"
)

# ─── Helpers ──────────────────────────────────────────────────

info()    { echo -e "${BLUE}ℹ${NC} $*"; }
success() { echo -e "${GREEN}✔${NC} $*"; }
warn()    { echo -e "${YELLOW}⚠${NC} $*"; }
error()   { echo -e "${RED}✖${NC} $*"; }
header()  { echo -e "\n${BOLD}${CYAN}── $* ──${NC}\n"; }

get_pkg_name() { node -p "require('./$1/package.json').name"; }
get_pkg_version() { node -p "require('./$1/package.json').version"; }

die() { error "$@"; exit 1; }

if $DRY_RUN; then
  echo -e "\n${BOLD}${YELLOW}▶ DRY RUN MODE — nothing will be published, bumped, or committed${NC}"
fi

# ─── Pre-flight checks ───────────────────────────────────────

header "Pre-flight checks"

# Node & npm
command -v node >/dev/null 2>&1 || die "node is not installed"
command -v npm  >/dev/null 2>&1 || die "npm is not installed"
info "Node $(node -v) · npm $(npm -v)"

# npm auth
if ! npm whoami &>/dev/null; then
  if $DRY_RUN; then
    warn "Not logged in to npm (skipped in dry-run)"
    NPM_USER="(not logged in)"
  else
    die "Not logged in to npm. Run 'npm login' first."
  fi
else
  NPM_USER=$(npm whoami)
  success "Logged in to npm as ${BOLD}$NPM_USER${NC}"
fi

# Git status
if [[ -n "$(git status --porcelain)" ]]; then
  warn "Working directory is not clean:"
  git status --short
  echo ""
  read -rp "Continue anyway? (y/N) " yn
  [[ "$yn" =~ ^[Yy]$ ]] || exit 0
else
  success "Git working directory is clean"
fi

# ─── Package selection ────────────────────────────────────────

header "Package selection"

echo -e "Select packages to deploy:\n"
echo -e "  ${BOLD}0)${NC} All packages"
for i in "${!ORDERED_PACKAGES[@]}"; do
  pkg_dir="${ORDERED_PACKAGES[$i]}"
  name=$(get_pkg_name "$pkg_dir")
  version=$(get_pkg_version "$pkg_dir")
  echo -e "  ${BOLD}$((i+1)))${NC} $name ${DIM}(v$version)${NC}"
done

echo ""
read -rp "Enter numbers separated by spaces (e.g. 1 3 5), or 0 for all: " selection

SELECTED=()
if [[ "$selection" == *"0"* ]]; then
  SELECTED=("${ORDERED_PACKAGES[@]}")
else
  for num in $selection; do
    idx=$((num - 1))
    if [[ $idx -ge 0 && $idx -lt ${#ORDERED_PACKAGES[@]} ]]; then
      SELECTED+=("${ORDERED_PACKAGES[$idx]}")
    else
      die "Invalid selection: $num"
    fi
  done
fi

[[ ${#SELECTED[@]} -eq 0 ]] && die "No packages selected"

# ─── Version bump ─────────────────────────────────────────────

header "Version bump"

echo -e "How do you want to handle versions?\n"
echo -e "  ${BOLD}1)${NC} Patch  (0.1.0 → 0.1.1)"
echo -e "  ${BOLD}2)${NC} Minor  (0.1.0 → 0.2.0)"
echo -e "  ${BOLD}3)${NC} Major  (0.1.0 → 1.0.0)"
echo -e "  ${BOLD}4)${NC} Custom version"
echo -e "  ${BOLD}5)${NC} Keep current versions (no bump)"
echo ""
read -rp "Choice [1-5]: " bump_choice

BUMP_TYPE=""
CUSTOM_VERSION=""
case "$bump_choice" in
  1) BUMP_TYPE="patch" ;;
  2) BUMP_TYPE="minor" ;;
  3) BUMP_TYPE="major" ;;
  4)
    read -rp "Enter version (e.g. 1.0.0-beta.1): " CUSTOM_VERSION
    [[ -z "$CUSTOM_VERSION" ]] && die "No version provided"
    ;;
  5) BUMP_TYPE="none" ;;
  *) die "Invalid choice" ;;
esac

# Compute new versions
declare -A NEW_VERSIONS
for pkg_dir in "${SELECTED[@]}"; do
  current=$(get_pkg_version "$pkg_dir")
  if [[ "$BUMP_TYPE" == "none" ]]; then
    NEW_VERSIONS[$pkg_dir]="$current"
  elif [[ -n "$CUSTOM_VERSION" ]]; then
    NEW_VERSIONS[$pkg_dir]="$CUSTOM_VERSION"
  else
    # Use node for semver bump
    NEW_VERSIONS[$pkg_dir]=$(node -e "
      const v = '$current'.split('.');
      if ('$BUMP_TYPE' === 'patch') v[2] = parseInt(v[2]) + 1;
      if ('$BUMP_TYPE' === 'minor') { v[1] = parseInt(v[1]) + 1; v[2] = 0; }
      if ('$BUMP_TYPE' === 'major') { v[0] = parseInt(v[0]) + 1; v[1] = 0; v[2] = 0; }
      console.log(v.join('.'));
    ")
  fi
done

# ─── Sanity checks ────────────────────────────────────────────

header "Sanity checks"

# Run tests
info "Running tests..."
if npm test --silent 2>&1; then
  success "Tests passed"
else
  error "Tests failed"
  read -rp "Continue despite test failure? (y/N) " yn
  [[ "$yn" =~ ^[Yy]$ ]] || exit 1
fi

# Build all selected packages
info "Building packages..."
BUILD_FAILED=false
for pkg_dir in "${SELECTED[@]}"; do
  name=$(get_pkg_name "$pkg_dir")
  if npm run build -w "$pkg_dir" --silent 2>&1; then
    success "Built $name"
  else
    error "Failed to build $name"
    BUILD_FAILED=true
  fi
done
$BUILD_FAILED && die "Build failures detected. Fix before deploying."

# Verify dist/ exists for each selected package
for pkg_dir in "${SELECTED[@]}"; do
  name=$(get_pkg_name "$pkg_dir")
  if [[ ! -d "$pkg_dir/dist" ]]; then
    die "No dist/ directory for $name — build may have failed"
  fi
  success "Verified dist/ for $name"
done

# Check if versions already exist on npm
info "Checking for version conflicts on npm..."
for pkg_dir in "${SELECTED[@]}"; do
  name=$(get_pkg_name "$pkg_dir")
  version="${NEW_VERSIONS[$pkg_dir]}"
  existing=$(npm view "$name@$version" version 2>/dev/null || echo "")
  if [[ -n "$existing" ]]; then
    die "$name@$version already exists on npm. Bump the version."
  fi
done
success "No version conflicts found"

# ─── Final confirmation ───────────────────────────────────────

header "Deployment summary"

echo -e "${BOLD}The following packages will be published to npm:${NC}\n"
printf "  %-30s %-12s → %-12s\n" "PACKAGE" "CURRENT" "NEW"
printf "  %-30s %-12s   %-12s\n" "───────" "───────" "───"
for pkg_dir in "${SELECTED[@]}"; do
  name=$(get_pkg_name "$pkg_dir")
  current=$(get_pkg_version "$pkg_dir")
  new="${NEW_VERSIONS[$pkg_dir]}"
  if [[ "$current" == "$new" ]]; then
    printf "  %-30s %-12s   ${DIM}(no change)${NC}\n" "$name" "$current"
  else
    printf "  %-30s %-12s → ${GREEN}%-12s${NC}\n" "$name" "$current" "$new"
  fi
done

echo ""
echo -e "  ${DIM}Registry:${NC}  https://registry.npmjs.org"
echo -e "  ${DIM}User:${NC}      $NPM_USER"
echo -e "  ${DIM}Access:${NC}    public"
echo ""

if $DRY_RUN; then
  echo -e "${BOLD}${YELLOW}▶ DRY RUN COMPLETE — no changes were made${NC}\n"
  exit 0
fi

read -rp "$(echo -e "${BOLD}Proceed with deployment? (y/N)${NC} ")" confirm
[[ "$confirm" =~ ^[Yy]$ ]] || { info "Deployment cancelled."; exit 0; }

# ─── Apply version bumps ─────────────────────────────────────

if [[ "$BUMP_TYPE" != "none" ]]; then
  header "Applying version bumps"

  # Build a JSON map of package name → new version
  VERSION_MAP="{"
  first=true
  for pkg_dir in "${SELECTED[@]}"; do
    name=$(get_pkg_name "$pkg_dir")
    new="${NEW_VERSIONS[$pkg_dir]}"
    $first || VERSION_MAP+=","
    VERSION_MAP+="\"$name\":\"$new\""
    first=false
  done
  VERSION_MAP+="}"

  # Update version + sync inter-package dependency versions across ALL packages
  for pkg_dir in "${ORDERED_PACKAGES[@]}"; do
    name=$(get_pkg_name "$pkg_dir")
    node -e "
      const fs = require('fs');
      const pkgPath = './$pkg_dir/package.json';
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const versionMap = $VERSION_MAP;

      // Bump this package's own version if it's selected
      if (versionMap[pkg.name]) {
        pkg.version = versionMap[pkg.name];
      }

      // Sync inter-package dependency versions
      for (const depType of ['dependencies', 'peerDependencies']) {
        if (!pkg[depType]) continue;
        for (const dep of Object.keys(pkg[depType])) {
          if (versionMap[dep]) {
            pkg[depType][dep] = '^' + versionMap[dep];
          }
        }
      }

      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    "
    success "$name → v$(get_pkg_version "$pkg_dir")"
  done

  success "Synced inter-package dependency versions"
fi

# ─── Publish ──────────────────────────────────────────────────

header "Publishing to npm"

PUBLISHED_NAMES=()
PUBLISHED_VERSIONS=()
FAILED_NAMES=()
FAILED_VERSIONS=()

for pkg_dir in "${SELECTED[@]}"; do
  name=$(get_pkg_name "$pkg_dir")
  new="${NEW_VERSIONS[$pkg_dir]}"

  echo -e "\n${BLUE}▸${NC} Publishing ${BOLD}$name@$new${NC}..."

  if npm publish -w "$pkg_dir" --access public 2>&1; then
    success "Published $name@$new"
    PUBLISHED_NAMES+=("$name")
    PUBLISHED_VERSIONS+=("$new")
  else
    error "Failed to publish $name@$new"
    FAILED_NAMES+=("$name")
    FAILED_VERSIONS+=("$new")
    read -rp "Continue with remaining packages? (y/N) " yn
    [[ "$yn" =~ ^[Yy]$ ]] || break
  fi
done

# ─── Verification ─────────────────────────────────────────────

header "Verification"

if [[ ${#PUBLISHED_NAMES[@]} -gt 0 ]]; then
  info "Waiting a few seconds for npm registry to update..."
  sleep 5

  for i in "${!PUBLISHED_NAMES[@]}"; do
    name="${PUBLISHED_NAMES[$i]}"
    version="${PUBLISHED_VERSIONS[$i]}"
    # Query npm registry directly
    registry_version=$(npm view "$name@$version" version 2>/dev/null || echo "")
    if [[ "$registry_version" == "$version" ]]; then
      success "Verified $name@$version on npm registry"
    else
      warn "Could not verify $name@$version yet (may take a minute to propagate)"
    fi
  done
fi

# ─── Git commit (optional) ────────────────────────────────────

if [[ "$BUMP_TYPE" != "none" && ${#PUBLISHED_NAMES[@]} -gt 0 ]]; then
  echo ""
  read -rp "$(echo -e "Create a git commit for version bumps? (y/N) ")" git_commit
  if [[ "$git_commit" =~ ^[Yy]$ ]]; then
    COMMIT_MSG="chore: release"
    for i in "${!PUBLISHED_NAMES[@]}"; do
      COMMIT_MSG="$COMMIT_MSG ${PUBLISHED_NAMES[$i]}@${PUBLISHED_VERSIONS[$i]}"
    done
    git add -A
    git commit -m "$COMMIT_MSG"
    success "Created commit: $COMMIT_MSG"

    read -rp "$(echo -e "Push to remote? (y/N) ")" git_push
    if [[ "$git_push" =~ ^[Yy]$ ]]; then
      git push
      success "Pushed to remote"
    fi
  fi
fi

# ─── Summary ──────────────────────────────────────────────────

header "Done"

if [[ ${#PUBLISHED_NAMES[@]} -gt 0 ]]; then
  echo -e "${GREEN}Successfully published:${NC}"
  for i in "${!PUBLISHED_NAMES[@]}"; do
    echo -e "  ${GREEN}✔${NC} ${PUBLISHED_NAMES[$i]}@${PUBLISHED_VERSIONS[$i]}"
  done
fi

if [[ ${#FAILED_NAMES[@]} -gt 0 ]]; then
  echo -e "\n${RED}Failed to publish:${NC}"
  for i in "${!FAILED_NAMES[@]}"; do
    echo -e "  ${RED}✖${NC} ${FAILED_NAMES[$i]}@${FAILED_VERSIONS[$i]}"
  done
  exit 1
fi
