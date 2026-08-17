#!/usr/bin/env bash
# Build the full Yu's Atlas application:
#   1. build the Next.js frontend to a static export
#   2. copy it into the Go runtime's embedded assets directory
#   3. compile the Go runtime binary
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GO="go"
BIN_DIR="$ROOT/bin"

echo "==> Building frontend (Next.js static export)"
(
  cd "$ROOT/apps/web"
  pnpm install --frozen-lockfile
  pnpm run build
)

echo "==> Copying frontend into runtime embed directory"
rm -rf "$ROOT/apps/runtime/assets/web"
mkdir -p "$ROOT/apps/runtime/assets/web"
cp -r "$ROOT/apps/web/out/." "$ROOT/apps/runtime/assets/web/"

echo "==> Building Go runtime"
mkdir -p "$BIN_DIR"
(
  cd "$ROOT/apps/runtime"
  "$GO" build -o "$BIN_DIR/atlas" ./cmd/atlas
)

echo "==> Done. Binary at $BIN_DIR/atlas"
echo "    Run: $BIN_DIR/atlas -data $ROOT/examples/atlas-data"
