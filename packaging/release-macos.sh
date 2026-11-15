#!/bin/bash
# Tunefield macOS release pipeline: build → sign → notarize → staple → package.
# Usage: packaging/release-macos.sh <path-to-buildvenv>
#
# Everything here was proven the hard way on 2026-08-12:
#   * The entitlements in packaging/entitlements.plist are LOAD-BEARING — llvmlite JIT
#     needs them under the hardened runtime. Without them the app signs, notarizes,
#     and then dies on the first analysis. Launch-test the SIGNED app every release.
#   * Nested Mach-O files are signed individually first (runtime+timestamp, no
#     entitlements), then the bundle with entitlements — the combination Apple
#     accepted for this exact bundle layout.
#   * notarytool credentials live in the keychain profile "tunefield-notary".
set -euo pipefail
cd "$(dirname "$0")/.."

# --no-notarize: build, sign and package, then STOP before submitting to Apple. Used when
# a build is wanted for local testing but the go/no-go on shipping it has not been given
# (standing rule, Mark 2026-08-27: never notarize unless explicitly instructed).
# --check-only: run every guard below, then stop before building (release-day preflight).
# --expect-commit <sha>: refuse unless HEAD is the commit Application Tests signed off.
NOTARIZE=1
CHECK_ONLY=0
EXPECT=""
ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --no-notarize) NOTARIZE=0 ;;
    --check-only) CHECK_ONLY=1 ;;
    --expect-commit) EXPECT="${2:-}"; shift ;;
    *) ARGS+=("$1") ;;
  esac
  shift
done
set -- ${ARGS[@]+"${ARGS[@]}"}   # bash 3.2 + set -u: an empty array is "unbound" without this

if [ $# -eq 0 ]; then echo "usage: release-macos.sh <buildvenv> [--no-notarize] [--check-only] [--expect-commit <sha>]"; exit 2; fi
VENV="$1"; shift
ID="Developer ID Application: Mark Burnett (6R865P6UAX)"
VER=$(cat VERSION)
# Whatever is in the working tree ships, so only committed state may (review #48 / debug #61).
# Porcelain also catches untracked files (license_key.py sat untracked for a day on 9 Nov).
[ -z "$(git status --porcelain)" ] || {
  echo "working tree is not clean; commit or stash first:"; git status --short | head -20; exit 1; }
if [ -n "$EXPECT" ]; then
  HEAD_SHA=$(git rev-parse HEAD)
  case "$HEAD_SHA" in "$EXPECT"*) ;; *)
    echo "HEAD $HEAD_SHA is not the signed-off commit $EXPECT; refusing"; exit 1 ;; esac
fi
# Every artifact path derives from VERSION and is rm -f'd before the build. Cutting a second
# build at an already-tagged version would therefore DELETE the notarized artifacts that tag
# stands for — a near miss on 2026-09-17, when HEAD still said beta7 nine commits past the tag.
git rev-parse -q --verify "refs/tags/v$VER" >/dev/null 2>&1 && {
  echo "v$VER is already tagged — bump VERSION before building (refusing to overwrite dist/ artifacts)"; exit 1; }
# The shipped manual is GENERATED — a stale one would report the previous version
# to every tester (the exact bug class the VERSION file itself was created to kill).
# The exact stamp: "version $VER" alone also matched "version 1.0.0-beta8" (review #48).
grep -qF "version $VER · built" static/manual.html || {
  echo "manual is stale — run: python3 scripts/build_manual.py  (then commit static/manual.html)"; exit 1; }
# A matching version is not enough: the manual can carry it and still predate the last MANUAL.md
# edit (before beta7 it did). The old mtime test was arbitrary after a clone or pull (debug #61),
# so render the COMMITTED MANUAL.md afresh and compare, ignoring only the build date.
MT=$(mktemp -d)
git archive HEAD | tar -x -C "$MT"
# Same interpreter as the instruction below (the build venv has no `markdown`).
python3 "$MT/scripts/build_manual.py" >/dev/null || { rm -rf "$MT"; echo "could not render the manual with python3"; exit 1; }
sed -E 's/ · built [0-9-]+/ · built -/' "$MT/static/manual.html" > "$MT/fresh"
sed -E 's/ · built [0-9-]+/ · built -/' static/manual.html > "$MT/committed"
cmp -s "$MT/fresh" "$MT/committed" || {
  rm -rf "$MT"; echo "manual.html does not match MANUAL.md — run: python3 scripts/build_manual.py, commit"; exit 1; }
rm -rf "$MT"
if [ "$CHECK_ONLY" = "1" ]; then
  echo "preflight OK: $VER at $(git rev-parse --short HEAD), tree clean, not tagged, manual current"; exit 0
fi
# Debug #51: a run that dies at notarization used to leave a NEW DMG beside an OLD USB zip under the
# final release names. Clear both before anything is built, so a failed run never leaves a mixed pair.
rm -f "dist/Tunefield-Lite-$VER-arm64.dmg" "dist/Tunefield-Lite-$VER-arm64-USB.zip"
# A --no-notarize build must never carry the names the GitHub Release expects.
SUFFIX=""; [ "$NOTARIZE" = "0" ] && SUFFIX="-UNNOTARIZED"
APP=dist/Tunefield.app
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

