# Counter Pay display for Raspberry Pi

Turns a Raspberry Pi with a Waveshare e-Paper HAT into a Counter Pay customer display: a standee that shows the exact amount's QR when the cashier presses F9. It works over the shop Wi-Fi, or over USB when the Pi runs as a USB gadget. It is a single Python file with no packages beyond what Raspberry Pi OS provides.

Tested hardware: Raspberry Pi Zero 2 W (Raspberry Pi OS based on Debian 13) with a Waveshare 2.13" e-Paper HAT, driver `epd2in13b_V4`: each screen takes about 4.5 seconds. Any panel with a driver in Waveshare's [Python library](https://github.com/waveshareteam/e-Paper/tree/master/RaspberryPi_JetsonNano/python/lib/waveshare_epd) should work.

## Install

On the Pi (Raspberry Pi OS, with the HAT on the 40-pin header and the Pi on the same network as the Counter Pay PC), get this repository (its address is under **Code** on its GitHub page) and run the installer:

```bash
git clone --depth 1 <repository address>
bash Payment-QR-Standee-Enhanced/clients/raspberry-pi/install.sh --panel epd2in13_V4 --rotation 90
```

Or copy just this folder to the Pi from your PC: `scp -r clients/raspberry-pi <user>@<pi-name>.local:counterpay-display`, then run `bash counterpay-display/install.sh …` on the Pi.

- `--panel` is Waveshare's driver for your panel: `epd2in13_V4` (2.13" black and white), `epd2in13b_V4` (2.13" with red), `epd4in2_V2`, `epd7in5_V2`… The installer lists the others if the name is wrong.
- `--rotation 90` for a panel standing upright like a standee, `0` for wide.

The installer installs the system packages, turns SPI on (then asks for one restart), fetches only the driver folder of Waveshare's library unless it is already in `~/e-Paper`, and starts the display at every boot.

The panel then shows **Counter Pay** with a 6-digit code.

## Pair it with Counter Pay

On the PC: **Displays → Add display → Wi-Fi E-ink display**. The Pi appears in the list; pick it, type the code from the panel, and press **Pair**. From then on the display shows only what that PC sends: nobody else on the network can put a QR on it.

If the Pi isn't listed (some routers block the PC's search), type its address instead: the panel shows it under the code.

**How fast:** every screen change, including a new amount, appears after one full refresh: about 4.5 seconds on the tested 2.13" HAT, about 2 seconds on black-and-white panels with `epd2in13_V4`, and up to 15 seconds on some three-colour panels.

## Over USB instead of Wi-Fi

A Pi Zero can be a USB serial device, so it needs no network: Counter Pay finds it like an ESP32 board. Use the Pi's **USB** data port (not PWR), then:

```bash
echo dtoverlay=dwc2 | sudo tee -a /boot/firmware/config.txt
echo -e "dwc2\ng_serial" | sudo tee -a /etc/modules
sudo reboot
```

In Counter Pay, add a **USB E-ink display** and leave the port on **Find it automatically**. The display keeps listening on Wi-Fi as well.

## Everyday

| | |
| --- | --- |
| Status and log | `systemctl status counterpay-display`, `journalctl -u counterpay-display -f` |
| Pair with another PC | `python3 ~/.local/share/counterpay-display/counterpay_display.py --reset && pkill -f counterpay_display.py` (it restarts by itself with a new code), or press **Remove** on the display in Counter Pay, which makes it forget the PC |
| Update | Copy the new `counterpay_display.py` over `~/.local/share/counterpay-display/counterpay_display.py`, then `pkill -f counterpay_display.py`: it restarts by itself. No sudo needed. |
| Change panel or rotation | Run `install.sh` again with the new options |
| Uninstall | `sudo systemctl disable --now counterpay-display && sudo rm /etc/systemd/system/counterpay-display.service && rm -rf ~/.local/share/counterpay-display ~/.config/counterpay-display` |

**"GPIO busy"** in the log means another program has the panel. Stop it (for example an older dashboard script), then `sudo systemctl restart counterpay-display`.

## Try it without a Pi

```bash
python3 counterpay_display.py --panel mock
```

Frames arrive as `.pbm` images in `counterpay-frames/`, and the pairing code is printed. The protocol is described in [docs/DISPLAY-PROTOCOL.md](../../docs/DISPLAY-PROTOCOL.md).
