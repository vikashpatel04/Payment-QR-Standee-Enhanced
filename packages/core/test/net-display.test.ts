import { describe, expect, it } from 'vitest';
import { normalizeConfig } from '../src/config';
import { isPairingCode, parseAnnounce, parseHandshake, splitAddress } from '../src/net-display';
import { contentToMessages, fromWirePlaylist, toWirePlaylist } from '../src/protocol';
import { readySlides } from '../src/scenes';

const secrets = { token: () => 'token', pairingCode: () => '123456' };

describe('Wi-Fi display messages', () => {
  const announce = { v: 1, t: 'announce', id: 'a1b2c3', name: 'counter', fw: 'pi-1.0.0', w: 250, h: 122, port: 5181, paired: false };

  it('accepts a display announcing itself', () => {
    expect(parseAnnounce(announce)).toEqual(announce);
    expect(parseAnnounce({ ...announce, profile: 'waveshare-2in13b-v4', rotation: 90 })).toMatchObject({ rotation: 90 });
  });

  it('ignores malformed announcements', () => {
    expect(parseAnnounce({ ...announce, id: 'has spaces' })).toBeNull();
    expect(parseAnnounce({ ...announce, port: 70000 })).toBeNull();
    expect(parseAnnounce({ ...announce, w: 0 })).toBeNull();
    expect(parseAnnounce({ ...announce, rotation: 45 })).toBeNull();
    expect(parseAnnounce({ ...announce, v: 2 })).toBeNull();
    expect(parseAnnounce('announce')).toBeNull();
  });

  it('reads the handshake a display sends before frames', () => {
    const nonce = 'ab'.repeat(16);
    expect(parseHandshake({ v: 1, t: 'challenge', id: 'a1b2c3', nonce, paired: true })).toMatchObject({ t: 'challenge' });
    expect(parseHandshake({ v: 1, t: 'paired', key: 'f'.repeat(64) })).toMatchObject({ t: 'paired' });
    expect(parseHandshake({ v: 1, t: 'authed' })).toMatchObject({ t: 'authed' });
    expect(parseHandshake({ v: 1, t: 'denied', reason: 'code' })).toMatchObject({ reason: 'code' });
  });

  it('rejects weak or malformed handshakes', () => {
    expect(parseHandshake({ v: 1, t: 'challenge', id: 'a1', nonce: 'short', paired: false })).toBeNull();
    expect(parseHandshake({ v: 1, t: 'challenge', id: 'a1', nonce: 'XYZ'.repeat(8), paired: false })).toBeNull();
    expect(parseHandshake({ v: 1, t: 'paired', key: 'f'.repeat(63) })).toBeNull();
    expect(parseHandshake({ v: 1, t: 'denied', reason: 'whatever' })).toBeNull();
  });

  it('checks pairing codes and addresses', () => {
    expect(isPairingCode('482913')).toBe(true);
    expect(isPairingCode('48291')).toBe(false);
    expect(isPairingCode('48291a')).toBe(false);
    expect(splitAddress('192.168.1.20')).toEqual({ host: '192.168.1.20', port: 5181 });
    expect(splitAddress(' counter.local:6000 ')).toEqual({ host: 'counter.local', port: 6000 });
    // Copied from an SSH command: the user name is ignored.
    expect(splitAddress('pi@counter.local')).toEqual({ host: 'counter.local', port: 5181 });
    expect(splitAddress('http://x')).toBeNull();
    expect(splitAddress('1.2.3.4:99999')).toBeNull();
  });
});

describe('the standee slide', () => {
  it('survives the settings file', () => {
    const config = normalizeConfig({ ambient: { items: [{ k: 'standee' }, { k: 'standee', text: { en: 'Happy Shopping!' } }] } }, secrets);
    expect(config.ambient.items).toEqual([{ k: 'standee' }, { k: 'standee', text: { en: 'Happy Shopping!' } }]);
  });

  it('travels to browser displays with the standee QR', () => {
    const items = [{ k: 'standee' as const, text: { en: 'Happy Shopping!' } }];
    expect(fromWirePlaylist(toWirePlaylist(items))).toEqual(items);
    const [content] = contentToMessages({
      shopName: 'YOUR SHOP NAME',
      payeeLabel: 'YOUR SHOP NAME',
      accent: '#14B37D',
      languages: ['en'],
      ambient: { slideSeconds: 8, items },
      thanks: { seconds: 10 },
      standeeUri: 'upi://pay?pa=shop@okaxis&pn=YOUR%20SHOP%20NAME',
    });
    expect(content.standee).toBe('upi://pay?pa=shop@okaxis&pn=YOUR%20SHOP%20NAME');
  });
});

describe('standby slides', () => {
  it('keep a text size and the way they change', () => {
    const config = normalizeConfig(
      { ambient: { advance: 'key', items: [{ k: 'rating', url: 'https://example.com/r', size: 'l' }, { k: 'text', text: { en: 'Hi' }, size: 'huge' }] } },
      secrets,
    );
    expect(config.ambient.advance).toBe('key');
    expect(config.ambient.items).toEqual([{ k: 'rating', url: 'https://example.com/r', size: 'l' }, { k: 'text', text: { en: 'Hi' } }]);
    expect(normalizeConfig({ ambient: { advance: 'sometimes' } }, secrets).ambient.advance).toBe('auto');
  });

  it('send the text size and the slide to browser displays', () => {
    const items = [{ k: 'text' as const, text: { en: 'Free alteration' }, size: 's' as const }];
    expect(fromWirePlaylist(toWirePlaylist(items))).toEqual(items);
    const [, playlist] = contentToMessages({
      shopName: 'YOUR SHOP NAME', payeeLabel: 'YOUR SHOP NAME', accent: '#14B37D', languages: ['en'],
      ambient: { slideSeconds: 8, items, advance: 'key', index: 2 }, thanks: { seconds: 10 },
    });
    expect(playlist).toMatchObject({ manual: true, index: 2 });
  });

  it('keep a text slide that has no words yet, so it can be filled in', () => {
    const config = normalizeConfig({ ambient: { items: [{ k: 'logo' }, { k: 'text', text: {} }] } }, secrets);
    expect(config.ambient.items).toEqual([{ k: 'logo' }, { k: 'text', text: {} }]);
  });

  it('skip unfinished slides', () => {
    expect(readySlides([{ k: 'rating', url: '' }, { k: 'standee' }, { k: 'text', text: { en: 'Hi' } }], false)).toEqual([{ k: 'text', text: { en: 'Hi' } }]);
    expect(readySlides([{ k: 'standee' }], false)).toEqual([{ k: 'logo' }]);
  });
});

describe('Wi-Fi display settings', () => {
  it('keep the display id, address and key', () => {
    const config = normalizeConfig(
      { displays: [{ id: 'wifi-1', driver: 'wifi-frame', enabled: true, device: 'a1b2c3', address: '192.168.1.20:5181', key: 'f'.repeat(64), rotation: 90 }] },
      secrets,
    );
    expect(config.displays).toContainEqual({
      id: 'wifi-1',
      driver: 'wifi-frame',
      enabled: true,
      device: 'a1b2c3',
      address: '192.168.1.20:5181',
      key: 'f'.repeat(64),
      rotation: 90,
    });
  });
});
