import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { Button, Field, Input } from '@/components/ui/primitives';
import { AuthShell } from './AuthShell';

const schema = z.object({ email: z.string().trim().email('Enter a valid email address') });
type Values = z.infer<typeof schema>;

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  const onSubmit = async (values: Values) => {
    setFormError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(values.email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) {
      setFormError(error.message);
      return;
    }
    setSent(true);
  };

  return (
    <AuthShell
      title="Reset your password"
      subtitle="We will email a secure recovery link to your registered address."
      footer={
        <p className="text-xs text-slate-500">
          <Link className="font-medium text-navy-700 hover:underline" to="/login">
            Back to sign in
          </Link>
        </p>
      }
    >
      {sent ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm leading-relaxed text-emerald-900">
          If an account exists for that address, a recovery email is on its way. The link expires shortly. If you do not
          receive it, ask an administrator to verify your account email.
        </div>
      ) : (
        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          {formError && (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {formError}
            </div>
          )}
          <Field label="Email address" htmlFor="email" error={errors.email?.message} required>
            <Input id="email" type="email" autoComplete="email" aria-invalid={!!errors.email} {...register('email')} />
          </Field>
          <Button type="submit" className="w-full" loading={isSubmitting}>
            Send recovery link
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
