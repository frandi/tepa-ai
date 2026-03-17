#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────
# tepa-ai · release notes generator
#
# Collects merged PRs, lets you pick which to include,
# drafts release notes via Claude API, and opens an editor
# for final review.
#
# Usage: release-notes.sh [--since TAG] [--output FILE]
# ─────────────────────────────────────────────────────────────

# ─── Parse flags ──────────────────────────────────────────────

SINCE_TAG=""
OUTPUT_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --since)
      SINCE_TAG="$2"; shift 2 ;;
    --output)
      OUTPUT_FILE="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: $0 [--since TAG] [--output FILE]"
      echo ""
      echo "  --since TAG    Use TAG as the starting point (default: latest git tag)"
      echo "  --output FILE  Write release notes to FILE (default: temp file)"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ─── Load shared utilities ───────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

# ─── Pre-flight checks ───────────────────────────────────────

command -v gh >/dev/null 2>&1 || die "gh CLI is not installed. See https://cli.github.com"
command -v node >/dev/null 2>&1 || die "node is not installed"
command -v curl >/dev/null 2>&1 || die "curl is not installed"

# Verify gh is authenticated and we're in a GitHub repo
gh repo view --json nameWithOwner >/dev/null 2>&1 || die "Not in a GitHub repository, or gh is not authenticated"

# ─── Step 1: Collect merged PRs ──────────────────────────────

header "Collecting merged PRs"

if [[ -n "$SINCE_TAG" ]]; then
  LAST_TAG="$SINCE_TAG"
elif LAST_TAG=$(git describe --tags --abbrev=0 HEAD 2>/dev/null); then
  : # LAST_TAG is set
else
  LAST_TAG=""
fi

GH_ARGS=(
  --state merged
  --json "number,title,body,labels"
  --limit 100
)

if [[ -n "$LAST_TAG" ]]; then
  SINCE_DATE=$(git log -1 --format=%Y-%m-%d "$LAST_TAG")
  info "Last tag: ${BOLD}$LAST_TAG${NC} ($SINCE_DATE)"
  GH_ARGS+=(--search "merged:>=$SINCE_DATE")
else
  info "No previous tags found — collecting all merged PRs"
fi

PR_JSON=$(gh pr list "${GH_ARGS[@]}")

PR_COUNT=$(node -e "console.log(JSON.parse(process.argv[1]).length)" -- "$PR_JSON")

if [[ "$PR_COUNT" -eq 0 ]]; then
  die "No merged PRs found in this range"
fi

success "Found $PR_COUNT merged PR(s)"

# ─── Step 2: Extract metadata ────────────────────────────────

header "Extracting PR metadata"

