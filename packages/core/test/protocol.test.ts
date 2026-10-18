import { describe, expect, it } from 'vitest';
import {
  contentToMessages,
  encodeLine,
  fromWirePlaylist,
  LineDecoder,
  parseDisplayMessage,
  parsePcMessage,
  sceneToMessage,
  toWirePlaylist,
} from '../src/protocol';
import type { AmbientItem, PayScene } from '../src/scenes';

const pay: PayScene = {
  kind: 'pay',
  id: 3,
  shownAt: 0,
  expiresAt: 180_000,
  amountPaise: 114000,
  ref: 'CP2610120042',
  uri: 'upi://pay?pa=shop@okaxis&tr=CP2610120042&am=1140.00&cu=INR',
};

describe('sceneToMessage', () => {
  it('matches the spec example for pay', () => {
    expect(sceneToMessage(pay, 12, 0, { includeUri: false })).toEqual({
      v: 1,
      t: 'pay',
      seq: 12,
      amt: 114000,
      ref: 'CP2610120042',
      ttl: 180,
    });
  });

  it('carries the link only for web transports', () => {
    expect(sceneToMessage(pay, 12, 0, { includeUri: true })).toMatchObject({ uri: pay.uri });
  });

  it('sends the time left to a display that joins late', () => {
    expect(sceneToMessage(pay, 1, 170_500, { includeUri: false })).toMatchObject({ ttl: 10 });
    expect(sceneToMessage(pay, 1, 999_999, { includeUri: false })).toMatchObject({ ttl: 1 });
  });

  it('reaches Thanks and Ambient through clear', () => {
    expect(sceneToMessage({ kind: 'thanks', id: 4, shownAt: 0, endsAt: 10_000 }, 13, 0, { includeUri: true })).toEqual(
      { v: 1, t: 'clear', seq: 13, then: 'thanks' },
    );
    expect(sceneToMessage({ kind: 'ambient', id: 5, shownAt: 0, reason: 'idle' }, 14, 0, { includeUri: true })).toEqual(
      { v: 1, t: 'clear', seq: 14, then: 'ambient' },
    );
  });
});

describe('playlist', () => {
  const items: AmbientItem[] = [
    { k: 'logo' },
    { k: 'rating', url: 'https://g.page/r/example/review', text: { en: 'Rate us', hi: 'रेटिंग दें' } },
    { k: 'text', text: { en: 'Free alteration', hi: 'मुफ़्त ऑल्टरेशन' } },
    { k: 'image', src: '/content/offer.png' },
  ];

  it('flattens text into the spec wire shape', () => {
    expect(toWirePlaylist(items)).toEqual([
      { k: 'logo' },
      { k: 'rating', url: 'https://g.page/r/example/review', en: 'Rate us', hi: 'रेटिंग दें' },
      { k: 'text', en: 'Free alteration', hi: 'मुफ़्त ऑल्टरेशन' },
      { k: 'image', src: '/content/offer.png' },
    ]);
  });

  it('round-trips', () => {
    expect(fromWirePlaylist(toWirePlaylist(items))).toEqual(items);
  });

  it('builds content and playlist messages that parse back', () => {
    const [content, playlist] = contentToMessages({
      shopName: 'YOUR SHOP',
      payeeLabel: 'YOUR SHOP',
      accent: '#14B37D',
      languages: ['en', 'hi'],
      ambient: { slideSeconds: 8, items },
      thanks: { seconds: 10, ratingUrl: 'https://g.page/r/example/review' },
    });
    expect(parsePcMessage(content)).toEqual(content);
    expect(parsePcMessage(playlist)).toEqual(playlist);
    expect(playlist.slide).toBe(8);
  });
});

