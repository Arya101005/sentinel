import * as React from 'react';
import { cn } from '@/lib/utils';

/* -------------------------------------------------------------------------- */
/* Button                                                                      */
/* -------------------------------------------------------------------------- */
type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success';
type Size = 'sm' | 'md' | 'lg' | 'icon';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-primary text-primary-foreground hover:bg-navy-800 focus-visible:ring-primary disabled:bg-primary/60',
  secondary:
    'bg-secondary text-secondary-foreground hover:bg-slate-200 focus-visible:ring-secondary-foreground/40',
  outline:
    'border border-input bg-white text-slate-700 hover:bg-slate-50 hover:text-navy-900 focus-visible:ring-primary',
  ghost: 'text-slate-600 hover:bg-slate-100 hover:text-navy-900',
  danger: 'bg-destructive text-destructive-foreground hover:bg-red-700 focus-visible:ring-destructive',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:ring-emerald-600',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 gap-1.5 px-3 text-xs',
  md: 'h-10 gap-2 px-4 text-sm',
  lg: 'h-11 gap-2 px-5 text-sm',
  icon: 'h-9 w-9',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading = false, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        'inline-flex select-none items-center justify-center whitespace-nowrap rounded-md font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-60',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading && (
        <span
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden="true"
        />
      )}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';

/* -------------------------------------------------------------------------- */
/* Card                                                                        */
/* -------------------------------------------------------------------------- */
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border border-border bg-card text-card-foreground shadow-card', className)} {...props} />;
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1 border-b border-slate-100 px-4 py-3.5 sm:px-5', className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-sm font-semibold tracking-tight text-navy-900', className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-xs leading-relaxed text-slate-500', className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-4 py-4 sm:px-5', className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-3 sm:px-5', className)} {...props} />;
}

/* -------------------------------------------------------------------------- */
/* Inputs                                                                      */
/* -------------------------------------------------------------------------- */
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm text-slate-900 shadow-sm',
        'placeholder:text-slate-400 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500',
        'aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-destructive/30',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-[80px] w-full rounded-md border border-input bg-white px-3 py-2 text-sm text-slate-900 shadow-sm',
        'placeholder:text-slate-400 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring',
        'aria-[invalid=true]:border-destructive',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm text-slate-900 shadow-sm',
        'focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500',
        'aria-[invalid=true]:border-destructive',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = 'Select';

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('field-label', className)} {...props} />;
}

export function FieldError({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p className="mt-1 text-xs font-medium text-red-600" role="alert">
      {children}
    </p>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </Label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      <FieldError>{error}</FieldError>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Badge                                                                       */
/* -------------------------------------------------------------------------- */
export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'outline';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  info: 'bg-sky-50 text-sky-700 ring-sky-200',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  warning: 'bg-amber-50 text-amber-800 ring-amber-200',
  danger: 'bg-red-50 text-red-700 ring-red-200',
  outline: 'bg-white text-slate-600 ring-slate-200',
};

export function Badge({
  tone = 'neutral',
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset',
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Alert                                                                       */
/* -------------------------------------------------------------------------- */
export function Alert({
  tone = 'info',
  title,
  children,
  action,
  className,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success';
  title?: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  const styles = {
    info: 'border-sky-200 bg-sky-50 text-sky-900',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    danger: 'border-red-200 bg-red-50 text-red-900',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  } as const;
  return (
    <div className={cn('flex items-start gap-3 rounded-md border px-3.5 py-3 text-sm', styles[tone], className)}>
      <div className="flex-1 space-y-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="leading-relaxed">{children}</div>}
      </div>
      {action}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Misc                                                                        */
/* -------------------------------------------------------------------------- */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-slate-200/70', className)} />;
}

export function Separator({ className }: { className?: string }) {
  return <div className={cn('h-px w-full bg-slate-100', className)} role="separator" />;
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-navy-700" />
      {label}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      {icon && <div className="rounded-full bg-slate-100 p-3 text-slate-500">{icon}</div>}
      <div className="space-y-1">
        <p className="text-sm font-semibold text-navy-900">{title}</p>
        {description && <p className="mx-auto max-w-md text-sm leading-relaxed text-slate-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{eyebrow}</p>}
        <h1 className="text-xl font-semibold tracking-tight text-navy-900 sm:text-2xl">{title}</h1>
        {description && <div className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-600">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
