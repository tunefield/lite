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
NOTARIZE=1
ARGS=()
for a in "$@"; do
  case "$a" in
    --no-notarize) NOTARIZE=0 ;;
    *) ARGS+=("$a") ;;
  esac
done
set -- ${ARGS[@]+"${ARGS[@]}"}   # bash 3.2 + set -u: an empty array is "unbound" without this

if [ $# -eq 0 ]; then echo "usage: release-macos.sh <buildvenv> [--no-notarize]"; exit 2; fi
VENV="$1"; shift
ID="Developer ID Application: Mark Burnett (6R865P6UAX)"
VER=$(cat VERSION)
# Every artifact path derives from VERSION and is rm -f'd before the build. Cutting a second
# build at an already-tagged version would therefore DELETE the notarized artifacts that tag
# stands for — a near miss on 2026-09-17, when HEAD still said beta7 nine commits past the tag.
git rev-parse -q --verify "refs/tags/v$VER" >/dev/null 2>&1 && {
  echo "v$VER is already tagged — bump VERSION before building (refusing to overwrite dist/ artifacts)"; exit 1; }
# The shipped manual is GENERATED — a stale one would report the previous version
# to every tester (the exact bug class the VERSION file itself was created to kill).
grep -q "version $VER" static/manual.html || {
  echo "manual is stale — run: python3 scripts/build_manual.py  (then commit static/manual.html)"; exit 1; }
# A matching version string is not enough: the manual can carry the right version and
# still predate the last MANUAL.md edit (it did, before beta7).
[ static/manual.html -nt MANUAL.md ] || {
  echo "manual.html is older than MANUAL.md — run: python3 scripts/build_manual.py"; exit 1; }
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

echo "== dmg =="
mkdir -p "$STAGE/dmg/Testing"
cp -R "$APP" "$STAGE/dmg/"
cp packaging/DMG-README.txt "$STAGE/dmg/READ ME FIRST.txt"
cp LICENSE NOTICE.md "$STAGE/dmg/"
cp packaging/tunefield-doctor.sh packaging/M2-MONITOR.md "$STAGE/dmg/Testing/"
ln -s /Applications "$STAGE/dmg/Applications"
DMG="dist/Tunefield-Lite-$VER-arm64.dmg"
rm -f "$DMG"
hdiutil create -volname "Tunefield $VER" -srcfolder "$STAGE/dmg" -ov -format UDZO "$DMG" -quiet
codesign --force --timestamp --sign "$ID" "$DMG"

if [ "$NOTARIZE" = "0" ]; then
  echo "== notarize SKIPPED (--no-notarize) =="
  echo "   The DMG is signed but NOT notarized and NOT stapled."
  echo "   Gatekeeper will refuse it on another Mac until it is."
  echo "   To finish later:  xcrun notarytool submit \"$DMG\" --keychain-profile tunefield-notary --wait \\"
  echo "                  && xcrun stapler staple \"$DMG\""
else
echo "== notarize (waits for Apple) =="
xcrun notarytool submit "$DMG" --keychain-profile tunefield-notary --wait
xcrun stapler staple "$DMG"
fi
# The app inside carries the same measured signature — staple the loose copy too so
# the USB build verifies offline.
[ "$NOTARIZE" = "1" ] && { xcrun stapler staple "$APP" || echo "note: app staple failed (dmg ticket still covers online checks)"; }

echo "== USB zip =="
mkdir -p "$STAGE/usb/Tunefield-USB"
cp -R "$APP" "$STAGE/usb/Tunefield-USB/"
touch "$STAGE/usb/Tunefield-USB/PORTABLE"
cp packaging/USB-README.txt "$STAGE/usb/Tunefield-USB/READ ME FIRST.txt"
cp LICENSE NOTICE.md "$STAGE/usb/Tunefield-USB/"
cp packaging/tunefield-doctor.sh packaging/M2-MONITOR.md "$STAGE/usb/Tunefield-USB/"
ZIP="dist/Tunefield-Lite-$VER-arm64-USB.zip"
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
