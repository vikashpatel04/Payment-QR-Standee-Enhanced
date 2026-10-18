import { LineDecoder, parseDisplayMessage } from '@counterpay/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** The USB E-ink firmware and the app must agree on every line they exchange. */
const firmware = readFileSync(join(__dirname, '..', '..', '..', 'firmware', 'frame-generic', 'src', 'main.cpp'), 'utf8');

/** Every line the firmware prints, with sample values in place of its printf placeholders. */
function firmwareLines(): string[] {
  return [...firmware.matchAll(/Serial\.printf\("((?:[^"\\]|\\.)*)"/g)].map(([, format]) =>
    format!
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '\n')
      .replace(/%ld|%d/g, '1')
      .replace(/%s/g, 'pay'),
  );
}

describe('firmware contract', () => {
  it('prints hello, ack and state lines the driver accepts', () => {
    const lines = firmwareLines();
    const kinds = lines.map((line) => {
      const values = new LineDecoder(undefined, { skipNoise: true }).push(line);
      expect(values).toHaveLength(1);
      const message = parseDisplayMessage(values[0]);
      expect(message, line).not.toBeNull();
      return message!.t;
    });
    expect(kinds.sort()).toEqual(['ack', 'hello', 'state']);
  });

  it('reads the frame header fields the driver sends', () => {
    for (const key of ['seq', 'w', 'h', 'len', 'fmt', 'refresh', 'scene', 'ttl', 'rot']) {
      expect(firmware).toContain(`"${key}"`);
    }
  });
});
