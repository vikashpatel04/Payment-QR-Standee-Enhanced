# Contributing

Thanks for helping. Counter Pay runs at real shop counters, so the bar is: it must never show a wrong or stale QR, and it must never get in the cashier's way.

## Set up

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm dev
```

Windows 10/11 x64 and Node.js 22.12+ are required. No C++ toolchain is needed.

## Ground rules

1. **No real data.** No real UPI IDs, shop names, credentials or personal data anywhere in the repo. Use `shop@okaxis` and `YOUR SHOP NAME`.
2. **Domain logic is pure.** Amount parsing, UPI links, scenes, the state machine and the protocol live in `packages/core`, with unit tests and no Electron or Node imports.
3. **All user-facing text goes through `locales/`.** The app is in English and Tamil; the customer display also has Hindi, Bengali, Marathi, Telugu, Gujarati, Kannada, Malayalam, Punjabi and Odia. To add a display language, add `locales/<code>.json` with the `language` and `display` keys and list the code in `DISPLAY_LANGUAGES` (`packages/core/src/config.ts`); a test checks every key and placeholder.
4. **Never write to the point-of-sale system.** Plugins only read.
5. **Ask before adding a dependency** that isn't already in the stack.
6. **Amounts are integer paise.** Rupee strings exist only where people type or read them.

## Adding a display

A browser-based screen needs nothing new: open the display page.

For a new kind of device, implement `DisplayDriver` in `packages/drivers`:

```ts
interface DisplayDriver {
  id: string;
  kind: DriverKind;
  profile: DisplayProfile;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  show(scene: Scene): Promise<Ack>;
  setContent(content: DisplayContent): void;
  status(): DriverStatus;
  onStatus(callback: (status: DriverStatus) => void): () => void;
  onLinkLost(callback: () => void): () => void;
}
```

Drivers that speak the line protocol over a stream can extend `LinkedDriver`, which already handles sequence numbers, acks, pings, replaying the current scene to a device that reconnects, and the 10-second link-loss rule. The wire protocol is in `packages/core/src/protocol.ts`; the display-side rules (ttl, link loss) are in `packages/core/src/display-state.ts`.

## Pull requests

- Keep each change focused, with tests for anything in `core` or `drivers`.
- `pnpm test` and `pnpm typecheck` must pass.
