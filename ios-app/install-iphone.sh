#!/usr/bin/env bash
# Signs the unsigned CrumbleCrew.app for development and installs it on the plugged-in iPhone.
# Runs on the MacBook (the signing key lives here); the build itself runs on another Mac.
#   ios-app/install-iphone.sh [path/to/CrumbleCrew.app]
# The team, certificate, profile and phone are private: they come from ios-app/signing.env
# (git-ignored), four lines: TEAM=..., IDENTITY="Apple Development: ...", PROFILE=/path/to.mobileprovision,
# DEVICE=<the phone's identifier>.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
APP="${1:-$HERE/build/CrumbleCrew.app}"
ASKED_DEVICE="${DEVICE:-}"
source "$HERE/signing.env"
DEVICE="${ASKED_DEVICE:-$DEVICE}"
BUNDLE_ID=$(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$APP/Info.plist")
TMP=$(mktemp -d)

security cms -D -i "$PROFILE" > "$TMP/profile.plist"
/usr/libexec/PlistBuddy -x -c "Print :Entitlements" "$TMP/profile.plist" > "$TMP/entitlements.plist"
/usr/libexec/PlistBuddy -c "Set :application-identifier $TEAM.$BUNDLE_ID" "$TMP/entitlements.plist"

cp "$PROFILE" "$APP/embedded.mobileprovision"
rm -rf "$APP/_CodeSignature"
# inside first, the app last
find "$APP" -depth \( -name "*.framework" -o -name "*.dylib" -o -name "*.appex" \) -print0 | while IFS= read -r -d '' item; do
  codesign --force --sign "$IDENTITY" --timestamp=none "$item"
done
codesign --force --sign "$IDENTITY" --timestamp=none --entitlements "$TMP/entitlements.plist" "$APP"
codesign --verify --strict --deep "$APP"
echo "signed $BUNDLE_ID as $IDENTITY"
xcrun devicectl device install app --device "$DEVICE" "$APP"
