import { themeStore, useTheme, type ThemeName } from './theme';

const OPTS: [ThemeName, string][] = [['classic', 'Classic'], ['neon', 'Neon Royale']];

/** Appearance choice (Classic / Neon Royale), shared by the Account sheet and MoreOptions. */
export default function ThemeToggle() {
  const v = useTheme();
  return (
    <div className="seg" role="radiogroup" aria-label="Theme" data-testid="theme-seg">
      {OPTS.map(([k, l]) => (
        <button key={k} type="button" role="radio" aria-label={l} aria-checked={v === k} className={v === k ? 'on' : ''} data-testid={`theme-${k}`} onClick={() => themeStore.set(k)}>{l}</button>
      ))}
    </div>
  );
}
