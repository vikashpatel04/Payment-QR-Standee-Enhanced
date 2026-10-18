import { type AmbientItem, type DisplayContent, formatINR, type Scene } from '@counterpay/core';
import QRCode from 'qrcode';
import { type ReactNode, useLayoutEffect, useRef } from 'react';
import { say } from '../Bilingual';

export interface FrameInput {
  scene: Scene;
  content: DisplayContent | null;
  width: number;
  height: number;
  slide: number;
  test?: boolean;
  now: number;
}

interface QrFit {
  modules: number;
  quiet: number;
  ppm: number;
  px: number;
  path: string;
}

function modulesPath(code: QRCode.QRCode, quiet: number): string {
  const n = code.modules.size;
  let path = '';
  for (let y = 0; y < n; y++) {
    let x = 0;
    while (x < n) {
      if (!code.modules.data[y * n + x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < n && code.modules.data[y * n + x]) x++;
      path += `M${start + quiet} ${y + quiet}h${x - start}v1h-${x - start}z`;
    }
  }
  return path;
}

/**
 * As big as the space allows: the largest whole number of pixels per module (never
 * anti-aliased), then as much quiet zone as still fits, up to 4 modules. Error correction
 * M, or L when that buys a bigger module: a crisp E-ink screen doesn't need M's extra
 * margin for dirt and wear.
 *
 * `minQuiet` is 2 modules, or 1 for a QR set flush against the panel's edges: the panel's
 * own white border adds to it there, and the layout keeps a wider gap on the text side
 * (see WORDS_GAP).
 */
function fitQr(text: string, maxPx: number, minQuiet = 2): QrFit | null {
  if (!text) return null;
  const data = [{ data: new TextEncoder().encode(text), mode: 'byte' as const }];
  let best: QrFit | null = null;
  for (const level of ['M', 'L'] as const) {
    const code = QRCode.create(data, { errorCorrectionLevel: level });
    const n = code.modules.size;
    const ppm = Math.floor(maxPx / (n + 2 * minQuiet));
    if (ppm < 2 || (best && ppm <= best.ppm)) continue;
    const quiet = Math.min(4, Math.floor((maxPx / ppm - n) / 2));
    best = { modules: n, quiet, ppm, px: (n + 2 * quiet) * ppm, path: modulesPath(code, quiet) };
  }
  return best;
}

/**
 * The QR's place: the same square on every screen that has a QR, so a customer always
 * finds it in one spot. The top square on an upright panel, the left square on a wide
 * one. The words always start just past it, on the same line.
 */
function qrPlace(width: number, height: number): { landscape: boolean; size: number } {
  const landscape = width >= height;
  return { landscape, size: landscape ? Math.min(height, Math.floor(width * 0.55)) : Math.min(width, Math.floor(height * 0.55)) };
}

/** Between the QR's place and the words: keeps at least 2 to 3 modules of quiet zone on that side. */
const WORDS_GAP = 5;

function Qr({ fit, x, y }: { fit: QrFit; x: number; y: number }) {
  const size = fit.modules + 2 * fit.quiet;
  return (
    <svg
      className="qr"
      style={{ left: x, top: y }}
      width={fit.px}
      height={fit.px}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={fit.path} fill="#000" />
    </svg>
  );
}

/** A QR in its place, with the screen's words below it (upright) or beside it (wide). */
function QrScreen({ input, uri, children }: { input: FrameInput; uri: string | undefined; children: ReactNode }) {
  const { width, height } = input;
  const place = qrPlace(width, height);
  // Flush with the panel's edges: its white border adds to the quiet zone (see fitQr).
  const fit = uri ? fitQr(uri, place.size, 1) : null;
  if (!fit) {
    return (
      <div className="center" style={{ padding: 6, gap: 4 }}>
        {children}
      </div>
    );
  }
  if (place.landscape) {
    return (
      <>
        <Qr fit={fit} x={Math.floor((place.size - fit.px) / 2)} y={Math.floor((height - fit.px) / 2)} />
        <div className="column" style={{ left: place.size + WORDS_GAP, right: 3, textAlign: 'center', justifyContent: 'space-evenly' }}>
          {children}
        </div>
      </>
    );
  }
  return (
    <>
      <Qr fit={fit} x={Math.floor((width - fit.px) / 2)} y={Math.floor((place.size - fit.px) / 2)} />
      <div className="rule" style={{ top: place.size + WORDS_GAP }} />
      <div className="column" style={{ top: place.size + WORDS_GAP + 2, bottom: 2, left: 3, right: 3, textAlign: 'center', justifyContent: 'space-evenly' }}>
        {children}
      </div>
    </>
  );
}

const NAME_LINE_HEIGHT = 1.15;

/**
 * The shop name: up to two lines, broken only between words and never inside one
 * ("Sri Lakshmi / Textiles", never "Sri Lakshm / i"). The font shrinks until every word fits
 * on its line; a single word too wide even then is narrowed rather than split.
 */
function ShopName({ name, max, lines = 2 }: { name: string | undefined; max: number; lines?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
    const inner = text.current;
    if (!el || !inner) return;
    const min = Math.min(max, 9);
    let size = max;
    let squeeze = 1;
    const apply = () => {
      el.style.fontSize = `${size}px`;
      el.style.fontWeight = squeeze < 1 ? '800' : '700';
      // Narrowing: lay the words out in a wider box, then scale it back to the real width.
      inner.style.width = `${100 / squeeze}%`;
      inner.style.transform = squeeze < 1 ? `scaleX(${squeeze})` : '';
    };
    const fits = () =>
      inner.scrollWidth <= inner.clientWidth && inner.scrollHeight <= Math.ceil(size * NAME_LINE_HEIGHT * lines) + 1;
    apply();
    while (size > min && !fits()) {
      size -= 1;
      apply();
    }
    while (squeeze > 0.5 && !fits()) {
      squeeze -= 0.05;
      apply();
    }
  });
  if (!name) return null;
  return (
    <div ref={box} className="name" style={{ fontSize: max, fontWeight: 700, lineHeight: NAME_LINE_HEIGHT }}>
      <div ref={text} className="nameText">
        {name}
      </div>
    </div>
  );
}

