#!/usr/bin/env python3
"""Counter Pay display for a Raspberry Pi with a Waveshare e-Paper panel.

The PC draws every screen; this program puts the pixels on the panel and enforces the
safety rules on its own: a QR disappears when its time runs out, or 10 seconds after the
PC goes quiet. Protocol: docs/DISPLAY-PROTOCOL.md in the Counter Pay repository.

Two ways to reach the PC, both always on:
  * Wi-Fi: the PC finds this display on the network and pairs with the 6-digit code shown
    on the panel. Afterwards only that PC can put anything on the screen.
  * USB:   when the Pi runs as a USB serial gadget (/dev/ttyGS0), the PC sees it as a COM
    port and talks to it like an ESP32 board.

Try it on any computer without a panel:  python3 counterpay_display.py --panel mock
"""

import argparse
import hashlib
import hmac
import importlib
import json
import logging
import os
import queue
import secrets
import socket
import sys
import threading
import time
import uuid

FW = "pi-1.0.0"
DISCOVERY_PORT = 5180
TCP_PORT = 5181
LINK_LOSS_S = 10
HELLO_EVERY_S = 2
HANDSHAKE_S = 10
MAX_FRAME = 1 << 20
MAX_LINE = 4096
WRONG_CODES_BEFORE_NEW = 5
# A real refresh takes a second or more; one that "finishes" sooner means the panel isn't answering.
SILENT_REFRESH_S = 0.4

# Waveshare driver module -> Counter Pay panel profile.
PROFILES = {
    "epd2in13_V4": "waveshare-2in13-v4",
    "epd2in13b_V4": "waveshare-2in13b-v4",
    "epd4in2_V2": "waveshare-4in2",
    "epd7in5_V2": "waveshare-7in5",
}

log = logging.getLogger("counterpay")


# ---------- Panels ----------


class MockPanel:
    """No hardware: frames are written as .pbm files (the same 1-bit format the PC sends)."""

    profile = "waveshare-2in13-v4"
    w, h = 250, 122

    def __init__(self, folder):
        self.folder = folder
        os.makedirs(folder, exist_ok=True)
        self.count = 0

    def show_bits(self, bits, w, h, rot):
        self.count += 1
        path = os.path.join(self.folder, "frame-%04d-%dx%d-rot%d.pbm" % (self.count, w, h, rot))
        with open(path, "wb") as f:
            f.write(b"P4\n%d %d\n" % (w, h))
            f.write(bits)
        time.sleep(0.05)
        return 1.0

    def show_text(self, lines, rot):
        text = " | ".join(lines)
        log.info("screen: %s", text)
        with open(os.path.join(self.folder, "screen.txt"), "w", encoding="utf-8", newline="\n") as f:
            f.write("\n".join(lines) + "\n")
        return 1.0


