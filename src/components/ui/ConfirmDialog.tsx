import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

export function ConfirmDialog({
  open,
  title,
  description,
  note,
  confirmLabel = '确认',
  cancelLabel = '取消',
  danger = true,
  busy = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  note?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal open={open} onClose={onCancel} ariaLabel={title} className="max-w-[420px]">
      <div className="flex items-start gap-3 px-5 pb-4 pt-5">
        <span
          className={
            danger
              ? 'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] border border-rose/[0.22] bg-rose/[0.07] text-rose'
              : 'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] border border-hairline bg-soft text-fg-muted'
          }
        >
          <AlertTriangle className="h-3.5 w-3.5" strokeWidth={1.9} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[16px] font-semibold text-fg">{title}</h2>
          <div className="mt-1.5 text-[14px] leading-relaxed text-fg-subtle">
            {description}
          </div>
          {note ? (
            <div className="mt-2.5 rounded-[6px] border border-hairline bg-soft px-3 py-2 text-[13px] leading-relaxed text-fg-subtle">
              {note}
            </div>
          ) : null}
        </div>
      </div>
      <footer className="flex items-center justify-end gap-2 border-t border-hairline px-5 py-3">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </Button>
        <Button
          size="sm"
          variant={danger ? 'danger' : 'primary'}
          onClick={onConfirm}
          disabled={busy}
          className="min-w-[76px]"
        >
          {confirmLabel}
        </Button>
      </footer>
    </Modal>
  );
}
