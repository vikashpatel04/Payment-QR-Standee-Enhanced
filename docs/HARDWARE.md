# E-ink displays

Two ways to add an E-ink panel:

- **Raspberry Pi with a Waveshare e-Paper HAT**, over Wi-Fi (or USB): the HAT plugs straight onto the Pi, no wiring. Tested end to end on a Pi Zero 2 W with a 2.13" HAT. See [clients/raspberry-pi](../clients/raspberry-pi/README.md).
- **ESP32 board with a Waveshare panel**, over USB: described below.

Building your own? [DISPLAY-PROTOCOL.md](DISPLAY-PROTOCOL.md) describes what a display has to do.

## USB E-ink display (ESP32)

An E-ink panel driven by a small ESP32 board, plugged into the counter PC by one USB cable that carries both power and data. The PC draws every screen; the board only puts the pixels on the panel. The board also enforces the safety rules itself: it clears a QR when its time runs out, and when it hears nothing from the PC for 10 seconds.

> **Beta.** The app, the USB link and the firmware are tested end to end with a real ESP32 board, but no ESP32-driven panel has been confirmed drawing yet (the Raspberry Pi display has). If yours shows **Check wiring**, or works, please open an issue with your board and panel so this page can list them.

### What you need

| Part | Notes |
| --- | --- |
| ESP32 dev board | Any ESP32-WROOM board with a USB-serial chip, e.g. NodeMCU-32 or ESP32 DevKitC (CH340, CP2102 or similar). About ₹400–600. |
| Waveshare e-Paper panel with a driver HAT or module | Black and white only. Red or yellow panels take 12–20 seconds to refresh, too slow at the counter. |
| 8 female-to-female jumper wires | Waveshare HATs come with a cable for their small 8-pin connector, which can be used instead. |
| USB data cable | Some cheap cables carry power only; if the PC doesn't see the board, try another cable. |

Supported panels:

| Panel | Size | Firmware environment | Notes |
| --- | --- | --- | --- |
| Waveshare 2.13" e-Paper HAT V4 | 250 × 122 | `esp32-waveshare-2in13-v4` | The QR is about 2 cm across. Good for trying; small for daily use. |
| Waveshare 4.2" e-Paper V2 | 400 × 300 | `esp32-waveshare-4in2` | The recommended size for a counter. |
| Waveshare 7.5" e-Paper V2 | 800 × 480 | `esp32-waveshare-7in5` | Large. |

### Wiring

Use the HAT's small 8-pin connector, not its 40-pin Raspberry Pi header. The pins are labelled on the board next to the connector. ESP32 boards label their pins by GPIO number, sometimes with a prefix (`5`, `D5`, `IO5` or `G5` are all GPIO 5).

| Panel pin | ESP32 pin |
| --- | --- |
| VCC | 3V3 |
| GND | GND |
| DIN | GPIO 23 |
| CLK | GPIO 18 |
| CS | GPIO 5 |
| DC | GPIO 17 |
| RST | GPIO 16 |
| BUSY | GPIO 4 |

- Power the panel from **3V3**, not 5V or VIN.
- Newer HAT revisions have a ninth pin, **PWR**. Connect it to 3V3 as well.
- If your HAT has an interface switch, set it to **4-line SPI**.
- Different pins? Change `CP_PIN_*` in [firmware/frame-generic/platformio.ini](../firmware/frame-generic/platformio.ini) and flash again.

#### No 8-pin cable? Use the 40-pin socket

The HAT's 40-pin socket carries the same signals, so 8 male-to-female jumper wires work too. The labels next to the white connector don't apply here: count the socket's positions instead. Odd numbers are in the inner row, even numbers along the board edge, and pins 1 and 2 are at the end nearest the panel's yellow ribbon.

| Socket pin | Signal | ESP32 pin |
| --- | --- | --- |
| 1 | VCC | 3V3 |
| 6 | GND | GND |
| 11 | RST | GPIO 16 |
| 18 | BUSY | GPIO 4 |
| 19 | DIN | GPIO 23 |
| 22 | DC | GPIO 17 |
| 23 | CLK | GPIO 18 |
| 24 | CS | GPIO 5 |

An ESP32 board can't plug straight into this socket: it is laid out for a Raspberry Pi, and its other pins carry 5V. For no wires at all, a board with the panel's ribbon connector built in (such as Waveshare's e-Paper ESP32 Driver Board) takes the panel directly.

### Flashing the firmware (once)

Flashing replaces whatever program is on the board.

1. Install [PlatformIO Core](https://docs.platformio.org/en/latest/core/installation/index.html) (or the PlatformIO extension for VS Code).
2. Plug the board in and find its port in Device Manager → **Ports (COM & LPT)**, e.g. `USB-SERIAL CH340 (COM3)`. No port? Install the driver for the board's USB chip (CH340 or CP210x).
3. From `firmware/frame-generic`, run the environment for your panel:

   ```bash
   pio run -e esp32-waveshare-2in13-v4 -t upload --upload-port COM3
   ```

4. If the upload stops at `Connecting...`, hold the board's **BOOT** button until it starts writing.

After flashing, the panel shows **Counter Pay · Waiting for the PC**.

### Connecting it in Counter Pay

1. **Displays → Add display → USB E-ink display.**
2. Leave **USB port** on **Find it automatically**, or pick the board's port.
3. Choose your **Panel**, and a **Rotation** if the panel is mounted the other way up.
4. The status turns **Connected** within a few seconds, and the card shows exactly what the panel shows.
5. Press **Test pattern** to check every pixel.

Close the Arduino or PlatformIO serial monitor first: only one program can use a port at a time.

**Check wiring** means the board answered but its panel didn't draw: a real refresh takes about a second, and the board noticed it finished far too soon (no power to the panel, or BUSY not connected) or never finished (BUSY stuck). The panel keeps showing its old picture. Check VCC, GND and BUSY first. Until it's fixed, the display counts as offline, so the cashier is warned that the customer can't see the QR.

#### Receipt printers and other COM devices

Some receipt printers and scanners use the same USB-serial chips as ESP32 boards. **Find it automatically** only listens on each port for a Counter Pay board's hello and never sends anything, so it can't print or send stray characters to another device. Picking the port by hand skips the search entirely.

### How it behaves

- Pay screens use a full refresh, so the QR is crisp and has no ghosting. Ambient slides change with a quick partial refresh, and every fifth change is a full refresh to clean the screen.
- Ambient slides never change while a QR is showing.
- If the cable is pulled while a QR shows, the board clears it within 10 seconds and the app warns the cashier. When the cable goes back in, the board reconnects and shows the current screen.
- E-ink keeps its image without power. A QR left on screen after a power cut can be stale, so treat a QR on an unpowered display as expired.