class WavesharePanel:
    """A Waveshare e-Paper panel through Waveshare's own Python driver (waveshare_epd)."""

    def __init__(self, module):
        from PIL import Image, ImageDraw, ImageFont  # noqa: F401  (fail early if Pillow is missing)

        self.Image = Image
        self.ImageDraw = ImageDraw
        self.ImageFont = ImageFont
        self.module = importlib.import_module("waveshare_epd." + module)
        self.epd = self.module.EPD()
        self.profile = PROFILES.get(module)
        native = (self.epd.width, self.epd.height)
        self.w, self.h = max(native), min(native)
        # Three-colour panels take a second (red) buffer.
        self.two_planes = self.epd.display.__code__.co_argcount >= 3

    def _orient(self, image, rot):
        # Frames arrive drawn the way the customer sees them. Waveshare's getbuffer() turns a
        # landscape image upright by itself; 180 and 270 need the other way round.
        if rot in (180, 270):
            image = image.rotate(180)
        return image

    def _push(self, image, rot):
        image = self._orient(image, rot)
        started = time.monotonic()
        self.epd.init()
        buffer = self.epd.getbuffer(image)
        if self.two_planes:
            blank = self.Image.new("1", image.size, 255)
            self.epd.display(buffer, self.epd.getbuffer(blank))
        else:
            self.epd.display(buffer)
        took = time.monotonic() - started
        self.epd.sleep()
        return took

    def show_bits(self, bits, w, h, rot):
        image = self.Image.frombytes("1", (w, h), bits, "raw", "1;I")
        return self._push(image, rot)

    def _font(self, size, bold):
        name = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
        try:
            return self.ImageFont.truetype("/usr/share/fonts/truetype/dejavu/" + name, size)
        except OSError:
            try:
                return self.ImageFont.load_default(size)
            except TypeError:
                return self.ImageFont.load_default()

    def show_text(self, lines, rot):
        """A simple screen drawn here: the first line bold, the second large (a pairing code), the rest small."""
        portrait = rot in (90, 270)
        size = (self.h, self.w) if portrait else (self.w, self.h)
        image = self.Image.new("1", size, 255)
        draw = self.ImageDraw.Draw(image)
        sizes = [0.13, 0.22, 0.075, 0.075, 0.075]
        unit = min(size)
        rows = []
        for i, text in enumerate(lines):
            px = max(9, int(unit * sizes[min(i, len(sizes) - 1)] * (1.6 if portrait else 1)))
            font = self._font(px, i < 2)
            while px > 9 and draw.textlength(text, font=font) > size[0] - 6:
                px -= 1
                font = self._font(px, i < 2)
            rows.append((text, font, px))
        total = sum(int(px * 1.3) for _, _, px in rows)
        y = max(2, (size[1] - total) // 2)
        for text, font, px in rows:
            x = (size[0] - draw.textlength(text, font=font)) // 2
            draw.text((x, y), text, font=font, fill=0)
            y += int(px * 1.3)
        return self._push(image, rot)


# ---------- State kept across restarts ----------


class Store:
    def __init__(self, path):
        self.path = path
        self.data = {}
        try:
            with open(path, encoding="utf-8") as f:
                self.data = json.load(f)
        except (OSError, ValueError):
            pass
        if not isinstance(self.data.get("id"), str):
            self.data["id"] = uuid.uuid4().hex[:16]
            self.save()

    def save(self):
        os.makedirs(os.path.dirname(self.path) or ".", exist_ok=True)
        tmp = self.path + ".tmp"
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(self.data, f)
        os.replace(tmp, self.path)

    @property
    def key(self):
        key = self.data.get("key")
        return key if isinstance(key, str) and len(key) == 64 else None

    def set_key(self, key):
        if key:
            self.data["key"] = key
        else:
            self.data.pop("key", None)
        self.save()


# ---------- Links to a PC ----------


class Link:
    """One connection to a PC: an authenticated TCP socket or the USB serial gadget."""

    def __init__(self, name, write, close):
        self.name = name
        self._write = write
        self._close = close
        self.lock = threading.Lock()
        self.open = True

    def send(self, message):
        data = (json.dumps(message, separators=(",", ":")) + "\n").encode("utf-8")
        with self.lock:
            if not self.open:
                return
            try:
                self._write(data)
            except OSError:
                self.open = False

    def close(self):
        self.open = False
        try:
            self._close()
        except OSError:
            pass


class Parser:
    """Splits the byte stream into JSON lines and frames (a `frame` line, then `len` raw bytes)."""

    def __init__(self):
        self.buf = bytearray()
        self.header = None

    def feed(self, data):
        self.buf += data
        out = []
        while True:
            if self.header is not None:
                need = self.header["len"]
                if len(self.buf) < need:
                    break
                bits = bytes(self.buf[:need])
                del self.buf[:need]
                out.append(("frame", self.header, bits))
                self.header = None
                continue
            nl = self.buf.find(b"\n")
            if nl < 0:
                if len(self.buf) > MAX_LINE:
                    self.buf.clear()
                break
            line = bytes(self.buf[:nl]).strip()
            del self.buf[: nl + 1]
            if not line:
                continue
            try:
                message = json.loads(line.decode("utf-8", "replace"))
            except ValueError:
                continue
            if not isinstance(message, dict):
                continue
            if message.get("t") == "frame":
                size = message.get("len")
                if isinstance(size, int) and 0 < size <= MAX_FRAME:
                    self.header = message
                continue
            out.append(("message", message, None))
        return out


# ---------- The display ----------


class Display:
    def __init__(self, panel, store, rotation, name, port):
        self.panel = panel
        self.store = store
        self.rotation = rotation
        self.name = name
        self.port = port
        self.lock = threading.RLock()
        self.active = None
        self.last_heard = 0.0
        self.scene = "ambient"
        self.pay_until = 0.0
        self.ambient = None
        self.panel_ok = True
        self.code = None
        self.wrong_codes = 0
        self.jobs = queue.Queue()
        threading.Thread(target=self._worker, daemon=True).start()

    # --- drawing, one job at a time ---

    def _worker(self):
        while True:
            job = self.jobs.get()
            try:
                job()
            except Exception:  # A panel error must not stop the display.
                log.exception("drawing failed")

    def _note(self, took):
        self.panel_ok = took >= SILENT_REFRESH_S
        if not self.panel_ok:
            log.warning("the panel finished in %.2f s: it is probably not wired or powered", took)

    def draw_text(self, lines):
        def job():
            started = time.monotonic()
            self._note(self.panel.show_text(lines, self.rotation))
            log.info("drew the %s screen in %.1f s", lines[0] if len(lines) < 2 else "pairing/waiting", time.monotonic() - started)

        self.jobs.put(job)

    def draw_frame(self, header, bits, link):
        def job():
            started = time.monotonic()
            self._note(self.panel.show_bits(bits, header["w"], header["h"], header.get("rot", 0)))
            scene = header.get("scene", "ambient")
            log.info("drew a %s frame in %.1f s", scene, time.monotonic() - started)
            with self.lock:
                self.scene = scene
                if scene == "pay":
                    ttl = header.get("ttl")
                    self.pay_until = time.monotonic() + (ttl if isinstance(ttl, int) and ttl > 0 else 180)
                elif scene == "ambient":
                    self.ambient = (header, bits)
            if link:
                link.send({"t": "ack", "seq": header.get("seq", 0), "scene": scene, "panel": self.panel_state()})

        self.jobs.put(job)

    def panel_state(self):
        return "ok" if self.panel_ok else "silent"

    # --- screens drawn here ---

    def show_idle(self):
        if self.store.key is None:
            self.new_code()
        else:
            self.draw_text(["Counter Pay", "Waiting for the PC", self.name, ip_address()])

    def new_code(self):
        self.code = "%06d" % secrets.randbelow(1_000_000)
        self.wrong_codes = 0
        log.info("pairing code: %s", self.code)
        self.draw_text(["Counter Pay", "%s %s" % (self.code[:3], self.code[3:]), "Pair in Displays > Add", socket.gethostname() + ".local", ip_address()])

    def fall_back(self, reason):
        with self.lock:
            if self.scene != "pay":
                return
            self.scene = "ambient"
            ambient = self.ambient
            link = self.active
        log.info("pay screen cleared: %s", reason)
        if ambient:
            header, bits = ambient
            self.jobs.put(lambda: self._note(self.panel.show_bits(bits, header["w"], header["h"], header.get("rot", 0))))
        else:
            self.show_idle()
        if link:
            link.send({"t": "state", "scene": "ambient", "reason": reason})

    def tick(self):
        """Every half second: a QR must not outlive its time or the link."""
        with self.lock:
            paying = self.scene == "pay"
            expired = paying and time.monotonic() >= self.pay_until
            silent = paying and time.monotonic() - self.last_heard > LINK_LOSS_S
        if expired:
            self.fall_back("expired")
        elif silent:
            self.fall_back("link-lost")

    # --- the PC's messages ---

    def hello(self):
        message = {"t": "hello", "fw": FW, "w": self.panel.w, "h": self.panel.h, "panel": self.panel_state()}
        if self.panel.profile:
            message["profile"] = self.panel.profile
        return message

    def attach(self, link):
        with self.lock:
            old, self.active = self.active, link
            self.last_heard = time.monotonic()
        if old and old is not link:
            old.close()
        log.info("PC connected over %s", link.name)

    def detach(self, link):
        with self.lock:
            if self.active is link:
                self.active = None

    def handle(self, link, kind, value, bits):
        with self.lock:
            if link is self.active:
                self.last_heard = time.monotonic()
        if kind == "frame":
            portrait = value.get("rot", 0) in (90, 270)
            want = (self.panel.h, self.panel.w) if portrait else (self.panel.w, self.panel.h)
            if (value.get("w"), value.get("h")) != want or value.get("fmt") != "1bpp" or len(bits) != ((want[0] + 7) // 8) * want[1]:
                link.send(self.hello())  # Wrong size: the PC has the wrong panel chosen.
                return
            self.draw_frame(value, bits, link)
        elif value.get("t") == "who":
            link.send(self.hello())
        elif value.get("t") == "ping":
            with self.lock:
                scene = self.scene
            link.send({"t": "state", "scene": scene})

    # --- pairing and authentication (Wi-Fi only) ---

    def try_pair(self, code):
        with self.lock:
            if self.store.key is not None:
                return None, "paired"
            if not self.code or not hmac.compare_digest(str(code), self.code):
                self.wrong_codes += 1
                if self.wrong_codes >= WRONG_CODES_BEFORE_NEW:
                    self.new_code()
                return None, "code"
            key = secrets.token_hex(32)
            self.store.set_key(key)
            self.code = None
        log.info("paired")
        return key, None

    def check_mac(self, nonce, mac):
        key = self.store.key
        if key is None or not isinstance(mac, str):
            return False
        want = hmac.new(bytes.fromhex(key), nonce.encode("utf-8"), hashlib.sha256).hexdigest()
        return hmac.compare_digest(want, mac)

    def unpair(self, link):
        log.info("the PC asked this display to forget it")
        self.store.set_key(None)
        link.close()
        self.show_idle()


def ip_address():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("192.0.2.1", 9))  # No packet is sent; this only picks the outgoing interface.
            return s.getsockname()[0]
    except OSError:
        return ""


# ---------- Wi-Fi ----------


def discovery(display, store, bind):
    """Answers a PC's `discover` broadcast with who this display is."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind((bind, DISCOVERY_PORT))
    while True:
        try:
            data, sender = sock.recvfrom(2048)
            message = json.loads(data.decode("utf-8", "replace"))
            if not isinstance(message, dict) or message.get("t") != "discover":
                continue
            announce = {
                "v": 1,
                "t": "announce",
                "id": store.data["id"],
                "name": display.name[:64],
                "fw": FW,
                "w": display.panel.w,
                "h": display.panel.h,
                "port": display.port,
                "paired": store.key is not None,
                "rotation": display.rotation,
            }
            if display.panel.profile:
                announce["profile"] = display.panel.profile
            sock.sendto((json.dumps(announce) + "\n").encode("utf-8"), sender)
        except (OSError, ValueError):
            time.sleep(0.2)


def serve_tcp(display, store, bind):
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind((bind, display.port))
    server.listen(4)
    log.info("waiting for the PC on Wi-Fi, port %d", display.port)
    while True:
        conn, peer = server.accept()
        threading.Thread(target=tcp_session, args=(display, store, conn, peer), daemon=True).start()


def tcp_session(display, store, conn, peer):
    conn.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    link = Link("Wi-Fi from %s" % peer[0], conn.sendall, conn.close)
    nonce = secrets.token_hex(16)
    parser = Parser()
    link.send({"v": 1, "t": "challenge", "id": store.data["id"], "nonce": nonce, "paired": store.key is not None})
    conn.settimeout(HANDSHAKE_S)
    authed = False
    try:
        while not authed:
            data = conn.recv(4096)
            if not data:
                return
            for kind, value, _ in parser.feed(data):
                if kind != "message":
                    continue
                if value.get("t") == "pair":
                    key, refusal = display.try_pair(value.get("code", ""))
                    if refusal:
                        link.send({"v": 1, "t": "denied", "reason": refusal})
                        continue
                    link.send({"v": 1, "t": "paired", "key": key})
                    authed = True
                elif value.get("t") == "auth":
                    if display.check_mac(nonce, value.get("mac")):
                        link.send({"v": 1, "t": "authed"})
                        authed = True
                    else:
                        link.send({"v": 1, "t": "denied", "reason": "key"})
                        return
                if authed:
                    break
        conn.settimeout(None)
        display.attach(link)
        for kind, value, bits in parser.feed(b""):
            display.handle(link, kind, value, bits)
        while link.open:
            data = conn.recv(65536)
            if not data:
                break
            for kind, value, bits in parser.feed(data):
                if kind == "message" and value.get("t") == "unpair":
                    display.unpair(link)
                    return
                display.handle(link, kind, value, bits)
    except OSError:
        pass
    finally:
        display.detach(link)
        link.close()


# ---------- USB serial gadget ----------


def serve_usb(display, path):
    import termios
    import tty

    while True:
        try:
            fd = os.open(path, os.O_RDWR | os.O_NOCTTY)
        except OSError:
            time.sleep(3)
            continue
        try:
            tty.setraw(fd)
            termios.tcflush(fd, termios.TCIOFLUSH)
        except termios.error:
            pass
        link = Link("USB", lambda data, fd=fd: os.write(fd, data), lambda fd=fd: os.close(fd))
        parser = Parser()
        heard = False
        last_hello = 0.0
        try:
            import select

            while link.open:
                if not heard and time.monotonic() - last_hello >= HELLO_EVERY_S:
                    link.send(display.hello())  # Found by a PC that only listens.
                    last_hello = time.monotonic()
                ready, _, _ = select.select([fd], [], [], 0.5)
                if not ready:
                    continue
                data = os.read(fd, 65536)
                if not data:
                    time.sleep(0.5)
                    continue
                if not heard:
                    heard = True
                    display.attach(link)
                for kind, value, bits in parser.feed(data):
                    display.handle(link, kind, value, bits)
        except OSError:
            pass
        finally:
            display.detach(link)
            link.close()
        time.sleep(1)


# ---------- Main ----------


def main():
    parser = argparse.ArgumentParser(description="Counter Pay display for a Raspberry Pi e-Paper panel")
    parser.add_argument("--panel", default="epd2in13_V4", help="Waveshare driver module, e.g. epd2in13_V4 or epd2in13b_V4; or 'mock'")
    parser.add_argument("--rotation", type=int, default=0, choices=[0, 90, 180, 270], help="how the panel is mounted, for screens drawn here")
    parser.add_argument("--name", default=socket.gethostname(), help="the name shown when pairing")
    parser.add_argument("--port", type=int, default=TCP_PORT)
    parser.add_argument("--bind", default="", help="listen on this address only (default: every network)")
    parser.add_argument("--usb", default="/dev/ttyGS0", help="USB serial gadget device, or 'off'")
    parser.add_argument("--waveshare-lib", default="", help="folder that contains waveshare_epd")
    parser.add_argument("--state", default=os.path.expanduser("~/.config/counterpay-display/state.json"))
    parser.add_argument("--mock-dir", default="counterpay-frames", help="where --panel mock writes frames")
    parser.add_argument("--reset", action="store_true", help="forget the paired PC and exit")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    store = Store(args.state)
    if args.reset:
        store.set_key(None)
        print("Forgot the paired PC. Restart the display to show a new pairing code.")
        return

    # lgpio (the Pi's GPIO library) creates small pipe files in the current folder; a service
    # starts in /, where it can't, and then the panel won't open. Work from the state folder.
    work = os.path.dirname(os.path.abspath(args.state))
    os.makedirs(work, exist_ok=True)
    mock_dir = os.path.abspath(args.mock_dir)
    os.chdir(work)
    if args.waveshare_lib:
        sys.path.insert(0, os.path.abspath(os.path.expanduser(args.waveshare_lib)))
    if args.panel == "mock":
        panel = MockPanel(mock_dir)
    else:
        try:
            panel = WavesharePanel(args.panel)
        except Exception as error:  # Usually: SPI off, GPIO busy (another program has the panel) or a wrong module name.
            log.error("could not open the panel (%s): %s", args.panel, error)
            log.error("Is SPI on (sudo raspi-config)? Is another program using the panel? Is the driver name right?")
            sys.exit(2)

    display = Display(panel, store, args.rotation, args.name, args.port)
    display.show_idle()
    threading.Thread(target=discovery, args=(display, store, args.bind), daemon=True).start()
    threading.Thread(target=serve_tcp, args=(display, store, args.bind), daemon=True).start()
    if args.usb != "off" and os.name == "posix":
        threading.Thread(target=serve_usb, args=(display, args.usb), daemon=True).start()
    log.info("Counter Pay display %s (%s) ready", store.data["id"], args.panel)
    try:
        while True:
            time.sleep(0.5)
            display.tick()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
