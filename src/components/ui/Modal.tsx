import { useEffect, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from '@/lib/utils';

export function Modal({
  open,
  onClose,
  ariaLabel,
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  ariaLabel: string;
  className?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[95] flex items-center justify-center bg-overlay px-4 backdrop-blur-[3px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabel}
            initial={{ opacity: 0, y: 8, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.99 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className={cn(
              'flex max-h-[84vh] w-full max-w-[520px] flex-col overflow-hidden rounded-[13px] border border-hairline bg-raised shadow-float max-sm:[&_button]:min-h-10 max-sm:[&_button]:min-w-10 max-sm:[&_input]:min-h-10 max-sm:[&_select]:min-h-10',
              className,
            )}
          >
            {children}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export const inputClass =
  'h-9 w-full rounded-[6px] border border-hairline bg-soft px-3 text-[14px] text-fg outline-none transition-colors placeholder:text-fg-subtle focus:border-hairline-strong focus:bg-soft';

export const textareaClass =
  'w-full resize-none rounded-[6px] border border-hairline bg-soft px-3 py-2 text-[14px] leading-relaxed text-fg outline-none transition-colors placeholder:text-fg-subtle focus:border-hairline-strong focus:bg-soft';
