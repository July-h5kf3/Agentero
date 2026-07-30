set -euo pipefail

pnpm ios:release:check   # 发布前检查

APPLE_DEVELOPMENT_TEAM="$APPLE_DEVELOPMENT_TEAM" \
APPLE_API_KEY="$APPLE_API_KEY" \
APPLE_API_ISSUER="$APPLE_API_ISSUER" \
APPLE_API_KEY_PATH="${APPLE_API_KEY_PATH:-$HOME/.appstoreconnect/private_keys/AuthKey_${APPLE_API_KEY}.p8}" \
pnpm tauri ios build --config src-tauri/tauri.ios.conf.json \
    --target aarch64 --build-number "$(date +%y%m%d%H%M)" \
    --export-method app-store-connect

xcrun altool --upload-app -f src-tauri/gen/apple/build/arm64/Agentero.ipa -t ios \
    --apiKey $APPLE_API_KEY --apiIssuer $APPLE_API_ISSUER