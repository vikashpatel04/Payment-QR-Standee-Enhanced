// Counter Pay frame-generic firmware.
//
// The PC sends one JSON line per message over USB serial (see packages/core/src/protocol.ts):
//   {"v":1,"t":"frame","seq":3,"w":250,"h":122,"fmt":"1bpp","len":3904,"refresh":"full","scene":"pay","ttl":180,"rot":0}
//   followed by `len` raw bytes: 1 bit per pixel, row by row, MSB first, set bit = black.
//   {"v":1,"t":"ping","seq":4}   every 5 s
//   {"v":1,"t":"who"}            asks for the hello again
// The board answers with hello, ack and state lines.
//
// Safety rules enforced here, so a crashed or unplugged PC can never leave a QR up:
//   - a pay frame disappears when its ttl runs out;
//   - a pay frame disappears after 10 s without hearing from the PC;
//   in both cases the last Ambient frame comes back (or a built-in screen if there is none).

#include <Arduino.h>
#include <GxEPD2_BW.h>

#if defined(CP_PANEL_2IN13_V4)
#define CP_PANEL GxEPD2_213_GDEY0213B74
#define CP_PROFILE "waveshare-2in13-v4"
#elif defined(CP_PANEL_4IN2_V2)
#define CP_PANEL GxEPD2_420_GDEY042T81
#define CP_PROFILE "waveshare-4in2"
#elif defined(CP_PANEL_7IN5_V2)
#define CP_PANEL GxEPD2_750_GDEY075T7
#define CP_PROFILE "waveshare-7in5"
#else
#error "Choose a panel: build with -D CP_PANEL_2IN13_V4, CP_PANEL_4IN2_V2 or CP_PANEL_7IN5_V2"
#endif

GxEPD2_BW<CP_PANEL, CP_PANEL::HEIGHT> display(CP_PANEL(CP_PIN_CS, CP_PIN_DC, CP_PIN_RST, CP_PIN_BUSY));

// Landscape is the default orientation; frames are sent at the panel's landscape size.
// Some controllers hold more rows than the glass shows (2.13": 128 for 122 visible), so
// frames cover the visible area only.
static const int16_t PANEL_W = CP_PANEL::WIDTH_VISIBLE;
static const int16_t PANEL_H = CP_PANEL::HEIGHT;
static const int16_t LANDSCAPE_W = PANEL_W > PANEL_H ? PANEL_W : PANEL_H;
static const int16_t LANDSCAPE_H = PANEL_W > PANEL_H ? PANEL_H : PANEL_W;
static const uint8_t BASE_ROTATION = PANEL_W > PANEL_H ? 0 : 1;
static const size_t MAX_FRAME = ((LANDSCAPE_W + 7) / 8) * LANDSCAPE_H;

static const uint32_t LINK_LOSS_MS = 10000;
// Until the PC answers, say hello this often: opening the port doesn't reset every board,
// and the PC finds boards by listening, never by writing to ports that may be printers.
static const uint32_t HELLO_EVERY_MS = 2000;
static const uint32_t FRAME_TIMEOUT_MS = 3000;
static const uint8_t FULL_REFRESH_EVERY = 5;

struct Header {
  long seq;
  int w;
  int h;
  size_t len;
  bool partial;
  char scene[8];
  long ttl;
  int rot;
};

static char line[512];
static size_t lineLen = 0;

static uint8_t *rxBuf = nullptr;
static uint8_t *ambientBuf = nullptr;
static bool haveAmbient = false;
static Header ambientHeader;

static bool receiving = false;
static Header pending;
static size_t received = 0;
static uint32_t receiveStarted = 0;

static char currentScene[8] = "ambient";
static uint32_t payUntil = 0;
static uint32_t lastHeard = 0;
// A real full refresh takes about a second (CP_PANEL::full_refresh_time). One that "finishes"
// far sooner means the panel never answered (no power, or BUSY not wired); one that runs into
// the library's 10 s busy timeout means BUSY is stuck. Either way the customer sees nothing.
static bool panelOk = true;
static bool heardPc = false;
static uint32_t lastHello = 0;
static uint8_t partials = 0;

