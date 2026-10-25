import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { LockKeyhole, Mail } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { loginSchema } from '@/lib/validation';
import type { z } from 'zod';
import { Button, Field, Input } from '@/components/ui/primitives';
import { AuthShell } from './AuthShell';

type LoginValues = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const { signIn, session, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) });

  if (!loading && session) {
    const target = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={target} replace />;
  }

  const onSubmit = async (values: LoginValues) => {
    setFormError(null);
    try {
      await signIn(values.email, values.password);
      const target = (location.state as { from?: string } | null)?.from ?? '/';
      navigate(target, { replace: true });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Sign-in failed. Please try again.');
    }
  };

  return (
    <AuthShell
      title="Sign in"
      subtitle="Use the account provisioned for you by an AICTE administrator."
      footer={
        <div className="space-y-2 text-xs text-slate-500">
          <p>
            New institution user?{' '}
            <Link className="font-medium text-navy-700 underline-offset-2 hover:underline" to="/signup">
              Request an account
            </Link>
          </p>
          <p>
            First-time setup?{' '}
            <Link className="font-medium text-navy-700 underline-offset-2 hover:underline" to="/bootstrap">
              Initialise the first administrator
            </Link>
          </p>
        </div>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
        {formError && (
          <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {formError}
          </div>
        )}
        <Field label="Email address" htmlFor="email" error={errors.email?.message} required>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="officer@aicte-india.org"
              className="pl-9"
              aria-invalid={!!errors.email}
              {...register('email')}
            />
          </div>
        </Field>
        <Field label="Password" htmlFor="password" error={errors.password?.message} required>
          <div className="relative">
            <LockKeyhole className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              className="pl-9"
              aria-invalid={!!errors.password}
              {...register('password')}
            />
          </div>
        </Field>
        <div className="flex items-center justify-between text-xs">
          <Link to="/forgot-password" className="font-medium text-navy-700 hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" className="w-full" loading={isSubmitting}>
          Sign in
        </Button>
      </form>
    </AuthShell>
  );
}
