import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { Button, Field, Input, Spinner } from '@/components/ui/primitives';
import { AuthShell } from './AuthShell';

const schema = z
  .object({
    password: z.string().min(8, 'Use at least 8 characters'),
    confirm_password: z.string(),
  })
  .refine((values) => values.password === values.confirm_password, {
    path: ['confirm_password'],
    message: 'Passwords do not match',
  });
type Values = z.infer<typeof schema>;

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState<'checking' | 'ready' | 'expired'>('checking');
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  useEffect(() => {
    let cancelled = false;
    const timeout = setTimeout(() => {
      if (!cancelled) setReady((current) => (current === 'checking' ? 'expired' : current));
    }, 2500);

    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session) setReady('ready');
    });

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if ((event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') && session) {
        setReady('ready');
      }
    });

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      data.subscription.unsubscribe();
    };
  }, []);

  const onSubmit = async (values: Values) => {
    setFormError(null);
    const { error } = await supabase.auth.updateUser({ password: values.password });
    if (error) {
      setFormError(error.message);
      return;
    }
    await supabase.auth.signOut();
    navigate('/login', { replace: true });
  };

  if (ready === 'checking') {
    return (
      <AuthShell title="Verifying link" subtitle="Confirming your recovery session.">
        <Spinner label="Checking your recovery link…" />
      </AuthShell>
    );
  }

  if (ready === 'expired') {
    return (
      <AuthShell title="Link expired" subtitle="This recovery link is invalid or has already been used.">
        <p className="text-sm leading-relaxed text-slate-600">
          Request a new recovery email, or ask an AICTE administrator to reset your access.
        </p>
        <Button className="mt-4 w-full" onClick={() => navigate('/forgot-password')}>
          Request a new link
        </Button>
        <p className="mt-3 text-center text-xs text-slate-500">
          <Link to="/login" className="font-medium text-navy-700 hover:underline">
            Back to sign in
          </Link>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Choose a new password" subtitle="Choose a password you have not used elsewhere.">
      <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
        {formError && (
          <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {formError}
          </div>
        )}
        <Field label="New password" htmlFor="password" error={errors.password?.message} required>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            aria-invalid={!!errors.password}
            {...register('password')}
          />
        </Field>
        <Field label="Confirm password" htmlFor="confirm_password" error={errors.confirm_password?.message} required>
          <Input
            id="confirm_password"
            type="password"
            autoComplete="new-password"
            aria-invalid={!!errors.confirm_password}
            {...register('confirm_password')}
          />
        </Field>
        <Button type="submit" className="w-full" loading={isSubmitting}>
          Update password
        </Button>
      </form>
    </AuthShell>
  );
}
