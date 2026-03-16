#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────
# tepa-ai · release pipeline orchestrator
#
# Runs the full release flow:
#   1. Generate & approve release notes
#   2. Deploy packages to npm (via deploy.sh)
#   3. Create git tag
#   4. Create GitHub Release with the approved notes
#
# Usage: release.sh [--dry-run]
# ─────────────────────────────────────────────────────────────

# ─── Parse flags ──────────────────────────────────────────────

DRY_RUN=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    -h|--help)
      echo "Usage: $0 [--dry-run]"
      echo ""
      echo "  --dry-run   Run release-notes generation and deploy in dry-run mode."
      echo "              No tags, releases, or npm publishes will be created."
      exit 0
      ;;
    *) echo "Unknown option: $arg"; exit 1 ;;
  esac
done

# ─── Load shared utilities ───────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

# ─── Pre-flight ──────────────────────────────────────────────

command -v gh >/dev/null 2>&1 || die "gh CLI is not installed. See https://cli.github.com"

header "tepa-ai Release Pipeline"

# ─── Step 1: Release notes ───────────────────────────────────

info "Step 1/4: Generate release notes"
echo ""

NOTES_FILE=$(mktemp -t release-notes-XXXXXX.md)

# Run release-notes.sh interactively — output file is passed via --output
# The script writes approved notes to NOTES_FILE and exits 0 on success
"$SCRIPT_DIR/release-notes.sh" --output "$NOTES_FILE"

if [[ ! -f "$NOTES_FILE" ]] || [[ ! -s "$NOTES_FILE" ]]; then
  die "Release notes file not found or empty: $NOTES_FILE"
fi

success "Release notes ready"

# ─── Step 2: Deploy to npm ───────────────────────────────────

info "Step 2/4: Deploy to npm"
echo ""

if $DRY_RUN; then
  "$SCRIPT_DIR/deploy.sh" --dry-run
else
  "$SCRIPT_DIR/deploy.sh"
fi

# ─── Step 3: Create git tag ──────────────────────────────────

header "Git tag"

# Read version from types package (version anchor — always deployed first)
# In normal mode, deploy.sh has already bumped the version in package.json.
# In dry-run mode, no bump occurred, so we ask the user what version to tag.
VERSION=$(get_pkg_version "packages/types")

if $DRY_RUN; then
  info "Current version in package.json: $VERSION"
  read -rp "$(echo -e "Enter the version to tag (e.g. ${BOLD}$VERSION${NC}): ")" input_version
  VERSION="${input_version:-$VERSION}"
fi

TAG="v$VERSION"

if git rev-parse "$TAG" >/dev/null 2>&1; then
  warn "Tag $TAG already exists — skipping tag creation"
else
  if $DRY_RUN; then
    info "Would create tag: $TAG (skipped in dry-run)"
  else
    git tag -a "$TAG" -m "Release $TAG"
    success "Created tag $TAG"
  fi
fi

# ─── Step 4: GitHub Release ──────────────────────────────────

header "GitHub Release"

if $DRY_RUN; then
  info "Would create GitHub Release: $TAG (skipped in dry-run)"
  echo -e "\n${BOLD}Release notes that would be published:${NC}\n"
  cat "$NOTES_FILE"
  echo ""
else
  gh release create "$TAG" \
    --title "$TAG" \
    --notes-file "$NOTES_FILE"
  success "Created GitHub Release $TAG"

  git push origin "$TAG"
  success "Pushed tag $TAG to remote"
fi

# ─── Cleanup ─────────────────────────────────────────────────

rm -f "$NOTES_FILE"

# ─── Summary ─────────────────────────────────────────────────

header "Release complete"

if $DRY_RUN; then
  echo -e "  ${YELLOW}▶${NC} Dry run — no changes were made"
  echo -e "  ${DIM}Version: $VERSION${NC}"
  echo -e "  ${DIM}Tag:     $TAG${NC}"
else
  echo -e "  ${GREEN}✔${NC} Published to npm"
  echo -e "  ${GREEN}✔${NC} Tagged ${BOLD}$TAG${NC}"
  echo -e "  ${GREEN}✔${NC} GitHub Release created"
  echo -e "  ${DIM}View: gh release view $TAG${NC}"
fi
