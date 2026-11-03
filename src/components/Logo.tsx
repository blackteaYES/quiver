import { cn } from '@/lib/utils';

export function QuiverMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 28 28"
      fill="none"
      aria-hidden="true"
      className={cn('h-4 w-4 text-fg', className)}
    >
      <path
        d="M4.75 7.75 9.1 12l-4.35 4.25"
        stroke="currentColor"
        strokeOpacity="0.32"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10 7.75 14.35 12 10 16.25"
        stroke="currentColor"
        strokeOpacity="0.58"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M15.25 7.75 19.6 12l-4.35 4.25"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5 19.75h18.25"
        stroke="currentColor"
        strokeOpacity="0.22"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <circle cx="23.25" cy="12" r="1.05" fill="currentColor" />
    </svg>
  );
}

export function QuiverLogo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 w-6 items-center justify-center rounded-[6px] border border-hairline bg-soft shadow-inset-top',
        className,
      )}
    >
      <QuiverMark className="h-[15px] w-[15px]" />
    </span>
  );
}
