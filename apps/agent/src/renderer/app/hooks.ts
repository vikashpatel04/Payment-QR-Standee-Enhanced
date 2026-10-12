import type { AppSnapshot, ConfigPatch } from '@shared/api';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../shared/api';

/** The agent's live state. Pushed on every change; there is nothing to save. */
export function useSnapshot(): AppSnapshot | null {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  useEffect(() => {
    let alive = true;
    void api.app.snapshot().then((first) => alive && setSnapshot(first));
    const off = api.app.onSnapshot(setSnapshot);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return snapshot;
}

/** Changes apply instantly. */
export function updateConfig(patch: ConfigPatch): void {
  void api.app.updateConfig(patch);
}

/** Re-renders every `ms` for countdowns. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

/**
 * A text field that keeps its own draft while typing and commits on blur or Enter,
 * so every keystroke doesn't rewrite the config file.
 */
export function useDraft(value: string, commit: (next: string) => void) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);
  const done = useCallback(() => {
    setEditing(false);
    if (draft !== value) commit(draft);
  }, [draft, value, commit]);
  return {
    value: draft,
    onChange: (event: { target: { value: string } }) => {
      setEditing(true);
      setDraft(event.target.value);
    },
    onBlur: done,
    onKeyDown: (event: { key: string; currentTarget: { blur(): void } }) => {
      if (event.key === 'Enter') event.currentTarget.blur();
    },
  };
}
