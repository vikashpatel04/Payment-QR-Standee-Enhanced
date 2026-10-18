# Build your own display

Any board with a screen can be a Counter Pay customer display: an ESP32, a Raspberry Pi, an Arduino with Wi-Fi. The PC draws every screen at your panel's exact size and sends the pixels; your board only has to show them and follow two safety rules. Two ready-made displays use this protocol:

- [firmware/frame-generic](../firmware/frame-generic): ESP32 over USB
- [clients/raspberry-pi](../clients/raspberry-pi): Raspberry Pi over Wi-Fi or USB, with a `--panel mock` mode for trying it on any computer

## Safety rules

Every display must do these by itself, because the PC can crash, sleep or lose its cable:

1. **A QR has a time limit.** When a `pay` frame's `ttl` seconds have passed, go back to the last `ambient` frame (or your own "waiting" screen).
2. **A QR needs the PC.** If nothing arrives from the PC for **10 seconds** while a `pay` frame shows, go back to Ambient. The PC sends a `ping` every 5 seconds, so silence means the link is gone.
3. **Never show a QR after a restart.** Start on your own waiting screen.

When you go back to Ambient by yourself, tell the PC: `{"t":"state","scene":"ambient","reason":"expired"}` (or `"link-lost"`).

## Messages

Both directions use one JSON object per line, ending in `\n`.

### From the PC

| Message | Meaning |
| --- | --- |
| `{"v":1,"t":"who"}` | Say hello. |
| `{"v":1,"t":"ping","seq":4}` | Every 5 s. Over Wi-Fi, answer with a `state` line (see below). |
| `{"v":1,"t":"frame","seq":3,"w":250,"h":122,"fmt":"1bpp","len":3904,"refresh":"full","scene":"pay","ttl":180,"rot":0}` | Followed immediately by `len` raw bytes of pixels. |

A frame's pixels are 1 bit per pixel, row by row, most significant bit first, each row padded to a whole byte. A set bit is black. `len` is `ceil(w / 8) × h`.

- `w` × `h` is the size as the customer sees it: your panel's landscape size for `rot` 0 or 180, swapped for 90 or 270. Turn the image to fit your panel.
- `scene` is `ambient`, `pay` or `thanks`. Keep the last `ambient` frame to fall back to.
- `ttl` (pay only) is the QR's remaining seconds.
- `refresh` is `full` or `partial`. Pay frames are always full, so the QR is crisp. Ignore `partial` if your panel can't do it.

### From the display

| Message | When |
| --- | --- |
| `{"t":"hello","fw":"1.0.0","w":250,"h":122,"profile":"waveshare-2in13-v4","panel":"ok"}` | On `who`. `w` × `h` is the panel's landscape size. `profile` is optional ([profiles](../packages/core/src/profiles.ts)). `panel` is `silent` when your last refresh showed the panel isn't drawing (wiring or power), so the cashier is warned. |
| `{"t":"ack","seq":3,"scene":"pay","panel":"ok"}` | After a frame is **on the glass**, not just received. |
| `{"t":"state","scene":"ambient","reason":"expired"}` | You went back to Ambient by yourself, or (Wi-Fi) in answer to a `ping`. |

A frame of the wrong size: drop it and send `hello` again, so the PC sees your real size.

## USB

Open the serial port at 460800 baud (the speed is ignored by USB gadgets). The PC finds displays by **listening** on USB serial ports for a hello, and never writes to a port that hasn't said one: a receipt printer on the same kind of USB chip must never receive stray bytes. So until you hear from the PC, **send your hello every 2 seconds**.

No pairing is needed over USB: plugging the cable in is the permission.

## Wi-Fi

Over Wi-Fi anyone on the network could reach your display, so it must only accept frames from the PC it was paired with.

**Being found.** Listen for UDP on port **5180**. The PC broadcasts `{"v":1,"t":"discover"}`; answer the sender with:

```json
{"v":1,"t":"announce","id":"3f9c2a71b4e0d815","name":"counter","fw":"1.0.0","w":250,"h":122,"profile":"waveshare-2in13-v4","port":5181,"paired":false,"rotation":90}
```

`id` is yours to choose (letters, digits, `-`, `_`; up to 64) and must stay the same for the life of the display: the PC finds you by it when your address changes. `rotation` (optional) is how the panel is mounted, so the PC draws upright from the start.

**Pairing.** While not paired, show a random 6-digit code on your screen and listen for TCP on port **5181**:

1. On every connection, send first: `{"v":1,"t":"challenge","id":"…","nonce":"<32 random hex characters>","paired":false}`
2. The PC sends `{"v":1,"t":"pair","code":"482913"}`.
3. Right code: create a random 32-byte key, store it, and send `{"v":1,"t":"paired","key":"<64 hex characters>"}`. The connection is now trusted.
4. Wrong code: send `{"v":1,"t":"denied","reason":"code"}`. After 5 wrong codes, show a new code.
5. Already paired: send `{"v":1,"t":"denied","reason":"paired"}`. Pairing again needs a reset on the display itself.

**Every later connection.** After the `challenge`, the PC sends `{"v":1,"t":"auth","mac":"…"}`, where `mac` is the HMAC-SHA256 of the nonce (as text) with the key (as bytes), in hex. Compare it in constant time. Right: send `{"v":1,"t":"authed"}`. Wrong: send `{"v":1,"t":"denied","reason":"key"}` and close. Only then do `who`, `frame` and the rest follow. A new trusted connection replaces the old one.

**Forgetting.** On `{"v":1,"t":"unpair"}` from a trusted connection, delete the key, close, and show a new pairing code.

**Staying alive.** The PC closes a Wi-Fi link that has been silent for 12 seconds, so answer each `ping` with a `state` line.

The key never crosses the network after pairing, and frames from anyone else are never shown, so nobody else on the shop Wi-Fi can put their own QR on your display.
