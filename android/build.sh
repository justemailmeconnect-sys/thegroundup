#!/usr/bin/env bash
# Builds the installable Android app:  android/dist/TheGroundUp-<versionName>.apk
#
#   ./android/build.sh
#
# 1. makes sure the Android SDK is in android/.sdk (downloads it the first time)
# 2. makes sure the release signing key exists (creates it the first time; it lives OUTSIDE the repo)
# 3. copies index.html, css/ and js/ from the repo root into the app, adds the shim and offline fonts
# 4. runs Gradle (assembleRelease), checks the signature, and copies the APK to android/dist/
#
# Settings (all optional environment variables):
#   GU_KEYSTORE_PROPS  properties file with the signing key (storeFile, storePassword, keyAlias, keyPassword)
#   GU_VERSION_NAME    versionName (default: today, YYYY.MM.DD)
#   GU_ANDROID_SDK     where the SDK lives (default: android/.sdk)
#   GU_FONTS           auto (default) or off: bundle Google Fonts for offline use
#   GU_REFRESH_FONTS   1 to download the fonts again
#   GU_GRADLE_ARGS     extra arguments for Gradle
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
SDK="${GU_ANDROID_SDK:-$HERE/.sdk}"
PLATFORM="android-34"
BUILD_TOOLS="34.0.0"
KEYSTORE_PROPS="${GU_KEYSTORE_PROPS:-/tmp/claude-0/-home-user-thegroundup/df97e034-9bb0-52b9-b2cd-bd324c50d3b7/scratchpad/android-keystore/keystore.properties}"
VERSION_NAME="${GU_VERSION_NAME:-$(date +%Y.%m.%d)}"
ASSETS="$HERE/app/src/main/assets/www"