// ---------- Minimal JSON reading for flat objects ----------

static const char *findKey(const char *json, const char *key) {
  char pattern[24];
  snprintf(pattern, sizeof(pattern), "\"%s\":", key);
  const char *at = strstr(json, pattern);
  return at ? at + strlen(pattern) : nullptr;
}

static bool readString(const char *json, const char *key, char *out, size_t size) {
  const char *at = findKey(json, key);
  if (!at || *at != '"') return false;
  at++;
  size_t n = 0;
  while (*at && *at != '"' && n + 1 < size) out[n++] = *at++;
  out[n] = '\0';
  return *at == '"';
}

static bool readLong(const char *json, const char *key, long *out) {
  const char *at = findKey(json, key);
  if (!at) return false;
  char *end = nullptr;
  long value = strtol(at, &end, 10);
  if (end == at) return false;
  *out = value;
  return true;
}

// ---------- Messages to the PC ----------

static const char *panelState() {
  return panelOk ? "ok" : "silent";
}

static void sendHello() {
  lastHello = millis();
  Serial.printf("{\"t\":\"hello\",\"fw\":\"%s\",\"w\":%d,\"h\":%d,\"profile\":\"%s\",\"panel\":\"%s\"}\n", CP_FW_VERSION,
                LANDSCAPE_W, LANDSCAPE_H, CP_PROFILE, panelState());
}

static void sendAck(long seq, const char *scene) {
  Serial.printf("{\"t\":\"ack\",\"seq\":%ld,\"scene\":\"%s\",\"panel\":\"%s\"}\n", seq, scene, panelState());
}

static void sendState(const char *scene, const char *reason) {
  Serial.printf("{\"t\":\"state\",\"scene\":\"%s\",\"reason\":\"%s\"}\n", scene, reason);
}

// ---------- Drawing ----------

static void notePanel(uint32_t fullRefreshMs) {
  panelOk = fullRefreshMs >= CP_PANEL::full_refresh_time / 3 && fullRefreshMs < 9000;
}

static void setRotationFor(int rot) {
  display.setRotation((BASE_ROTATION + rot / 90) % 4);
}

static void drawFrame(const uint8_t *bits, const Header &h, bool forceFull) {
  setRotationFor(h.rot);
  bool full = forceFull || !h.partial || partials >= FULL_REFRESH_EVERY;
  if (full) {
    display.setFullWindow();
    partials = 0;
  } else {
    display.setPartialWindow(0, 0, display.width(), display.height());
    partials++;
  }
  uint32_t started = millis();
  display.firstPage();
  do {
    display.fillScreen(GxEPD_WHITE);
    display.drawBitmap(0, 0, const_cast<uint8_t *>(bits), h.w, h.h, GxEPD_BLACK);
  } while (display.nextPage());
  if (full) notePanel(millis() - started);
  display.powerOff();
}

static void drawBuiltIn(const char *message) {
  display.setRotation(BASE_ROTATION);
  display.setFullWindow();
  display.setTextColor(GxEPD_BLACK);
  uint32_t started = millis();
  display.firstPage();
  do {
    display.fillScreen(GxEPD_WHITE);
    display.setTextSize(2);
    display.setCursor(8, 12);
    display.print("Counter Pay");
    display.setTextSize(1);
    display.setCursor(8, 44);
    display.print(message);
  } while (display.nextPage());
  notePanel(millis() - started);
  display.powerOff();
  partials = 0;
}

/** A pay frame must not outlive its ttl or the link: show Ambient again. */
static void fallBack(const char *reason) {
  if (haveAmbient) drawFrame(ambientBuf, ambientHeader, true);
  else drawBuiltIn("Waiting for the PC");
  strcpy(currentScene, "ambient");
  sendState("ambient", reason);
}

// ---------- Receiving ----------