/**
 * One line of text, never wrapped: shrunk until it fits its box, down to `min`; past that
 * the letters are narrowed, so even a long name stays readable on one line. Runs before
 * paint, so the frame never shows it overflowing.
 */
function Fit({ max, min = 9, weight = 600, lang, children }: { max: number; min?: number; weight?: number; lang?: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
    const inner = text.current;
    if (!el || !inner) return;
    let size = max;
    inner.style.transform = '';
    el.style.fontWeight = String(weight);
    el.style.fontSize = `${size}px`;
    while (size > min && inner.offsetWidth > el.clientWidth) {
      size -= 1;
      el.style.fontSize = `${size}px`;
    }
    if (inner.offsetWidth > el.clientWidth) {
      // Narrowed letters lose thin strokes in black and white; a heavier weight keeps them.
      el.style.fontWeight = String(Math.max(weight, 800));
      inner.style.transform = `scaleX(${el.clientWidth / inner.offsetWidth})`;
    }
  });
  return (
    <div ref={box} className="line" style={{ fontSize: max, fontWeight: weight, width: '100%' }} lang={lang}>
      <span ref={text}>{children}</span>
    </div>
  );
}

function clock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function Pay({ input, langs }: { input: FrameInput; langs: string[] }) {
  const { scene, content, width, height } = input;
  if (scene.kind !== 'pay') return null;
  const [first = 'en', second] = langs;
  const landscape = width >= height;
  const amount = formatINR(scene.amountPaise);
  const unit = Math.min(width, height);
  return (
    <QrScreen input={input} uri={scene.uri}>
      <ShopName name={content?.shopName} max={Math.round(unit * (landscape ? 0.11 : 0.14))} />
      <Fit max={Math.round(unit * (landscape ? 0.3 : 0.22))} weight={700}>
        {amount}
      </Fit>
      <Fit max={Math.round(unit * 0.085)} weight={600} lang={first}>
        {say(first, 'display.scanHint')}
      </Fit>
      {second && (
        <Fit max={Math.round(unit * 0.085)} weight={500} lang={second}>
          {say(second, 'display.scanHint')}
        </Fit>
      )}
      <Fit max={Math.round(unit * 0.075)} weight={500} lang={first}>
        {say(first, 'display.shownAt', { time: clock(scene.shownAt) })}
      </Fit>
    </QrScreen>
  );
}

