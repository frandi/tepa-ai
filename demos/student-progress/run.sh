#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "Cleaning previous output..."
rm -f class-5b/progress_report.md class-5b/progress-report.md
rm -f class-5b/flagged_students.csv class-5b/flagged-students.csv

echo "Running demo..."
npx tsx src/index.ts