static void showReceived() {
  drawFrame(rxBuf, pending, false);
  strncpy(currentScene, pending.scene, sizeof(currentScene) - 1);
  currentScene[sizeof(currentScene) - 1] = '\0';
  if (strcmp(pending.scene, "pay") == 0) {
    payUntil = millis() + (uint32_t)(pending.ttl > 0 ? pending.ttl : 180) * 1000UL;
  } else if (strcmp(pending.scene, "ambient") == 0) {
    memcpy(ambientBuf, rxBuf, pending.len);
    ambientHeader = pending;
    haveAmbient = true;
  }
  sendAck(pending.seq, pending.scene);
}

static void handleLine(const char *json) {
  char type[12];
  if (!readString(json, "t", type, sizeof(type))) return;

  if (strcmp(type, "who") == 0) {
    sendHello();
    return;
  }
  if (strcmp(type, "frame") != 0) return;  // ping and anything else: lastHeard is enough

  Header h = {};
  long w = 0, hh = 0, len = 0, seq = 0, ttl = 0, rot = 0;
  char fmt[8] = "", refresh[10] = "full";
  if (!readLong(json, "seq", &seq) || !readLong(json, "w", &w) || !readLong(json, "h", &hh) ||
      !readLong(json, "len", &len) || !readString(json, "fmt", fmt, sizeof(fmt))) {
    return;
  }
  readString(json, "refresh", refresh, sizeof(refresh));
  if (!readString(json, "scene", h.scene, sizeof(h.scene))) strcpy(h.scene, "ambient");
  readLong(json, "ttl", &ttl);
  readLong(json, "rot", &rot);

  bool portrait = rot == 90 || rot == 270;
  int expectW = portrait ? LANDSCAPE_H : LANDSCAPE_W;
  int expectH = portrait ? LANDSCAPE_W : LANDSCAPE_H;
  size_t expectLen = (size_t)((w + 7) / 8) * (size_t)hh;
  if (strcmp(fmt, "1bpp") != 0 || w != expectW || hh != expectH || (size_t)len != expectLen || (size_t)len > MAX_FRAME) {
    // Wrong size for this panel: the PC's profile doesn't match. Tell it who we are.
    sendHello();
    return;
  }

  h.seq = seq;
  h.w = (int)w;
  h.h = (int)hh;
  h.len = (size_t)len;
  h.partial = strcmp(refresh, "partial") == 0;
  h.ttl = ttl;
  h.rot = (int)rot;
  pending = h;
  received = 0;
  receiveStarted = millis();
  receiving = true;
}

static void readSerial() {
  while (Serial.available() > 0) {
    lastHeard = millis();
    heardPc = true;
    if (receiving) {
      size_t want = pending.len - received;
      size_t got = Serial.readBytes(rxBuf + received, min((size_t)Serial.available(), want));
      received += got;
      if (received >= pending.len) {
        receiving = false;
        showReceived();
      }
      continue;
    }
    int c = Serial.read();
    if (c == '\n') {
      line[lineLen] = '\0';
      handleLine(line);
      lineLen = 0;
    } else if (c != '\r' && lineLen + 1 < sizeof(line)) {
      line[lineLen++] = (char)c;
    }
  }
}

void setup() {
  Serial.setRxBufferSize(MAX_FRAME + 1024);
  Serial.begin(CP_BAUD);
  Serial.setTimeout(50);

  rxBuf = (uint8_t *)malloc(MAX_FRAME);
  ambientBuf = (uint8_t *)malloc(MAX_FRAME);

  // No diagnostic output: the serial port carries the protocol.
  display.init(0, true, 2, false);
  drawBuiltIn("Waiting for the PC");

  lastHeard = millis();
  sendHello();
}

void loop() {
  readSerial();

  if (receiving && millis() - receiveStarted > FRAME_TIMEOUT_MS) {
    receiving = false;  // An incomplete frame is dropped; the PC resends on its next scene.
  }

  bool pcAway = !heardPc || millis() - lastHeard > LINK_LOSS_MS;
  if (pcAway && !receiving && millis() - lastHello >= HELLO_EVERY_MS) sendHello();

  if (strcmp(currentScene, "pay") == 0) {
    if ((int32_t)(millis() - payUntil) >= 0) fallBack("expired");
    else if (millis() - lastHeard > LINK_LOSS_MS) fallBack("link-lost");
  }
  delay(5);
}
