import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const variants = {
  primary:
    'border border-primary/80 bg-primary text-primary-fg shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_10px_24px_-16px_rgba(0,0,0,0.55)] hover:border-primary-hover hover:bg-primary-hover',
  secondary:
    'border border-hairline bg-soft text-fg shadow-inset-top hover:border-hairline-strong hover:bg-soft-strong',
  ghost:
    'border border-transparent text-fg-muted hover:border-hairline hover:bg-soft-strong hover:text-fg',
  quiet:
    'border border-transparent text-fg-subtle hover:bg-soft hover:text-fg-muted',
  danger:
    'border border-rose/20 bg-rose/[0.07] text-rose hover:border-rose/30 hover:bg-rose/[0.12]',
} as const;

const sizes = {
  xs: 'h-7 gap-1.5 rounded-[5px] px-2.5 text-[14px]',
  sm: 'h-8 gap-1.5 rounded-[6px] px-3 text-[14px]',
  md: 'h-9 gap-2 rounded-[6px] px-3.5 text-[14px]',
} as const;

export type ButtonVariant = keyof typeof variants;
export type ButtonSize = keyof typeof sizes;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'secondary',
      size = 'sm',
      loading = false,
      disabled,
      children,
      ...props
    },
    ref,
  ) => (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      className={cn(
        'inline-flex select-none items-center justify-center whitespace-nowrap font-medium leading-none transition-[background-color,border-color,color,box-shadow] duration-150 disabled:pointer-events-none disabled:opacity-45',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="animate-spin-slow" size={12} /> : null}
      {children}
    </button>
  ),
);

Button.displayName = 'Button';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  tone?: 'default' | 'danger';
  size?: 'xs' | 'sm';
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, label, tone = 'default', size = 'xs', children, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-[5px] border border-transparent text-fg-subtle transition-colors duration-150 hover:bg-soft-strong',
        tone === 'default' ? 'hover:text-fg' : 'hover:text-rose',
        size === 'xs' ? 'h-7 w-7' : 'h-8 w-8',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  ),
);

IconButton.displayName = 'IconButton';