PR_DATA=$(node -e "
  const prs = JSON.parse(process.argv[1]);
  const result = prs.map(pr => {
    // Extract ## What section (between ## What and next ## heading)
    const whatMatch = pr.body?.match(/## What\s*\n([\s\S]*?)(?=\n## |\$)/);
    let what = whatMatch ? whatMatch[1].replace(/<!--[\s\S]*?-->/g, '').trim() : '';

    // Extract checked Type of Change
    const typeMatch = pr.body?.match(/## Type of Change\s*\n([\s\S]*?)(?=\n## |\$)/);
    let changeType = 'Other';
    if (typeMatch) {
      const lines = typeMatch[1].split('\n');
      for (const line of lines) {
        if (/- \[x\]/i.test(line)) {
          changeType = line.replace(/- \[x\]\s*/i, '').replace(/<!--.*?-->/g, '').trim();
          break;
        }
      }
    }

    return {
      number: pr.number,
      title: pr.title,
      what: what || pr.title,
      changeType,
    };
  });
  console.log(JSON.stringify(result));
" -- "$PR_JSON")

success "Extracted metadata from $PR_COUNT PR(s)"

# ─── Step 3: Interactive selection ────────────────────────────

header "Select PRs for release notes"

# Initialize selection state (pre-check all except Documentation/Other)
SELECTION_STATE=$(node -e "
  const prs = JSON.parse(process.argv[1]);
  const state = prs.map(pr => {
    const skip = ['Documentation', 'Other'].some(t =>
      pr.changeType.toLowerCase().startsWith(t.toLowerCase())
    );
    return { ...pr, selected: !skip };
  });
  console.log(JSON.stringify(state));
" -- "$PR_DATA")

while true; do
  echo ""
  node -e "
    const prs = JSON.parse(process.argv[1]);
    prs.forEach((pr, i) => {
      const mark = pr.selected ? '\x1b[32m[x]\x1b[0m' : '[ ]';
      const num = String(i + 1).padStart(2);
      const type = '\x1b[2m(' + pr.changeType + ')\x1b[0m';
      console.log('  ' + num + ') ' + mark + '  #' + pr.number + '  ' + pr.title + ' ' + type);
    });
  " -- "$SELECTION_STATE"

  echo ""
  echo -e "  Enter numbers to toggle (e.g. ${BOLD}1 3${NC}), ${BOLD}a${NC}=all, ${BOLD}n${NC}=none, ${BOLD}d${NC}=done"
  read -rp "  > " input

  case "$input" in
    d|D|done)
      break ;;
    a|A)
      SELECTION_STATE=$(node -e "
        const prs = JSON.parse(process.argv[1]);
        prs.forEach(p => p.selected = true);
        console.log(JSON.stringify(prs));
      " -- "$SELECTION_STATE") ;;
    n|N)
      SELECTION_STATE=$(node -e "
        const prs = JSON.parse(process.argv[1]);
        prs.forEach(p => p.selected = false);
        console.log(JSON.stringify(prs));
      " -- "$SELECTION_STATE") ;;
    *)
      SELECTION_STATE=$(node -e "
        const prs = JSON.parse(process.argv[1]);
        const nums = process.argv[2].split(/[\s,]+/).map(Number).filter(n => n > 0 && n <= prs.length);
        nums.forEach(n => prs[n - 1].selected = !prs[n - 1].selected);
        console.log(JSON.stringify(prs));
      " -- "$SELECTION_STATE" "$input") ;;
  esac
done

# Filter to selected PRs
SELECTED_PRS=$(node -e "
  const prs = JSON.parse(process.argv[1]).filter(p => p.selected);
  console.log(JSON.stringify(prs));
" -- "$SELECTION_STATE")

SELECTED_COUNT=$(node -e "console.log(JSON.parse(process.argv[1]).length)" -- "$SELECTED_PRS")
[[ "$SELECTED_COUNT" -eq 0 ]] && die "No PRs selected"
success "Selected $SELECTED_COUNT PR(s)"

# ─── Step 4: Generate draft via Claude API ────────────────────

header "Generating release notes draft"

load_env
[[ -z "${ANTHROPIC_API_KEY:-}" ]] && die "ANTHROPIC_API_KEY not set. Export it or add to .env"

SYSTEM_PROMPT=$(cat "$SCRIPT_DIR/release-notes-prompt.md")

USER_MESSAGE=$(node -e "
  const prs = JSON.parse(process.argv[1]);
  let msg = 'Generate release notes for the following changes:\n\n';
  prs.forEach(pr => {
    msg += '---\n';
    msg += 'PR #' + pr.number + ': ' + pr.title + '\n';
    msg += 'Type: ' + pr.changeType + '\n';
    msg += 'Description: ' + pr.what + '\n\n';
  });
  console.log(msg);
" -- "$SELECTED_PRS")

# Write API payload to temp file to avoid ARG_MAX issues
PAYLOAD_FILE=$(mktemp)
trap 'rm -f "$PAYLOAD_FILE"' EXIT

node -e "
  const payload = {
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: process.argv[1],
    messages: [{ role: 'user', content: process.argv[2] }]
  };
  const fs = require('fs');
  fs.writeFileSync(process.argv[3], JSON.stringify(payload));
" -- "$SYSTEM_PROMPT" "$USER_MESSAGE" "$PAYLOAD_FILE"

info "Calling Claude API..."

RESPONSE=$(curl -s https://api.anthropic.com/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -d "@$PAYLOAD_FILE")

DRAFT=$(node -e "
  const resp = JSON.parse(process.argv[1]);
  if (resp.error) {
    console.error('API Error: ' + (resp.error.message || JSON.stringify(resp.error)));
    process.exit(1);
  }
  const text = resp.content?.find(c => c.type === 'text');
  if (!text) {
    console.error('No text content in API response');
    process.exit(1);
  }
  console.log(text.text);
" -- "$RESPONSE")

success "Draft generated"

# ─── Step 5: Human review ────────────────────────────────────

header "Review release notes"

OUTPUT_FILE="${OUTPUT_FILE:-$(mktemp -t release-notes-XXXXXX.md)}"
echo "$DRAFT" > "$OUTPUT_FILE"

echo -e "\n${BOLD}--- Draft Release Notes ---${NC}\n"
cat "$OUTPUT_FILE"
echo -e "\n${BOLD}--- End Draft ---${NC}\n"

EDITOR="${VISUAL:-${EDITOR:-vi}}"
read -rp "$(echo -e "Open in ${BOLD}$EDITOR${NC} to edit? (Y/n) ")" edit_yn
if [[ ! "$edit_yn" =~ ^[Nn]$ ]]; then
  "$EDITOR" "$OUTPUT_FILE"

  echo -e "\n${BOLD}--- Final Release Notes ---${NC}\n"
  cat "$OUTPUT_FILE"
  echo -e "\n${BOLD}--- End ---${NC}\n"
fi

read -rp "$(echo -e "${BOLD}Approve these release notes? (y/N)${NC} ")" approve
[[ "$approve" =~ ^[Yy]$ ]] || die "Release notes not approved — aborted"

success "Release notes saved to $OUTPUT_FILE"

# Print the output file path as the last line (for orchestrator to capture)
echo "$OUTPUT_FILE"
