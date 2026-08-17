#!/usr/bin/env bash
# Build the full Yu's Atlas application:
#   1. build the Next.js frontend to a static export
#   2. copy it into the Go runtime's embedded assets directory
#   3. compile the Go runtime binary (native, for local testing)
#   4. cross-compile the Windows amd64 executable (Atlas.exe)
#
# Produces:
#   bin/atlas      — native binary (run it locally with -data examples/atlas-data)
#   bin/Atlas.exe  — portable Windows release (self-contained; data lives in a
#                    sibling atlas-data/ directory next to the executable)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GO="${GO:-go}"
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
touch "$ROOT/apps/runtime/assets/web/.gitkeep" # keep the tracked placeholder

echo "==> Building native Go runtime (for local testing)"
mkdir -p "$BIN_DIR"
(
  cd "$ROOT/apps/runtime"
  "$GO" build -o "$BIN_DIR/atlas" ./cmd/atlas
)

echo "==> Cross-compiling Windows amd64 executable (Atlas.exe)"
(
  cd "$ROOT/apps/runtime"
  CGO_ENABLED=0 GOOS=windows GOARCH=amd64 "$GO" build -trimpath -ldflags "-s -w" -o "$BIN_DIR/Atlas.exe" ./cmd/atlas
)

echo ""
echo "==> Done."
echo "    Native (this OS):  $BIN_DIR/atlas"
echo "    Windows release:   $BIN_DIR/Atlas.exe"
echo ""
echo "    Run native for local testing:"
echo "      $BIN_DIR/atlas -data $ROOT/examples/atlas-data"
