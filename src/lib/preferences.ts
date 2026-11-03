export type Theme = 'dark' | 'light';
export type UiScale = 1 | 1.1 | 1.2;

const THEME_KEY = 'quiver.theme';
const SCALE_KEY = 'quiver.scale';
const NAV_WIDTH_KEY = 'quiver.navWidth';
const LIST_WIDTH_KEY = 'quiver.listWidth';

export const SCALE_OPTIONS: UiScale[] = [1, 1.1, 1.2];

export const NAV_WIDTH = { rail: 64, expanded: 216, max: 300 } as const;
export const LIST_WIDTH = { min: 240, max: 440, defaultValue: 300 } as const;

function readStoredNumber(key: string): number | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

function writeStoredNumber(key: string, value: number) {
  try {
    localStorage.setItem(key, String(Math.round(value)));
  } catch {
    /* 本地存储不可用时仅本次生效 */
  }
}

export function readNavWidth(): number | null {
  return readStoredNumber(NAV_WIDTH_KEY);
}

export function writeNavWidth(width: number) {
  writeStoredNumber(NAV_WIDTH_KEY, width);
}

export function readListWidth(): number | null {
  return readStoredNumber(LIST_WIDTH_KEY);
}

export function writeListWidth(width: number) {
  writeStoredNumber(LIST_WIDTH_KEY, width);
}

export function readTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function readScale(): UiScale {
  try {
    const value = Number(localStorage.getItem(SCALE_KEY));
    return value === 1.1 || value === 1.2 ? value : 1;
  } catch {
    return 1;
  }
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle('dark', theme === 'dark');
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* 本地存储不可用时仅本次生效 */
  }
}

export function applyScale(scale: UiScale) {
  const bridge = window.quiver?.window;
  if (bridge?.setZoomFactor) {
    bridge.setZoomFactor(scale);
  } else {
    document.documentElement.style.zoom = String(scale);
  }
  try {
    localStorage.setItem(SCALE_KEY, String(scale));
  } catch {
    /* 本地存储不可用时仅本次生效 */
  }
}
