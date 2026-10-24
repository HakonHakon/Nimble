#!/usr/bin/env bash
# Bash port of build-php-release.ps1: assembles the PHP shared-hosting release in
# ../artifacts/nimble-php-release (or $1). Used by the deploy workflow.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
release="${1:-$(dirname "$root")/artifacts/nimble-php-release}"

rm -rf "$release"
mkdir -p "$release/assets/editor" "$release/lib" "$release/storage"

cp "$root/php-backend/index.php" "$root/php-backend/.htaccess" "$root/php-backend/.user.ini" "$root/php-backend/config.example.php" "$release/"
cp "$root/php-backend/storage/.htaccess" "$release/storage/.htaccess"
for f in site-model render site-model-v2 render-v2 fonts forms; do cp "$root/php-backend/lib/$f.php" "$release/lib/"; done
cp "$root/lib/nimble-spec.json" "$release/lib/"
cp "$root/PHP_SHARED_HOSTING.md" "$release/README.md"
cp "$root/builder.html" "$root/editor.html" "$root/login.html" "$root/control-panel.html" "$release/"
for f in builder.js control-panel.js login.js public.js public.css editor.css public-v2.css; do cp "$root/assets/$f" "$release/assets/"; done
for f in site-model.mjs render.mjs site-model-v2.mjs render-v2.mjs migrate-v1.mjs nimble-spec.json fonts.mjs; do cp "$root/lib/$f" "$release/assets/"; done
cp "$root"/assets/editor/*.mjs "$root"/assets/editor/*.css "$release/assets/editor/"

echo "Created $release"
