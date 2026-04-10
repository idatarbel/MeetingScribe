#!/usr/bin/env bash
# Package the built Chrome extension into a .zip for Chrome Web Store upload.
#
# Usage: bash scripts/package-extension.sh
#
# Prerequisites:
#   - npm run build (produces dist/)
#   - zip command available

set -euo pipefail

VERSION=$(node -e "console.log(require('./package.json').version)")
DIST_DIR="dist"
OUTPUT="meetingscribe-${VERSION}.zip"

if [ ! -d "$DIST_DIR" ]; then
  echo "Error: $DIST_DIR directory not found. Run 'npm run build' first."
  exit 1
fi

# Remove any previous package
rm -f "$OUTPUT"

# Create the zip from the dist directory contents
cd "$DIST_DIR"
zip -r "../$OUTPUT" . -x "*.map"
cd ..

echo ""
echo "Packaged: $OUTPUT ($(du -h "$OUTPUT" | cut -f1))"
echo ""
echo "To upload to Chrome Web Store:"
echo "  1. Open https://chrome.google.com/webstore/devconsole"
echo "  2. Click 'New item' or select MeetingScribe"
echo "  3. Upload $OUTPUT"
echo "  4. Fill in store listing details"
echo "  5. Submit for review"
