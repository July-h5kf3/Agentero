# iOS TestFlight Release

## GitHub Actions (recommended)

`.github/workflows/ios-testflight.yml` builds a signed IPA and uploads it to
App Store Connect. It runs on `v*` tag pushes (alongside the desktop Release
workflow) and can be triggered manually from the Actions tab.

Required secrets (org or repo level):

| Secret | Content |
|---|---|
| `APPLE_DISTRIBUTION_CERTIFICATE` | Apple Distribution `.p12`, base64 |
| `APPLE_DISTRIBUTION_CERTIFICATE_PASSWORD` | `.p12` export password |
| `IOS_MOBILE_PROVISION` | App Store provisioning profile, base64 |
| `APPLE_API_KEY` / `APPLE_API_KEY_P8` / `APPLE_API_ISSUER` | App Store Connect API key (shared with the macOS notarization flow) |
| `APPLE_TEAM_ID` or `APPLE_SIGNING_IDENTITY` | Team ID, or an identity string ending in `(TEAMID)` |

The build number is a `yymmddHHMM` timestamp, so each run produces a strictly
increasing build for the same version.

## New Machine Setup

iOS builds require macOS, Xcode, Node.js, pnpm, and the stable Rust toolchain.
After cloning the repository, initialize the local Tauri project:

```bash
pnpm install
rustup target add aarch64-apple-ios-sim
pnpm tauri ios init
```

The committed sources of truth are `src-tauri/ios-project.yml`,
`src-tauri/tauri.ios.conf.json`, and `src-tauri/Info.ios.plist`.
`src-tauri/gen/apple/` is generated locally by Tauri and should not contain
machine-specific `libapp.a`, Xcode scheme, or developer-team changes in a
commit.

## Repository checks

Run these before creating an archive:

```bash
pnpm ios:release:check
pnpm build
RUSTUP_CARGO="$(rustup which --toolchain stable-aarch64-apple-darwin cargo)"
RUSTUP_RUSTC="$(rustup which --toolchain stable-aarch64-apple-darwin rustc)"
PATH="$(dirname "$RUSTUP_CARGO"):$PATH" RUSTC="$RUSTUP_RUSTC" CARGO_TARGET_DIR=target-ios \
  "$RUSTUP_CARGO" clippy --manifest-path src-tauri/Cargo.toml \
  -p agentero --target aarch64-apple-ios-sim --lib -- -D warnings
```

The Rustup paths are intentional: this workstation also has a Homebrew Rust
toolchain, and Cargo artifacts must not be shared across the two toolchains.

The mobile app requires iOS 15 or later and supports both iPhone and iPad. The
camera permission is requested only after the user selects QR pairing. Pairing
messages and Vault data are encrypted end to end; the Relay receives routing
metadata and opaque frames only.

## Apple Account Setup

1. In Certificates, Identifiers & Profiles, create the `com.poco-ai.agentero`
   App ID and enable the capabilities actually used by the build.
2. Install an Apple Development certificate for device testing and an Apple
   Distribution certificate plus App Store provisioning profile for TestFlight.
3. Set the team ID locally, without committing it:

```bash
export APPLE_DEVELOPMENT_TEAM="YOUR_TEAM_ID"
```

4. Create the app record in App Store Connect with the same bundle ID and
   category. Increment the build number for every upload.

## Archive And Upload

Create a signed TestFlight archive after a clean release build:

```bash
APPLE_DEVELOPMENT_TEAM="$APPLE_DEVELOPMENT_TEAM" \
  pnpm tauri ios build --config src-tauri/tauri.ios.conf.json \
  --target aarch64 --build-number "$(date +%y%m%d%H%M)" \
  --export-method app-store-connect
```

The build number must fit in a 32-bit unsigned integer, so the timestamp uses a
two-digit year.

Upload the generated IPA through Xcode Organizer or Transporter if the CLI does
not upload it as part of the selected export flow.

## App Store Connect Checklist

- Add a public privacy policy URL and complete the App Privacy questionnaire.
  Relay traffic, any configured Agent provider, and all third-party SDKs must
  be represented accurately.
- Complete export-compliance questions. Agentero uses standard TLS plus
  X25519/XSalsa20-Poly1305 and Ed25519 for the remote pairing protocol; do not
  claim the build is exempt without confirming the App Store Connect answers.
- Provide test credentials or an App Review note explaining how to pair an iOS
  device with the desktop Host at `relay.philfan.cn`.
- Add beta review contact information and test iPhone and iPad builds before
  inviting external testers.

Apple requires a camera usage description when an app accesses the camera, and
requires a privacy policy URL and accurate app privacy disclosures. See
[camera usage description](https://developer.apple.com/documentation/bundleresources/information-property-list/nscamerausagedescription),
[app privacy](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/),
and [upload builds](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/).
