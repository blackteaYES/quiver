import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const shortSha = (sha: string) => sha.replace(/^@/, '').slice(0, 7);

export function displayPath(value: string, homeDir?: string | null) {
  if (!value || !homeDir) return value;
  const toSlashes = (input: string) => input.replace(/\\/g, '/').replace(/\/+$/, '');
  const home = toSlashes(homeDir);
  const path = toSlashes(value);
  if (!home) return value;
  const lowerHome = home.toLowerCase();
  const lowerPath = path.toLowerCase();
  if (lowerPath === lowerHome) return '~';
  if (lowerPath.startsWith(`${lowerHome}/`)) {
    return `~/${path.slice(home.length + 1)}`;
  }
  return value;
}

export function formatBytes(size: number) {
  if (!Number.isFinite(size) || size < 0) return '—';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatClock(date: Date) {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 非安全上下文或权限受限时回退到 execCommand */
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(area);
    return copied;
  } catch {
    return false;
  }
}