describe('parseDisplayMessage', () => {
  it('accepts the spec examples', () => {
    expect(parseDisplayMessage({ t: 'hello', fw: '1.0.0', w: 320, h: 480, vpa: 'mercha…@ok…' })).not.toBeNull();
    expect(parseDisplayMessage({ t: 'ack', seq: 12, scene: 'pay' })).not.toBeNull();
    expect(parseDisplayMessage({ t: 'state', scene: 'ambient', reason: 'expired' })).not.toBeNull();
  });

  it.each([
    null,
    'hello',
    [],
    { t: 'hello', fw: 1, w: 320, h: 480 },
    { t: 'ack', seq: -1, scene: 'pay' },
    { t: 'ack', seq: 1, scene: 'party' },
    { t: 'pay', amt: 100 },
  ])('drops %j', (value) => {
    expect(parseDisplayMessage(value)).toBeNull();
  });
});

describe('parsePcMessage', () => {
  it('requires protocol version 1', () => {
    expect(parsePcMessage({ t: 'ping', seq: 1 })).toBeNull();
    expect(parsePcMessage({ v: 2, t: 'ping', seq: 1 })).toBeNull();
    expect(parsePcMessage({ v: 1, t: 'ping', seq: 1 })).toEqual({ v: 1, t: 'ping', seq: 1 });
  });

  it('rejects a zero or fractional amount', () => {
    expect(parsePcMessage({ v: 1, t: 'pay', seq: 1, amt: 0, ref: 'X', ttl: 180 })).toBeNull();
    expect(parsePcMessage({ v: 1, t: 'pay', seq: 1, amt: 10.5, ref: 'X', ttl: 180 })).toBeNull();
  });

  it('rejects an unknown clear target', () => {
    expect(parsePcMessage({ v: 1, t: 'clear', seq: 1, then: 'pay' })).toBeNull();
  });
});

describe('LineDecoder', () => {
  it('splits on newlines and keeps partial lines', () => {
    const decoder = new LineDecoder();
    expect(decoder.push('{"t":"ack","seq":1,')).toEqual([]);
    expect(decoder.push('"scene":"pay"}\n{"t":"state"')).toEqual([{ t: 'ack', seq: 1, scene: 'pay' }]);
    expect(decoder.push(',"scene":"ambient"}\r\n')).toEqual([{ t: 'state', scene: 'ambient' }]);
  });

  it('reports and skips bad lines', () => {
    const errors: string[] = [];
    const decoder = new LineDecoder((reason) => errors.push(reason));
    expect(decoder.push('not json\n\n{"ok":true}\n')).toEqual([{ ok: true }]);
    expect(errors).toEqual(['bad-json']);
  });

  it('drops a runaway line', () => {
    const errors: string[] = [];
    const decoder = new LineDecoder((reason) => errors.push(reason));
    decoder.push('x'.repeat(70 * 1024));
    expect(errors).toEqual(['too-long']);
    expect(decoder.push('{"a":1}\n')).toEqual([{ a: 1 }]);
  });

  it('round-trips encodeLine', () => {
    const decoder = new LineDecoder();
    const message = { v: 1, t: 'ping', seq: 14 } as const;
    expect(decoder.push(encodeLine(message))).toEqual([message]);
  });

  it('finds a message behind boot noise on serial links', () => {
    const noisy = 'x\u00f8x\u0000{x\u0000{"t\u00f8{"t":"hello","fw":"1.0.0","w":250,"h":122}\n';
    expect(new LineDecoder(undefined, { skipNoise: true }).push(noisy)).toEqual([{ t: 'hello', fw: '1.0.0', w: 250, h: 122 }]);
    const errors: string[] = [];
    expect(new LineDecoder((reason) => errors.push(reason)).push(noisy)).toEqual([]);
    expect(errors).toEqual(['bad-json']);
  });

  it('still reports pure noise on serial links', () => {
    const errors: string[] = [];
    expect(new LineDecoder((reason) => errors.push(reason), { skipNoise: true }).push('x\u00f8{"t\u0000\n')).toEqual([]);
    expect(errors).toEqual(['bad-json']);
  });
});
