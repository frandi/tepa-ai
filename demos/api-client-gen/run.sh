#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "Cleaning previous output..."
rm -rf my-project/src/api

echo "Running demo..."
npx tsx src/index.ts