echo "== build ($VER) =="
"$VENV/bin/pyinstaller" --noconfirm Tunefield.spec

echo "== sign =="
find "$APP" -type f \( -name "*.dylib" -o -name "*.so" \) \
  -exec codesign --force --options runtime --timestamp --sign "$ID" {} +
# Frameworks and the main executable, then the bundle with entitlements on top.
if [ -d "$APP/Contents/Frameworks/Python.framework" ]; then
  codesign --force --options runtime --timestamp --sign "$ID" "$APP/Contents/Frameworks/Python.framework"
fi
codesign --force --options runtime --timestamp \
  --entitlements packaging/entitlements.plist --sign "$ID" "$APP"
codesign --verify --deep --strict "$APP"
echo "signature verifies"

if [ "$NOTARIZE" = "1" ]; then
  echo "== notarize app (waits for Apple) =="
  # The app is stapled first and THEN copied into the DMG and the USB zip, so both carry a
  # ticket. Stapling only the DMG left the app inside it unstapled (debug sweep, 2 Nov 2026).
  APPZIP="$STAGE/notarize-app.zip"
  rm -f "$APPZIP"
  ditto -c -k --keepParent "$APP" "$APPZIP"
  xcrun notarytool submit "$APPZIP" --keychain-profile tunefield-notary --wait
  xcrun stapler staple "$APP" || { echo "app staple failed — neither the DMG nor the USB zip would verify offline; aborting" >&2; exit 1; }
fi

echo "== dmg =="
mkdir -p "$STAGE/dmg/Testing"
cp -R "$APP" "$STAGE/dmg/"
cp packaging/DMG-README.txt "$STAGE/dmg/READ ME FIRST.txt"
cp LICENSE NOTICE.md "$STAGE/dmg/"
cp packaging/tunefield-doctor.sh packaging/M2-MONITOR.md "$STAGE/dmg/Testing/"
ln -s /Applications "$STAGE/dmg/Applications"
DMG="dist/Tunefield-Lite-$VER-arm64$SUFFIX.dmg"
rm -f "$DMG"
hdiutil create -volname "Tunefield $VER" -srcfolder "$STAGE/dmg" -ov -format UDZO "$DMG" -quiet
codesign --force --timestamp --sign "$ID" "$DMG"

if [ "$NOTARIZE" = "0" ]; then
  echo "== notarize SKIPPED (--no-notarize) =="
  echo "   The DMG is signed but NOT notarized and NOT stapled."
  echo "   Gatekeeper will refuse it on another Mac until it is."
  echo "   To finish: re-run this script without --no-notarize (it notarizes and staples the"
  echo "   app first, so the DMG and the USB zip both carry it, then notarizes the DMG)."
else
echo "== notarize (waits for Apple) =="
xcrun notarytool submit "$DMG" --keychain-profile tunefield-notary --wait
xcrun stapler staple "$DMG"
fi
echo "== USB zip =="
mkdir -p "$STAGE/usb/Tunefield-USB"
cp -R "$APP" "$STAGE/usb/Tunefield-USB/"
touch "$STAGE/usb/Tunefield-USB/PORTABLE"
cp packaging/USB-README.txt "$STAGE/usb/Tunefield-USB/READ ME FIRST.txt"
cp LICENSE NOTICE.md "$STAGE/usb/Tunefield-USB/"
cp packaging/tunefield-doctor.sh packaging/M2-MONITOR.md "$STAGE/usb/Tunefield-USB/"
ZIP="dist/Tunefield-Lite-$VER-arm64-USB$SUFFIX.zip"
rm -f "$ZIP"
# --norsrc --noextattr --noqtn: keep AppleDouble (._*) entries OUT of the zip. Plain ditto -c
# wrote 1,378 of them into the beta8 zip (one per file carrying an xattr). On APFS they fold
# back into invisible attributes on extract, so every local test passed; on a FAT32 stick —
# what a DJ's USB actually is, because CDJs need it — extracting them produces DOUBLED junk
# (._._X__, 2,742 files INSIDE the sealed bundle), the seal breaks ("a sealed resource is
# missing or invalid"), Gatekeeper rejects it and the kernel SIGKILLs it at exec (exit 137,
# empty log). The ._ sidecars FAT32 writes by itself for a normal Finder copy (1,371) are
# tolerated — seal valid, app runs — so a clean zip needs no user workaround. Found
# 2026-09-25 on Mark's own TUNEFIELD stick. COPYFILE_DISABLE=1 does NOT affect ditto.
ditto --norsrc --noextattr --noqtn -c -k --keepParent "$STAGE/usb/Tunefield-USB" "$ZIP"

echo "== verdicts =="
spctl -a -t open --context context:primary-signature -v "$DMG" || true
spctl -a -t exec -v "$APP" || true
shasum -a 256 "$DMG" "$ZIP"
echo "release $VER done"
