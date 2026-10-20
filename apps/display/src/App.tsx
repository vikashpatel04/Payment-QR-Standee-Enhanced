import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import { DEFAULT_LANGS } from './Bilingual';
import { useDisplayLink } from './link';
import { loadToken, type PageParams, readParams, saveToken } from './params';
import { Ambient } from './scenes/Ambient';
import { Pairing } from './scenes/Pairing';
import { Pay } from './scenes/Pay';
import { TestPattern } from './scenes/TestPattern';
import { Thanks } from './scenes/Thanks';
import { Stage } from './Stage';

const BACKGROUND = { ambient: 'var(--night)', pay: 'var(--paper)', thanks: 'var(--paper)' } as const;

/** Re-renders on an interval while `active`, for the expiry line. */
function useNow(active: boolean, ms = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [active, ms]);
  return now;
}

function Display({ params, token, onUnauthorized }: { params: PageParams; token: string | null; onUnauthorized: () => void }) {
  const { state, status } = useDisplayLink(params, token, onUnauthorized);
  const now = useNow(state.scene.kind === 'pay');
  const langs = state.content?.langs.length ? state.content.langs : DEFAULT_LANGS;

  useEffect(() => {
    document.documentElement.lang = langs[0] ?? 'en';
  }, [langs]);

  const testing = state.testUntil !== null;
  const style = { '--accent': state.content?.accent ?? undefined } as CSSProperties;

  return (
    <div style={style}>
      <Stage rotate={params.rotate} background={testing ? '#000000' : BACKGROUND[state.scene.kind]}>
        {(layout) => {
          if (testing) return <TestPattern id={params.id ?? 'wifi'} layout={layout} rotate={params.rotate} langs={langs} />;
          switch (state.scene.kind) {
            case 'pay':
              return <Pay scene={state.scene} content={state.content} langs={langs} layout={layout} now={now} />;
            case 'thanks':
              return <Thanks content={state.content} langs={langs} />;
            case 'ambient':
              return (
                <Ambient
                  content={state.content}
                  items={state.playlist}
                  slideSeconds={state.slideSeconds}
                  manual={state.manual}
                  index={state.slideIndex}
                  langs={langs}
                  connecting={status !== 'open'}
                />
              );
          }
        }}
      </Stage>
    </div>
  );
}

export function App() {
  const params = useMemo(() => readParams(), []);
  const local = Boolean(params.key && params.id);
  const [token, setToken] = useState<string | null>(() => (local ? null : loadToken()));

  if (!local && !token) {
    return (
      <Pairing
        onPaired={(paired) => {
          saveToken(paired);
          setToken(paired);
        }}
      />
    );
  }

  return (
    <Display
      params={params}
      token={token}
      onUnauthorized={() => {
        saveToken(null);
        setToken(null);
      }}
    />
  );
}
