import { useEffect, useState } from 'react';

export type Breakpoint = 'mobile' | 'tablet' | 'desktop';

const MOBILE_QUERY = '(max-width: 767px)';
const DESKTOP_QUERY = '(min-width: 1024px)';

export function readBreakpoint(): Breakpoint {
  if (typeof window === 'undefined') return 'desktop';
  if (window.matchMedia(MOBILE_QUERY).matches) return 'mobile';
  if (window.matchMedia(DESKTOP_QUERY).matches) return 'desktop';
  return 'tablet';
}

export function useBreakpoint(uiScale?: number): Breakpoint {
  const [breakpoint, setBreakpoint] = useState<Breakpoint>(readBreakpoint);

  useEffect(() => {
    const update = () => setBreakpoint(readBreakpoint());
    const mobile = window.matchMedia(MOBILE_QUERY);
    const desktop = window.matchMedia(DESKTOP_QUERY);
    mobile.addEventListener('change', update);
    desktop.addEventListener('change', update);
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);

    update();
    let frame = 0;
    const deadline = performance.now() + 600;
    const tick = () => {
      update();
      if (performance.now() < deadline) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const fallback = window.setTimeout(update, 350);

    return () => {
      mobile.removeEventListener('change', update);
      desktop.removeEventListener('change', update);
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
      cancelAnimationFrame(frame);
      window.clearTimeout(fallback);
    };
  }, [uiScale]);

  return breakpoint;
}
