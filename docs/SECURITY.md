# Security

Counter Pay decides where a shop's money goes, so the main threat is a QR that pays someone else, or a stale QR that charges the next customer. This is how each risk is handled, and how to report a problem.

## Reporting a vulnerability

Please don't open a public issue. Use GitHub's **Report a vulnerability** (private security advisory) on this repository. You'll get a reply within a week.

## Threat model

| Threat | How Counter Pay handles it |
| --- | --- |
| **The payee is swapped** (someone edits the config, or malware rewrites the UPI ID) | The payee comes only from the shop's own standee QR, decoded once in setup. Every pay screen shows "Paying: *name*" so the customer can compare it with the name their UPI app shows. Phase 2 smart displays keep the payee in their own flash, and changing it needs a physical button held on the device, so the PC alone can't change it. Frame-mode displays can't check, and Settings says so. |
| **A previous customer's QR is still on screen** | Every pay QR has a ttl (3 minutes by default). The display enforces it itself, even if the PC app crashes, and drops the QR after 10 seconds without hearing from the PC. Phase 4 also clears on bill save. |
| **Someone on the shop Wi-Fi drives the display** | The Wi-Fi server is read-only: it serves the display page and pushes scenes, nothing else. A screen needs the 6-digit pairing code (five tries per minute per address), and a new code signs out every screen paired with the old one. The Wi-Fi server runs only while a phone or tablet display is turned on. |
| **Someone on the shop Wi-Fi puts their own QR on a Wi-Fi E-ink display** | A Wi-Fi display is paired once with the 6-digit code shown on its own screen, and keeps a random 32-byte key. Every later connection starts with a fresh challenge that only a PC holding the key can answer (HMAC-SHA256), so the key never crosses the network again, and the display shows nothing from any other connection. Five wrong codes and the display shows a new one. Pairing a different PC needs a reset on the display itself. See [DISPLAY-PROTOCOL.md](DISPLAY-PROTOCOL.md). |
| **A local program shows its own QR** | The local server binds to `127.0.0.1`. Display windows present a random key generated at each launch. The Phase 3 API needs a bearer token and is off by default. |
| **The amount is wrong** | Amounts are integer paise end to end, never floats. A maximum amount (₹1,00,000 by default) catches an extra zero. |
| **An update restarts the app mid-bill** | Updates install only on quit or during quiet hours, never while a QR is showing. |
| **Counter Pay touches the billing software** | It never writes to the billing software's windows or database. Phase 4 point-of-sale plugins only read, through a read-only login. |

## What the repository must never contain

Real UPI IDs, shop names, credentials or personal data, in code, tests or fixtures. Use placeholders such as `shop@okaxis` and `YOUR SHOP NAME`.
