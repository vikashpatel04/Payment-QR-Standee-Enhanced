const PATHS = {
  home: 'M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z',
  history: 'M12 7v5l3 2M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4 4v4h4',
  displays: 'M4 5h16v11H4zM9 20h6M12 16v4',
  content: 'M4 5h16v14H4zM4 15l4.5-4.5 4 4 3-3L20 15M15.5 9.5h.01',
  settings:
    'M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6zM19.4 13.4l1.5 1.2-1.6 2.8-1.9-.6a7 7 0 0 1-1.7 1l-.4 2h-3.2l-.4-2a7 7 0 0 1-1.7-1l-1.9.6-1.6-2.8 1.5-1.2a7 7 0 0 1 0-2l-1.5-1.2 1.6-2.8 1.9.6a7 7 0 0 1 1.7-1l.4-2h3.2l.4 2a7 7 0 0 1 1.7 1l1.9-.6 1.6 2.8-1.5 1.2a7 7 0 0 1 0 2z',
  plus: 'M12 5v14M5 12h14',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  trash: 'M5 7h14M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5H5V6h5',
  check: 'M5 12.5l4.2 4.2L19 7',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** The Counter Pay mark: a tiny QR in the accent colour. */
export function Mark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <g fill="none" stroke="#fff" strokeWidth="2">
        <rect x="6.5" y="6.5" width="7" height="7" rx="1" />
        <rect x="18.5" y="6.5" width="7" height="7" rx="1" />
        <rect x="6.5" y="18.5" width="7" height="7" rx="1" />
      </g>
      <g fill="#fff">
        <rect x="18" y="18" width="3" height="3" />
        <rect x="22.5" y="22.5" width="3" height="3" />
        <rect x="18" y="23" width="3" height="3" />
        <rect x="23" y="18" width="3" height="3" />
      </g>
    </svg>
  );
}
