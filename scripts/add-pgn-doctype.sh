#!/usr/bin/env bash
# Declare the .pgn document type in a packaged Chessboard.app and re-sign it.
#
# Why this still exists now that app.zon has `.file_associations` (7.0).
#
# It is no longer "the SDK might not support it" — it does, and app.zon now
# declares the association so the Windows installer registration comes from
# the manifest too. But read what the packager actually writes
# (src/tooling/package.zig, macosDocumentTypes): CFBundleDocumentTypes, and
# only that. Two things this app depends on have no key to carry them:
#
#   LSHandlerRank                Without it macOS is free to make Chessboard
#                                the default .pgn handler, taking the file
#                                type away from whatever PGN editor the user
#                                already had. "Alternate" is the whole point
#                                of the declaration, and `role` cannot say it
#                                — its vocabulary is viewer/editor/shell/none.
#   UTExportedTypeDeclarations   Declaring com.chessboard.pgn as a real UTI
#                                conforming to public.plain-text.
#
# So the manifest key and this script are complementary, not duplicates. The
# script runs after packaging and is idempotent (Delete then Add), so what it
# writes replaces the packager's array with the same content plus the rank.
# The edit is what forces the re-sign below.
#
# What it declares (v6-plan Q1.5):
#   UTExportedTypeDeclarations  com.chessboard.pgn, conforms to public.plain-text,
#                               extension .pgn, MIME application/x-chess-pgn
#   CFBundleDocumentTypes       the app opens that type (LSHandlerRank
#                               Alternate: never steal the default from a
#                               dedicated PGN editor the user already has)
#
# The edit invalidates the seal, so the bundle is re-signed the way
# `native package --signing adhoc` signed it (codesign -s -). A Developer ID
# build must re-sign with its identity instead — pass it as $2.
#
#   scripts/add-pgn-doctype.sh dist/Chessboard.app [signing-identity]
set -euo pipefail
app="${1:?usage: add-pgn-doctype.sh <App.app> [identity]}"
identity="${2:--}"
plist="$app/Contents/Info.plist"
PB=/usr/libexec/PlistBuddy
test -f "$plist" || { echo "no Info.plist at $plist" >&2; exit 1; }

# idempotent: replace whatever is there
$PB -c "Delete :CFBundleDocumentTypes" "$plist" 2>/dev/null || true
$PB -c "Delete :UTExportedTypeDeclarations" "$plist" 2>/dev/null || true

$PB -c "Add :UTExportedTypeDeclarations array" "$plist"
$PB -c "Add :UTExportedTypeDeclarations:0 dict" "$plist"
$PB -c "Add :UTExportedTypeDeclarations:0:UTTypeIdentifier string com.chessboard.pgn" "$plist"
$PB -c "Add :UTExportedTypeDeclarations:0:UTTypeDescription string 'Portable Game Notation'" "$plist"
$PB -c "Add :UTExportedTypeDeclarations:0:UTTypeConformsTo array" "$plist"
$PB -c "Add :UTExportedTypeDeclarations:0:UTTypeConformsTo:0 string public.plain-text" "$plist"
$PB -c "Add :UTExportedTypeDeclarations:0:UTTypeTagSpecification dict" "$plist"
$PB -c "Add :UTExportedTypeDeclarations:0:UTTypeTagSpecification:public.filename-extension array" "$plist"
$PB -c "Add :UTExportedTypeDeclarations:0:UTTypeTagSpecification:public.filename-extension:0 string pgn" "$plist"
$PB -c "Add :UTExportedTypeDeclarations:0:UTTypeTagSpecification:public.mime-type array" "$plist"
$PB -c "Add :UTExportedTypeDeclarations:0:UTTypeTagSpecification:public.mime-type:0 string application/x-chess-pgn" "$plist"

$PB -c "Add :CFBundleDocumentTypes array" "$plist"
$PB -c "Add :CFBundleDocumentTypes:0 dict" "$plist"
$PB -c "Add :CFBundleDocumentTypes:0:CFBundleTypeName string 'Portable Game Notation'" "$plist"
$PB -c "Add :CFBundleDocumentTypes:0:CFBundleTypeRole string Editor" "$plist"
$PB -c "Add :CFBundleDocumentTypes:0:LSHandlerRank string Alternate" "$plist"
$PB -c "Add :CFBundleDocumentTypes:0:LSItemContentTypes array" "$plist"
$PB -c "Add :CFBundleDocumentTypes:0:LSItemContentTypes:0 string com.chessboard.pgn" "$plist"

# the plist changed under the seal; sign again the way native package did
codesign --force --deep --sign "$identity" "$app"
codesign --verify --deep --strict "$app"
echo "declared com.chessboard.pgn in $plist and re-signed ($identity)"
