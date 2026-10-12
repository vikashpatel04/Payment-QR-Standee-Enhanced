import { describe, expect, it } from 'vitest';
import { applyPcMessage, initialDisplayState, tickDisplay } from '../src/display-state';

const T0 = 1_000_000;

describe('display state', () => {
  it('shows pay and acks it', () => {
    const { state, replies } = applyPcMessage(
      initialDisplayState(T0),
      { v: 1, t: 'pay', seq: 12, amt: 114000, ref: 'DT2610120042', ttl: 180, uri: 'upi://pay?pa=x@y' },
      T0,
    );
    expect(state.scene).toEqual({
      kind: 'pay',
      amt: 114000,
      ref: 'DT2610120042',
      uri: 'upi://pay?pa=x@y',
      since: T0,
      until: T0 + 180_000,
    });
    expect(replies).toEqual([{ t: 'ack', seq: 12, scene: 'pay' }]);
  });

  it('enforces the ttl itself and tells the PC', () => {
    let { state } = applyPcMessage(initialDisplayState(T0), { v: 1, t: 'pay', seq: 1, amt: 100, ref: 'R', ttl: 30 }, T0);
    // Pings keep the link alive; the ttl still ends the QR.
    for (let t = T0 + 5_000; t < T0 + 30_000; t += 5_000) {
      state = applyPcMessage(state, { v: 1, t: 'ping', seq: 2 }, t).state;
      expect(tickDisplay(state, t).state.scene.kind).toBe('pay');
    }
    const step = tickDisplay(state, T0 + 30_000);
    expect(step.state.scene).toMatchObject({ kind: 'ambient', reason: 'expired' });
    expect(step.replies).toEqual([{ t: 'state', scene: 'ambient', reason: 'expired' }]);
  });

  it('drops a pay QR when the PC goes quiet for more than 10 s', () => {
    const { state } = applyPcMessage(initialDisplayState(T0), { v: 1, t: 'pay', seq: 1, amt: 100, ref: 'R', ttl: 180 }, T0);
    expect(tickDisplay(state, T0 + 10_000).state.scene.kind).toBe('pay');
    expect(tickDisplay(state, T0 + 10_001).state.scene).toMatchObject({ kind: 'ambient', reason: 'link-lost' });
  });

  it('clears to Thanks for the configured time, then Ambient', () => {
    let state = applyPcMessage(
      initialDisplayState(T0),
      { v: 1, t: 'content', shop: 'S', payee: 'S', accent: '#000000', langs: ['en'], thanks: 4 },
      T0,
    ).state;
    const cleared = applyPcMessage(state, { v: 1, t: 'clear', seq: 3, then: 'thanks' }, T0);
    state = cleared.state;
    expect(cleared.replies).toEqual([{ t: 'ack', seq: 3, scene: 'thanks' }]);
    expect(tickDisplay(state, T0 + 3_999).state.scene.kind).toBe('thanks');
    expect(tickDisplay(state, T0 + 4_000).state.scene).toMatchObject({ kind: 'ambient', reason: 'thanks-done' });
  });

  it('can clear straight to Ambient', () => {
    const { state, replies } = applyPcMessage(initialDisplayState(T0), { v: 1, t: 'clear', seq: 4, then: 'ambient' }, T0);
    expect(state.scene).toMatchObject({ kind: 'ambient', reason: 'cleared' });
    expect(replies).toEqual([{ t: 'ack', seq: 4, scene: 'ambient' }]);
  });

  it('takes the playlist and slide time', () => {
    const { state } = applyPcMessage(
      initialDisplayState(T0),
      { v: 1, t: 'playlist', items: [{ k: 'logo' }, { k: 'text', en: 'Hi', ta: 'வணக்கம்' }], slide: 12 },
      T0,
    );
    expect(state.playlist).toEqual([{ k: 'logo' }, { k: 'text', text: { en: 'Hi', ta: 'வணக்கம்' } }]);
    expect(state.slideSeconds).toBe(12);
  });

  it('shows a test pattern for its time', () => {
    const { state } = applyPcMessage(initialDisplayState(T0), { v: 1, t: 'test', seq: 5, seconds: 5 }, T0);
    expect(state.testUntil).toBe(T0 + 5_000);
    expect(tickDisplay(state, T0 + 5_000).state.testUntil).toBeNull();
  });
});
