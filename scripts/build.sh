#!/usr/bin/env bash
# Build the Odyssey runtime with the frontend embedded:
#   1. build the Next.js frontend to a static export
#   2. copy it into the Go runtime's embedded assets directory
#   3. compile the Go runtime for this machine
#
# Produces:
#   bin/atlas  — native binary (bin/atlas.exe on Windows) for local testing:
#                run it with -data examples/atlas-data. The same binary serves
#                the website (-mode cloud, see docs/DEPLOY.md).
#
# The phone app is built by apps/android/build.sh (see apps/android/README.md).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GO="${GO:-go}"
BIN_DIR="$ROOT/bin"
EXE="$("$GO" env GOEXE)"

echo "==> Building frontend (Next.js static export)"
(
  cd "$ROOT/apps/web"
  # CI=true keeps pnpm non-interactive: without it, both `pnpm install` and
  # `pnpm run` abort with ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY whenever
  # they want to reconcile node_modules on a non-TTY (CI runner, headless
  # build script).
  export CI=true
  pnpm install --frozen-lockfile
  pnpm run build
)

echo "==> Copying frontend into runtime embed directory"
rm -rf "$ROOT/apps/runtime/assets/web"
mkdir -p "$ROOT/apps/runtime/assets/web"
cp -r "$ROOT/apps/web/out/." "$ROOT/apps/runtime/assets/web/"
touch "$ROOT/apps/runtime/assets/web/.gitkeep" # keep the tracked placeholder

echo "==> Building native Go runtime"
mkdir -p "$BIN_DIR"
(
  cd "$ROOT/apps/runtime"
  "$GO" build -o "$BIN_DIR/atlas$EXE" ./cmd/atlas
)

echo ""
echo "==> Done: $BIN_DIR/atlas$EXE"
echo ""
echo "    Run it for local testing:"
echo "      $BIN_DIR/atlas -data $ROOT/examples/atlas-data"