/** The shop's own standee QR, no amount, with the shop name and the shop's message (for example "Happy Shopping!"). */
function Standee({ input, langs, text }: { input: FrameInput; langs: string[]; text?: Record<string, string> }) {
  const { content, width, height } = input;
  const [first = 'en'] = langs;
  const unit = Math.min(width, height);
  return (
    <QrScreen input={input} uri={content?.standeeUri}>
      <ShopName name={content?.shopName} max={Math.round(unit * 0.14)} />
      {text ? (
        <TwoLines text={text} langs={langs} max={Math.round(unit * 0.12)} />
      ) : (
        <Fit max={Math.round(unit * 0.09)} weight={600} lang={first}>
          {say(first, 'display.scanToPay')}
        </Fit>
      )}
    </QrScreen>
  );
}

function ready(items: AmbientItem[], content: DisplayContent | null): AmbientItem[] {
  const usable = items.filter(
    (item) =>
      (item.k !== 'rating' || item.url) &&
      (item.k !== 'text' || Object.values(item.text).some(Boolean)) &&
      (item.k !== 'standee' || content?.standeeUri),
  );
  return usable.length ? usable : [{ k: 'logo' }];
}

function TwoLines({ k, text, langs, max }: { k?: string; text?: Record<string, string>; langs: string[]; max: number }) {
  const [first = 'en', second] = langs;
  const pick = (lang: string) => (text ? text[lang] ?? '' : k ? say(lang, k) : '');
  const one = pick(first);
  const two = second ? pick(second) : '';
  return (
    <>
      {one && (
        <Fit max={max} weight={700} lang={first}>
          {one}
        </Fit>
      )}
      {two && two !== one && (
        <Fit max={Math.round(max * 0.7)} weight={500} lang={second}>
          {two}
        </Fit>
      )}
    </>
  );
}

function Ambient({ input, langs }: { input: FrameInput; langs: string[] }) {
  const { content, width, height, slide } = input;
  const items = ready(content?.ambient.items ?? [], content);
  const item = items[slide % items.length]!;
  const unit = Math.min(width, height);
  switch (item.k) {
    case 'logo':
      return (
        <div className="center" style={{ padding: 6, gap: 4 }}>
          {content?.logoUrl ? (
            <img className="logo" src={content.logoUrl} alt="" />
          ) : (
            <ShopName name={content?.shopName} max={Math.round(unit * 0.24)} />
          )}
          <TwoLines k="display.welcome" langs={langs} max={Math.round(unit * 0.13)} />
        </div>
      );
    case 'rating':
      return (
        <QrScreen input={input} uri={item.url}>
          <TwoLines k={item.text ? undefined : 'display.rateUs'} text={item.text} langs={langs} max={Math.round(unit * 0.13)} />
        </QrScreen>
      );
    case 'text':
      return (
        <div className="center" style={{ padding: 6, gap: 4 }}>
          <TwoLines text={item.text} langs={langs} max={Math.round(unit * 0.2)} />
        </div>
      );
    case 'image':
      return (
        <div className="center">
          <img className="logo" style={{ maxWidth: '100%', maxHeight: '100%' }} src={item.src} alt="" />
        </div>
      );
    case 'standee':
      return <Standee input={input} langs={langs} {...(item.text ? { text: item.text } : {})} />;
  }
}

function Thanks({ input, langs }: { input: FrameInput; langs: string[] }) {
  const unit = Math.min(input.width, input.height);
  return (
    <QrScreen input={input} uri={input.content?.thanks.ratingUrl}>
      <TwoLines k="display.thankYou" langs={langs} max={Math.round(unit * 0.2)} />
      {input.content?.thanks.ratingUrl && <TwoLines k="display.rateUs" langs={langs.slice(0, 1)} max={Math.round(unit * 0.09)} />}
    </QrScreen>
  );
}

function Test({ input }: { input: FrameInput }) {
  return (
    <>
      <div className="test" />
      <div className="testLabel" style={{ fontSize: Math.round(Math.min(input.width, input.height) * 0.12) }}>
        <div>Counter Pay</div>
        <div>
          {input.width} × {input.height}
        </div>
      </div>
    </>
  );
}

export function FrameView({ input, onLaidOut }: { input: FrameInput; onLaidOut: () => void }) {
  const langs = input.content?.languages.length ? input.content.languages : ['en'];
  // Children shrink their text in their own layout effects, which run first.
  useLayoutEffect(onLaidOut);
  let body: ReactNode;
  if (input.test) body = <Test input={input} />;
  else if (input.scene.kind === 'pay') body = <Pay input={input} langs={langs} />;
  else if (input.scene.kind === 'thanks') body = <Thanks input={input} langs={langs} />;
  else body = <Ambient input={input} langs={langs} />;
  return (
    <div className="frame" style={{ width: input.width, height: input.height }}>
      {body}
    </div>
  );
}
