# Releasing

Installed copies of Counter Pay update themselves from the GitHub Releases of the repository named in `apps/agent/package.json` (`repository`). A fork changes that one field to ship its own updates. Each release must carry three files, exactly as the build wrote them:

| File | Why |
| --- | --- |
| `counter-pay-setup-<version>.exe` | The installer, for new installs and for updates |
| `counter-pay-setup-<version>.exe.blockmap` | Lets updates download only the changed parts |
| `latest.yml` | The version and SHA-512 the app checks before installing |

## Steps

1. Bump `version` in `apps/agent/package.json` (`0.1.1`, `0.2.0`…). Never reuse a version: installed apps only move up.
2. Check and build:

   ```bash
   pnpm test
   pnpm typecheck
   pnpm dist
   ```

   The files land in `apps/agent/release/<version>/`. A quick check of the packaged app:

   ```bash
   "apps/agent/release/<version>/win-unpacked/Counter Pay.exe" --self-test
   ```

3. Commit, tag and publish:

   ```bash
   git commit -am "Release <version>"
   git push
   gh release create v<version> apps/agent/release/<version>/counter-pay-setup-<version>.exe apps/agent/release/<version>/counter-pay-setup-<version>.exe.blockmap apps/agent/release/<version>/latest.yml --title "Counter Pay <version>" --notes-file notes.md
   ```

   For the Beta channel, use a version like `0.2.0-beta.1` and add `--prerelease`. Only shops that chose Beta in Settings get it.

## What happens on the shop PC

- The app checks at launch and every 6 hours (or on **Check for updates** in the tray or Settings) and downloads in the background.
- It installs when the app quits, or by itself in the shop's quiet hours (10 pm–8 am by default) when no QR is showing and the popup has been idle for 10 minutes. It never restarts during billing.
- After an update, Home shows "Counter Pay was updated" with a link to the release notes.

## Rules

- Don't replace a published release's files: `latest.yml` holds the installer's SHA-512, so the two must come from the same build.
- Releases aren't code-signed yet, so Windows SmartScreen warns on a fresh install (**More info → Run anyway**). Updates install silently. Signing (SignPath Foundation or Azure Trusted Signing) is still to do.
