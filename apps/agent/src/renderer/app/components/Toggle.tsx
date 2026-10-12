import ui from '../ui.module.css';

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={on ? ui.toggleOn : ui.toggle}
      onClick={() => onChange(!on)}
    />
  );
}
