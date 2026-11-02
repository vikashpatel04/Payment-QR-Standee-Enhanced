import type { IslandLook, IslandMessage } from '@shared/api';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/base.css';
import '../shared/i18n';
import { api } from '../shared/api';
import { type IslandContent, IslandView, SPEED } from '../shared/island/IslandView';
import './page.css';

// Subscribe before React mounts: the agent may send the first message as soon as the page loads.
let deliver: ((message: IslandMessage) => void) | null = null;
let early: IslandMessage | null = null;
api.island.onState((message) => {
  if (deliver) deliver(message);
  else early = message;
});

/** "QR cleared" / "QR timed out" stay this long, then tuck away. */
const MESSAGE_MS = 1600;
/** Coming out of the bezel waits a moment, so the pill has dropped away first. */
const EMERGE_DELAY_MS = 180;
/** How long tucking back into the bezel takes at medium speed (see island.module.css). */
const TUCK_MS = 380;

const START_LOOK: IslandLook = { size: 85, roundness: 100, speed: 'medium', reduceMotion: false };

/** The Info Island's window: comes out of the bezel for a QR, counts down, tucks away when it ends. */
function Island() {
  const [content, setContent] = useState<IslandContent | null>(null);
  const [look, setLook] = useState<IslandLook>(START_LOOK);
  const [tucked, setTucked] = useState(true);
  const [hover, setHover] = useState(false);
  const [now, setNow] = useState(() => performance.now());
  const deadline = useRef(0);
  const seqRef = useRef(0);
  const tuckedRef = useRef(true);
  const speedRef = useRef(1);
  const timers = useRef<number[]>([]);

  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };
  const clearTimers = () => {
    timers.current.forEach((id) => clearTimeout(id));
    timers.current = [];
  };
  const setTuckedBoth = (value: boolean) => {
    tuckedRef.current = value;
    setTucked(value);
  };

  const tuck = useCallback((seq: number) => {
    clearTimers();
    setHover(false);
    api.island.hover(false);
    setTuckedBoth(true);
    later(() => api.island.gone(seq), TUCK_MS * speedRef.current + 40);
  }, []);

  useEffect(() => {
    deliver = ({ seq, state }) => {
      if (state.kind !== 'hide') {
        document.documentElement.toggleAttribute('data-reduce-motion', state.look.reduceMotion);
        speedRef.current = state.look.reduceMotion ? 0 : SPEED[state.look.speed];
        setLook(state.look);
      }
      if (state.kind === 'look') return;
      seqRef.current = seq;
      if (state.kind === 'hide') {
        tuck(seq);
        return;
      }
      clearTimers();
      if (state.kind === 'pay') deadline.current = performance.now() + state.leftMs;
      setNow(performance.now());
      setContent(state);
      const wait = tuckedRef.current ? EMERGE_DELAY_MS * speedRef.current : 0;
      if (tuckedRef.current) later(() => setTuckedBoth(false), wait);
      if (state.kind === 'message') later(() => tuck(seq), wait + MESSAGE_MS);
    };
    if (early) {
      deliver(early);
      early = null;
    }
    return () => {
      deliver = null;
      clearTimers();
    };
  }, [tuck]);

  // A light tick for the countdown, only while a QR is on the island.
  const counting = content?.kind === 'pay' && !tucked;
  useEffect(() => {
    if (!counting) return;
    const id = window.setInterval(() => setNow(performance.now()), 250);
    return () => clearInterval(id);
  }, [counting]);

  const pay = content?.kind === 'pay';

  return (
    <IslandView
      content={content}
      leftMs={pay ? Math.max(0, deadline.current - now) : 0}
      look={look}
      tucked={tucked}
      hover={hover}
      onEnter={() => {
        if (!pay || tuckedRef.current) return;
        setHover(true);
        api.island.hover(true);
      }}
      onLeave={() => {
        setHover(false);
        api.island.hover(false);
      }}
      onHide={() => {
        api.island.dismiss(seqRef.current);
        tuck(seqRef.current);
      }}
    />
  );
}

createRoot(document.getElementById('root')!).render(<Island />);