say() { printf '\n== %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- 0. tools
for t in java keytool python3 curl unzip sha256sum sha1sum; do
  command -v "$t" >/dev/null 2>&1 || die "$t is required but was not found"
done

# ---------------------------------------------------------------- 1. Android SDK
ensure_sdk() {
  if [[ -x "$SDK/build-tools/$BUILD_TOOLS/apksigner" && -f "$SDK/platforms/$PLATFORM/android.jar" ]]; then
    say "Android SDK ready ($SDK)"
    return
  fi
  say "Installing the Android SDK into $SDK (first run only; about 450 MB on disk)"
  mkdir -p "$SDK"
  if [[ ! -x "$SDK/cmdline-tools/latest/bin/sdkmanager" ]]; then
    local tmp
    tmp="$(mktemp -d)"
    curl -fsSL --retry 5 https://dl.google.com/android/repository/repository2-3.xml -o "$tmp/repo.xml"
    local zip sha1
    read -r zip sha1 < <(python3 -I - "$tmp/repo.xml" <<'PY'
import sys, xml.etree.ElementTree as ET
root = ET.parse(sys.argv[1]).getroot()
for pkg in root.iter('remotePackage'):
    if pkg.get('path') == 'cmdline-tools;latest':
        for arc in pkg.iter('archive'):
            os_ = arc.find('host-os')
            if os_ is not None and os_.text == 'linux':
                c = arc.find('complete')
                print(c.find('url').text, c.find('checksum').text)
                sys.exit(0)
sys.exit('no Linux command-line tools in the repository listing')
PY
)
    echo "   downloading $zip"
    curl -fL --retry 5 --retry-delay 3 -C - -o "$tmp/cmdline.zip" "https://dl.google.com/android/repository/$zip"
    echo "$sha1  $tmp/cmdline.zip" | sha1sum -c --quiet - || die "command-line tools download is corrupt"
    unzip -q "$tmp/cmdline.zip" -d "$tmp/x"
    mkdir -p "$SDK/cmdline-tools"
    rm -rf "$SDK/cmdline-tools/latest"
    mv "$tmp/x/cmdline-tools" "$SDK/cmdline-tools/latest"
    rm -rf "$tmp"
  fi
  local sdkmanager="$SDK/cmdline-tools/latest/bin/sdkmanager"
  { yes 2>/dev/null || true; } | "$sdkmanager" --sdk_root="$SDK" --licenses >/dev/null 2>&1 || true
  { yes 2>/dev/null || true; } | "$sdkmanager" --sdk_root="$SDK" "platforms;$PLATFORM" "build-tools;$BUILD_TOOLS"
  [[ -x "$SDK/build-tools/$BUILD_TOOLS/apksigner" && -f "$SDK/platforms/$PLATFORM/android.jar" ]] || die "SDK install did not finish"
}

# ---------------------------------------------------------------- 2. signing key
ensure_keystore() {
  if [[ -f "$KEYSTORE_PROPS" ]]; then
    local store
    store="$(sed -n 's/^storeFile=//p' "$KEYSTORE_PROPS" | head -n1)"
    [[ -n "$store" && -f "$store" ]] || die "$KEYSTORE_PROPS points at a keystore that does not exist. Restore it; a new key could not update installed copies."
    say "Signing key: reusing the existing keystore"
    return
  fi
  local dir jks pass
  dir="$(dirname "$KEYSTORE_PROPS")"
  jks="$dir/groundup.jks"
  [[ ! -e "$jks" ]] || die "$jks exists but $KEYSTORE_PROPS does not. Not overwriting a key; restore the properties file."
  say "Signing key: creating one (first run only). Keep it safe: updates must be signed with the same key."
  mkdir -p "$dir"
  chmod 700 "$dir"
  pass="$(python3 -I -c 'import secrets,string;a=string.ascii_letters+string.digits;print("".join(secrets.choice(a) for _ in range(28)))')"
  GU_STOREPASS="$pass" keytool -genkeypair -noprompt \
    -keystore "$jks" -storetype PKCS12 -storepass:env GU_STOREPASS -keypass:env GU_STOREPASS \
    -alias groundup -keyalg RSA -keysize 2048 -validity 10950 \
    -dname "CN=The Ground Up (personal build), O=Personal, C=GB" >/dev/null 2>&1 \
    || { rm -f "$jks"; die "keytool could not create the keystore"; }
  chmod 600 "$jks"
  ( umask 077; printf 'storeFile=%s\nstorePassword=%s\nkeyAlias=groundup\nkeyPassword=%s\n' "$jks" "$pass" "$pass" > "$KEYSTORE_PROPS" )
  chmod 600 "$KEYSTORE_PROPS"
}

# ---------------------------------------------------------------- 3. the web files
prepare_assets() {
  say "Bundling the web app ($REPO/index.html, css/, js/) + shim + fonts"
  local args=(--repo "$REPO" --out "$ASSETS" --shim "$HERE/shim/android-shim.js" --cache "$HERE/.cache/fonts" --fonts "${GU_FONTS:-auto}")
  [[ "${GU_REFRESH_FONTS:-0}" == "1" ]] && args+=(--refresh-fonts)
  python3 -I "$HERE/tools/prepare_assets.py" "${args[@]}"
}

# ---------------------------------------------------------------- 4. build, check, copy
build_apk() {
  say "Gradle assembleRelease (versionName $VERSION_NAME, versionCode $(sed -n 's/^versionCode=//p' "$HERE/version.properties"))"
  printf 'sdk.dir=%s\n' "$SDK" > "$HERE/local.properties"
  export ANDROID_HOME="$SDK" ANDROID_SDK_ROOT="$SDK" GU_KEYSTORE_PROPS="$KEYSTORE_PROPS"
  cd "$HERE"
  local gradle=(./gradlew)
  if ! ./gradlew --version >/dev/null 2>&1; then
    command -v gradle >/dev/null 2>&1 || die "the Gradle wrapper could not start and no gradle is installed"
    gradle=(gradle)
  fi
  # shellcheck disable=SC2086
  "${gradle[@]}" --console=plain assembleRelease "-Pgu.versionName=$VERSION_NAME" ${GU_GRADLE_ARGS:-}

  local built="$HERE/app/build/outputs/apk/release/app-release.apk"
  [[ -f "$built" ]] || die "Gradle finished but $built is missing (is the build unsigned?)"
  local bt="$SDK/build-tools/$BUILD_TOOLS"

  say "Checking the signature"
  local sig
  sig="$("$bt/apksigner" verify --verbose --print-certs "$built" 2>&1)" || { echo "$sig"; die "apksigner did not verify the APK"; }
  grep -E "^(Verifies|Verified using|Number of signers|Signer #1 certificate (DN|SHA-256))" <<<"$sig"
  grep -q "Verified using v2 scheme (APK Signature Scheme v2): true" <<<"$sig" || die "the APK is not v2-signed"
  grep -q "Verified using v3 scheme (APK Signature Scheme v3): true" <<<"$sig" || die "the APK is not v3-signed"

  mkdir -p "$HERE/dist"
  local apk="$HERE/dist/TheGroundUp-$VERSION_NAME.apk"
  cp "$built" "$apk"

  say "Done"
  local bytes
  bytes="$(stat -c %s "$apk")"
  echo "   APK:     $apk"
  echo "   Size:    $bytes bytes ($(awk -v b="$bytes" 'BEGIN { printf "%.2f MB", b / 1048576 }'))"
  echo "   SHA-256: $(sha256sum "$apk" | cut -d' ' -f1)"
  echo "   Version: $VERSION_NAME (versionCode $(sed -n 's/^versionCode=//p' "$HERE/version.properties"))"
}

ensure_sdk
ensure_keystore
prepare_assets
build_apk
