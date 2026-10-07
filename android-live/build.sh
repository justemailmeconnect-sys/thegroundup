#!/usr/bin/env bash
# Builds the "live" Android app:  android-live/dist/TheGroundUp-live-<versionName>.apk
#
#   ./android-live/build.sh
#
# 1. checks the Android SDK (shared with the standalone app: ../android/.sdk)
# 2. checks the release signing key (the SAME key as the standalone app; it lives OUTSIDE the repo)
# 3. runs Gradle (assembleRelease), checks the signature, and copies the APK to android-live/dist/
#
# Settings (all optional environment variables):
#   GU_KEYSTORE_PROPS  properties file with the signing key (storeFile, storePassword, keyAlias, keyPassword)
#   GU_VERSION_NAME    versionName (default: today, YYYY.MM.DD)
#   GU_ANDROID_SDK     where the SDK lives (default: ../android/.sdk)
#   GU_GRADLE_ARGS     extra arguments for Gradle
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SDK="${GU_ANDROID_SDK:-$HERE/../android/.sdk}"
PLATFORM="android-34"
BUILD_TOOLS="34.0.0"
KEYSTORE_PROPS="${GU_KEYSTORE_PROPS:-/tmp/claude-0/-home-user-thegroundup/df97e034-9bb0-52b9-b2cd-bd324c50d3b7/scratchpad/android-keystore/keystore.properties}"
VERSION_NAME="${GU_VERSION_NAME:-$(date +%Y.%m.%d)}"
VERSION_CODE="$(sed -n 's/^versionCode=//p' "$HERE/version.properties")"

say() { printf '\n== %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

for t in java sha256sum stat; do
  command -v "$t" >/dev/null 2>&1 || die "$t is required but was not found"
done

# ---------------------------------------------------------------- 1. Android SDK (installed by ../android/build.sh)
[[ -x "$SDK/build-tools/$BUILD_TOOLS/apksigner" && -f "$SDK/platforms/$PLATFORM/android.jar" ]] \
  || die "the Android SDK is not at $SDK. Run ./android/build.sh once (it installs the SDK), or set GU_ANDROID_SDK."
SDK="$(cd "$SDK" && pwd)"
say "Android SDK ready ($SDK)"

# ---------------------------------------------------------------- 2. signing key (never created here)
[[ -f "$KEYSTORE_PROPS" ]] || die "no signing key settings at $KEYSTORE_PROPS. Run ./android/build.sh once (it creates the key) or set GU_KEYSTORE_PROPS to the existing one."
store="$(sed -n 's/^storeFile=//p' "$KEYSTORE_PROPS" | head -n1)"
[[ -n "$store" && -f "$store" ]] || die "$KEYSTORE_PROPS points at a keystore that does not exist. Restore it; a new key could not update installed copies."
say "Signing key: reusing the existing keystore"

# ---------------------------------------------------------------- 3. build, check, copy
say "Gradle assembleRelease (versionName $VERSION_NAME, versionCode $VERSION_CODE)"
printf 'sdk.dir=%s\n' "$SDK" > "$HERE/local.properties"
export ANDROID_HOME="$SDK" ANDROID_SDK_ROOT="$SDK" GU_KEYSTORE_PROPS="$KEYSTORE_PROPS"
cd "$HERE"
gradle=(./gradlew)
if ! ./gradlew --version >/dev/null 2>&1; then
  command -v gradle >/dev/null 2>&1 || die "the Gradle wrapper could not start and no gradle is installed"
  gradle=(gradle)
fi
# shellcheck disable=SC2086
"${gradle[@]}" --console=plain assembleRelease "-Pgu.versionName=$VERSION_NAME" ${GU_GRADLE_ARGS:-}

built="$HERE/app/build/outputs/apk/release/app-release.apk"
[[ -f "$built" ]] || die "Gradle finished but $built is missing (is the build unsigned?)"
bt="$SDK/build-tools/$BUILD_TOOLS"

say "Checking the signature"
sig="$("$bt/apksigner" verify --verbose --print-certs "$built" 2>&1)" || { echo "$sig"; die "apksigner did not verify the APK"; }
grep -E "^(Verifies|Verified using|Number of signers|Signer #1 certificate (DN|SHA-256))" <<<"$sig"
grep -q "Verified using v2 scheme (APK Signature Scheme v2): true" <<<"$sig" || die "the APK is not v2-signed"
grep -q "Verified using v3 scheme (APK Signature Scheme v3): true" <<<"$sig" || die "the APK is not v3-signed"

mkdir -p "$HERE/dist"
apk="$HERE/dist/TheGroundUp-live-$VERSION_NAME.apk"
cp "$built" "$apk"

say "Done"
bytes="$(stat -c %s "$apk")"
echo "   APK:     $apk"
echo "   Size:    $bytes bytes ($(awk -v b="$bytes" 'BEGIN { printf "%.1f KB", b / 1024 }'))"
echo "   SHA-256: $(sha256sum "$apk" | cut -d' ' -f1)"
echo "   Version: $VERSION_NAME (versionCode $VERSION_CODE)"
