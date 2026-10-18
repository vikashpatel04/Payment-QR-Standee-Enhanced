#!/usr/bin/env bash
# Installs the Counter Pay display on a Raspberry Pi with a Waveshare e-Paper panel and starts
# it at every boot.
#
#   ./install.sh --panel epd2in13b_V4 --rotation 90
#
#   --panel     Waveshare driver for your panel (default epd2in13_V4). Common ones:
#               epd2in13_V4 (2.13" black and white), epd2in13b_V4 (2.13" with red),
#               epd4in2_V2 (4.2"), epd7in5_V2 (7.5").
#   --rotation  How the panel is mounted: 0 (wide) or 90 (tall, like a standee). Default 0.
set -euo pipefail

PANEL=epd2in13_V4
ROTATION=0
while [ $# -gt 0 ]; do
  case "$1" in
    --panel) PANEL="$2"; shift 2 ;;
    --rotation) ROTATION="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

HERE="$(cd "$(dirname "$0")" && pwd)"
USER_NAME="$(id -un)"
# In the user's home, so updating it later needs no sudo: copy the new file and restart.
DEST="$HOME/.local/share/counterpay-display"
REBOOT=no

echo "== 1/5 System packages"
sudo apt-get update -qq
sudo apt-get install -y -qq python3-pil python3-spidev python3-gpiozero python3-lgpio fonts-dejavu-core git

echo "== 2/5 SPI (the panel's connection)"
if [ ! -e /dev/spidev0.0 ]; then
  sudo raspi-config nonint do_spi 0
  REBOOT=yes
fi

echo "== 3/5 Waveshare panel driver"
LIB=""
for candidate in "$HOME/e-Paper/RaspberryPi_JetsonNano/python/lib" "$DEST/waveshare/RaspberryPi_JetsonNano/python/lib"; do
  if [ -d "$candidate/waveshare_epd" ]; then LIB="$candidate"; break; fi
done
if [ -z "$LIB" ]; then
  # Only the driver folder of Waveshare's large repository.
  rm -rf "$DEST/waveshare"
  mkdir -p "$DEST"
  git clone -q --depth 1 --filter=blob:none --sparse https://github.com/waveshareteam/e-Paper "$DEST/waveshare"
  git -C "$DEST/waveshare" sparse-checkout set RaspberryPi_JetsonNano/python/lib
  LIB="$DEST/waveshare/RaspberryPi_JetsonNano/python/lib"
fi
if [ ! -f "$LIB/waveshare_epd/$PANEL.py" ]; then
  echo "There is no driver called $PANEL. These are available:"
  ls "$LIB/waveshare_epd" | grep '^epd' | sed 's/\.py$//' | tr '\n' ' '
  echo
  exit 1
fi
echo "Using $LIB"

echo "== 4/5 Counter Pay display"
mkdir -p "$DEST"
install -m 755 "$HERE/counterpay_display.py" "$DEST/counterpay_display.py"
# The first version installed here; nothing of it is needed any more.
if [ -d /opt/counterpay-display ]; then sudo rm -rf /opt/counterpay-display; fi

echo "== 5/5 Start at boot"
if pgrep -f payment_dashboard.py >/dev/null 2>&1; then
  echo "Another program (payment_dashboard.py) is using the panel. Stopping it."
  pkill -f payment_dashboard.py || true
fi
sudo tee /etc/systemd/system/counterpay-display.service >/dev/null <<EOF
[Unit]
Description=Counter Pay display
After=network-online.target
Wants=network-online.target

[Service]
User=$USER_NAME
WorkingDirectory=$DEST
ExecStart=/usr/bin/python3 $DEST/counterpay_display.py --panel $PANEL --rotation $ROTATION --waveshare-lib $LIB
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable counterpay-display >/dev/null

if [ "$REBOOT" = yes ]; then
  echo
  echo "SPI was just turned on: restart the Pi now (sudo reboot). The display starts by itself afterwards."
else
  sudo systemctl restart counterpay-display
  sleep 8
  if systemctl is-active --quiet counterpay-display && [ "$(systemctl show -p NRestarts --value counterpay-display)" = 0 ]; then
    echo
    echo "Done. The panel shows a 6-digit code: in Counter Pay, open Displays > Add display > Wi-Fi E-ink display."
  else
    echo
    echo "The display program could not start. Its log:"
    journalctl -u counterpay-display -n 25 --no-pager || true
    echo
    echo "Programs that may be holding the panel:"
    ps -eo pid,user,cmd | grep -iE 'python|epd|pwnagotchi' | grep -v -e grep -e counterpay_display || echo "  (none found)"
    exit 1
  fi
fi
