# Counter Pay

Show the customer an exact-amount UPI QR with one shortcut, a few digits and Enter — without leaving your billing software or turning the monitor around.

Customers who scan an open standee QR type the amount themselves, and short payments slip through. Counter Pay puts a QR with the amount already set on a customer-facing screen, built from your own merchant standee QR so the money always goes to the same account.

> **Status:** Phase 1 (desktop app MVP) is in progress. Windows 10 and 11, x64.

## Install

1. Download `counter-pay-setup-<version>.exe` from [Releases](../../releases/latest) and run it. It installs for your Windows user only, with no admin prompt.
2. The installer isn't code-signed yet, so Windows may show "Windows protected your PC". Choose **More info → Run anyway**.
3. First-run setup takes about 3 minutes: import your merchant standee QR, check the shortcuts, pick a display, and do the ₹1 test.

Counter Pay updates itself from GitHub Releases. Updates download in the background and install only when the counter is quiet (10 pm–8 am by default, no QR showing) or when you quit. See [docs/RELEASING.md](docs/RELEASING.md) for publishing a new version.

## How it works at the counter

1. Ring up the bill as usual. The customer says "UPI".
2. Press **F9**. A slim pill rises from the bottom of the screen with the cursor in it.
3. Type the amount (`1140`) and press **Enter**. Focus goes straight back to your billing window.
4. The customer display switches to **Pay ₹1,140** with the QR. The amount is fixed by the shop.
5. When the payment is announced, press **Shift+F9** to clear. The display thanks the customer and goes back to your logo.

The customer display speaks English plus one Indian language of your choice: Hindi, Bengali, Marathi, Telugu, Tamil, Gujarati, Kannada, Malayalam, Punjabi or Odia (**Content → Display languages**).

A QR always ends: on Clear, on a new amount, when its time runs out (3 minutes by default), or if the display loses its link for more than 10 seconds.

## Displays

| Display | What you need | Notes |
| --- | --- | --- |
| Simulator | Nothing | A window on this PC. For trying the workflow. |
| Another monitor | A second screen on HDMI or USB-C | Full screen, never takes focus, never opens on the cashier's own screen. |
| Phone or tablet | Any browser on the shop Wi-Fi | Open the address shown in **Displays** and enter the 6-digit pairing code. Windows Firewall asks once whether to allow Counter Pay on private networks. |
| USB display (ESP32, E-ink) | — | Phase 2. |

## Shortcuts

The defaults are **F9** (show amount) and **Shift+F9** (clear). Change them in **Settings** by pressing the keys you want; try them on your billing screen first so nothing collides.

**F12 can't be used:** Windows reserves F12 (and Shift+F12) for debuggers, so no app can register it as a global shortcut.

### If your billing software runs as administrator

Windows won't let a normal app give focus back to an elevated window. If focus doesn't return after Enter, run Counter Pay elevated too, through Task Scheduler:

1. Task Scheduler → **Create Task**. Name it *Counter Pay*.
2. **General:** tick *Run with highest privileges*.
3. **Triggers:** *At log on* (your user).
4. **Actions:** *Start a program* → `%LOCALAPPDATA%\Programs\@counterpayagent\Counter Pay.exe`, arguments `--hidden`.
5. Turn off **Start at login** in Counter Pay's Settings, so it doesn't start twice.

## Develop

Requirements: Windows 10/11 x64, Node.js 22.12 or later, and pnpm 10 (`corepack enable`, or `npm i -g pnpm@10`). No C++ toolchain is needed: the native modules ship prebuilt.

```bash
pnpm install
pnpm test          # unit tests for every package
pnpm typecheck
pnpm dev           # display page (watch) + the app with hot reload
pnpm dist          # Windows installer in apps/agent/release/
```

GitHub Actions runs the type checks and tests on every push and pull request, and builds and publishes releases from version tags (see [docs/RELEASING.md](docs/RELEASING.md)).

A development build keeps its settings and History in `%APPDATA%\Counter Pay Dev`, apart from an installed copy.

### Repository layout

```
packages/core/       pure TypeScript: amounts, UPI links, references, scenes, state machine, protocol, config
packages/drivers/    display drivers behind one DisplayDriver interface (simulator, window, web; serial in Phase 2)
packages/plugins/    point-of-sale trigger interface; a read-only "bill saved" watcher in Phase 4
apps/agent/          the Electron app: tray agent, popup, toast, main window, local server, History
apps/display/        the customer display page, used by every browser-based display
locales/             app text (English) and customer display text (English + 10 Indian languages)
docs/                CONTRIBUTING.md, SECURITY.md, RELEASING.md, releases/ (release notes)
```

## Privacy and safety

- Counter Pay never writes to your billing software, its windows or its database.
- History records what was shown (time, amount, reference), not what was paid, and holds no customer data.
- The local API listens on `127.0.0.1` only and is off by default. Phones on Wi-Fi get a read-only page that needs a pairing code.
- See [docs/SECURITY.md](docs/SECURITY.md) for the threat model.

## License

[MIT](LICENSE)
