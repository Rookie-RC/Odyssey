#!/usr/bin/env bash
# Builds the Odyssey Android app: apps/android/dist/odyssey.apk.
#
# No Gradle: the app is two Java classes and a few resources, so the SDK's own
# tools are enough — aapt2 (resources + manifest), javac, d8 (dex), zipalign,
# apksigner. The Go runtime (with the frontend embedded) goes in as
# lib/<abi>/libodyssey.so.
#
# Needs a JDK 17 and an Android SDK with platforms;android-34 and
# build-tools;34.0.0 — by default the copies in .tools/ (see README.md).
#
#   apps/android/build.sh                 # frontend + runtime + apk
#   SKIP_FRONTEND=1 apps/android/build.sh # reuse apps/runtime/assets/web
#   ABIS="arm64-v8a x86_64" apps/android/build.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
export JAVA_HOME="${JAVA_HOME:-$ROOT/.tools/jdk17}"
ANDROID_HOME="${ANDROID_HOME:-$ROOT/.tools/android-sdk}"
BT="$ANDROID_HOME/build-tools/34.0.0"
ANDROID_JAR="$ANDROID_HOME/platforms/android-34/android.jar"
ABIS="${ABIS:-arm64-v8a armeabi-v7a}"
GO="${GO:-go}"
OUT="$HERE/build"
DIST="$HERE/dist"
# The signing key must stay the same for updates to install over the
# previous version (otherwise Android asks to uninstall — which deletes the
# app's data). Keep it out of the repository, and keep a copy.
KEYSTORE="${ODYSSEY_KEYSTORE:-$HOME/.android/odyssey.jks}"
KEYPASS="${ODYSSEY_KEYPASS:-odyssey}"

for tool in "$JAVA_HOME/bin/javac" "$BT/aapt2" "$BT/d8" "$BT/zipalign" "$BT/apksigner" "$ANDROID_JAR"; do
  [ -e "$tool" ] || { echo "missing: $tool (see apps/android/README.md)" >&2; exit 1; }
done
export PATH="$JAVA_HOME/bin:$PATH"

VERSION_CODE="$(date +%y%m%d%H)"
VERSION_NAME="1.0.$(date +%Y%m%d)-$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo dev)"

rm -rf "$OUT"
mkdir -p "$OUT/apk/lib" "$OUT/gen" "$OUT/classes" "$OUT/dex" "$DIST"

if [ "${SKIP_FRONTEND:-0}" != 1 ]; then
  echo "==> Frontend (Next.js static export)"
  (cd "$ROOT/apps/web" && CI=true pnpm install --frozen-lockfile >/dev/null && pnpm run build >/dev/null)
  rm -rf "$ROOT/apps/runtime/assets/web"
  mkdir -p "$ROOT/apps/runtime/assets/web"
  cp -r "$ROOT/apps/web/out/." "$ROOT/apps/runtime/assets/web/"
  touch "$ROOT/apps/runtime/assets/web/.gitkeep"
fi
[ -f "$ROOT/apps/runtime/assets/web/index.html" ] || { echo "no embedded frontend: run without SKIP_FRONTEND" >&2; exit 1; }

echo "==> Runtime for: $ABIS"
for abi in $ABIS; do
  # android/arm64 builds without cgo; the other ABIs need cgo for GOOS=android,
  # so they get a static linux executable, which Android runs just as well.
  case "$abi" in
    arm64-v8a)   env=(GOOS=android GOARCH=arm64) ;;
    armeabi-v7a) env=(GOOS=linux GOARCH=arm GOARM=7) ;;
    x86_64)      env=(GOOS=linux GOARCH=amd64) ;;
    *) echo "unsupported ABI: $abi" >&2; exit 1 ;;
  esac
  mkdir -p "$OUT/apk/lib/$abi"
  (cd "$ROOT/apps/runtime" && env "${env[@]}" CGO_ENABLED=0 "$GO" build -trimpath -ldflags "-s -w" -tags timetzdata \
    -o "$OUT/apk/lib/$abi/libodyssey.so" ./cmd/atlas)
done

echo "==> Resources and manifest"
"$BT/aapt2" compile --dir "$HERE/res" -o "$OUT/res.zip"
"$BT/aapt2" link -o "$OUT/base.apk" -I "$ANDROID_JAR" \
  --manifest "$HERE/AndroidManifest.xml" \
  --min-sdk-version 24 --target-sdk-version 34 \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
  --java "$OUT/gen" "$OUT/res.zip"

echo "==> Java → dex"
javac -nowarn -Xlint:-options -source 8 -target 8 -encoding UTF-8 \
  -bootclasspath "$ANDROID_JAR:$BT/core-lambda-stubs.jar" -classpath "$ANDROID_JAR" -d "$OUT/classes" \
  $(find "$HERE/src" "$OUT/gen" -name '*.java')
"$BT/d8" --release --min-api 24 --lib "$ANDROID_JAR" --output "$OUT/dex" $(find "$OUT/classes" -name '*.class')

echo "==> Package, align, sign"
cp "$OUT/base.apk" "$OUT/unsigned.apk"
(cd "$OUT/dex" && zip -q -j "$OUT/unsigned.apk" classes.dex)
(cd "$OUT/apk" && zip -q -r "$OUT/unsigned.apk" lib)
"$BT/zipalign" -f -p 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"
if [ ! -f "$KEYSTORE" ]; then
  echo "    creating signing key $KEYSTORE (keep a copy: updates need the same key)"
  mkdir -p "$(dirname "$KEYSTORE")"
  keytool -genkeypair -keystore "$KEYSTORE" -alias odyssey -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$KEYPASS" -keypass "$KEYPASS" -dname "CN=Odyssey" >/dev/null
fi
"$BT/apksigner" sign --ks "$KEYSTORE" --ks-key-alias odyssey --ks-pass "pass:$KEYPASS" --key-pass "pass:$KEYPASS" \
  --out "$DIST/odyssey.apk" "$OUT/aligned.apk"
"$BT/apksigner" verify "$DIST/odyssey.apk"

echo "==> Done: $DIST/odyssey.apk ($(du -h "$DIST/odyssey.apk" | cut -f1), version $VERSION_NAME)"
