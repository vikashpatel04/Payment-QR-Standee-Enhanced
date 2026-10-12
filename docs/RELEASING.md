# Releasing

Installed copies of Counter Pay update themselves from the GitHub Releases of the repository named in `apps/agent/package.json` (`repository`). A fork changes that one field to ship its own updates.

Releases are built and published by GitHub Actions (`.github/workflows/release.yml`) on GitHub's Windows machines, so nobody's PC is needed.

## Steps

1. Bump `version` in `apps/agent/package.json` (`0.1.2`, `0.2.0`…). Never reuse a version: installed apps only move up.
2. Write the release notes in `docs/releases/v<version>.md` (optional: without it, GitHub generates notes from the commits).
3. Commit, push, then tag and push the tag:

   ```bash
   git commit -am "Release 0.1.2"
   git push
   git tag v0.1.2
   git push origin v0.1.2
   ```

The **Release** workflow then type-checks, tests, builds the installer, runs the packaged app's `--self-test`, and publishes a release with the three files installed copies need:

| File | Why |
| --- | --- |
| `counter-pay-setup-<version>.exe` | The installer, for new installs and for updates |
| `counter-pay-setup-<version>.exe.blockmap` | Lets updates download only the changed parts |
| `latest.yml` | The version and SHA-512 the app checks before installing |

It refuses to publish if the tag doesn't match the version in `apps/agent/package.json`. A version like `0.2.0-beta.1` is published as a pre-release, which only shops on the Beta channel get.

**Dry run:** Actions → Release → **Run workflow** builds and self-tests without publishing, and keeps the installer as a downloadable artifact for 7 days.

## What happens on the shop PC

- The app checks at launch and every 6 hours (or on **Check for updates** in the tray or Settings) and downloads in the background.
- It installs when the app quits, or by itself in the shop's quiet hours (10 pm–8 am by default) when no QR is showing and the popup has been idle for 10 minutes. It never restarts during billing.
- After an update, Home shows "Counter Pay was updated" with a link to the release notes.

## Rules

- Don't replace a published release's files: `latest.yml` holds the installer's SHA-512, so the two must come from the same build.
- Releases aren't code-signed yet, so Windows SmartScreen warns on a fresh install (**More info → Run anyway**). Updates install silently. Signing (SignPath Foundation or Azure Trusted Signing) is still to do.
