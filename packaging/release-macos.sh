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
# 1.1.0: sticks are made by the app (Settings > USB stick), never by dragging. The DMG must say so
# (Mark's ruling via Boss, 15 Nov 2026); Lite owns DMG-README.txt, this only refuses a release without it.
grep -qF "Settings > USB stick" packaging/DMG-README.txt \
  || { echo "DMG-README.txt lacks the 'Settings > USB stick' line for stick users; refusing" >&2; exit 1; }
if [ "$CHECK_ONLY" = "1" ]; then
  echo "preflight OK: $VER at $(git rev-parse --short HEAD), tree clean, not tagged, manual current"; exit 0
fi
# Debug #51: a run that dies at notarization used to leave a NEW DMG beside an OLD artifact under the
# final release names. Clear them before anything is built. The USB zip is retired from 1.1.0 (Mark's
# U1 ruling, 15 Nov 2026: the app puts itself on a stick, Settings > USB stick); a stale one of this
# version is still removed so nobody uploads it by mistake.
rm -f "dist/Tunefield-Lite-$VER-arm64.dmg" "dist/Tunefield-Lite-$VER-arm64-USB.zip"
# A --no-notarize build must never carry the names the GitHub Release expects.
SUFFIX=""; [ "$NOTARIZE" = "0" ] && SUFFIX="-UNNOTARIZED"
APP=dist/Tunefield.app
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

echo "== build ($VER) =="
"$VENV/bin/pyinstaller" --noconfirm Tunefield.spec
# Settings > USB stick writes these next to the app on a stick; a bundle without them cannot do it.
for f in USB-README.txt tunefield-doctor.sh M2-MONITOR.md; do
  cmp -s "packaging/$f" "$APP/Contents/Resources/usb/$f" \
    || { echo "bundle lacks usb/$f (or it differs from packaging/$f): Settings > USB stick would fail; aborting" >&2; exit 1; }
done

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
  # The app is stapled first and THEN copied into the DMG, so the DMG copy, and every stick copy
  # Settings > USB stick makes from it, carries a
  # ticket. Stapling only the DMG left the app inside it unstapled (debug sweep, 2 Nov 2026).
  APPZIP="$STAGE/notarize-app.zip"
  rm -f "$APPZIP"
  ditto -c -k --keepParent "$APP" "$APPZIP"
  xcrun notarytool submit "$APPZIP" --keychain-profile tunefield-notary --wait
  xcrun stapler staple "$APP" || { echo "app staple failed — neither the DMG nor a stick copy would verify offline; aborting" >&2; exit 1; }
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
  echo "   app first, so the DMG and every stick copy carry it, then notarizes the DMG)."
else
echo "== notarize (waits for Apple) =="
xcrun notarytool submit "$DMG" --keychain-profile tunefield-notary --wait
xcrun stapler staple "$DMG"
fi
echo "== verdicts =="
spctl -a -t open --context context:primary-signature -v "$DMG" || true
spctl -a -t exec -v "$APP" || true
shasum -a 256 "$DMG"
echo "release $VER done"
