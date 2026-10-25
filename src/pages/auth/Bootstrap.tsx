import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { api, type SetupStatus } from '@/lib/api';
import { bootstrapSchema } from '@/lib/validation';
import { useAuth } from '@/lib/auth';
import { Button, Field, Input, Spinner } from '@/components/ui/primitives';
import { AuthShell } from './AuthShell';

type BootstrapValues = z.infer<typeof bootstrapSchema>;

export default function BootstrapPage() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<BootstrapValues>({ resolver: zodResolver(bootstrapSchema) });

  useEffect(() => {
    void api
      .setupStatus()
      .then(setStatus)
      .catch((error: Error) => setLoadError(error.message));
  }, []);

  const onSubmit = async (values: BootstrapValues) => {
    setFormError(null);
    try {
      await api.bootstrap({ email: values.email, password: values.password, full_name: values.full_name });
      await signIn(values.email, values.password);
      navigate('/', { replace: true });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Administrator setup failed.');
    }
  };

  if (!status && !loadError) {
    return (
      <AuthShell title="Checking setup" subtitle="Verifying whether this deployment already has an administrator.">
        <Spinner />
      </AuthShell>
    );
  }

  if (status && status.admins > 0) {
    return (
      <AuthShell title="Already initialised" subtitle="This deployment already has a System Administrator.">
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <p className="flex items-center gap-2 font-semibold">
            <ShieldCheck className="h-4 w-4" /> Setup is complete
          </p>
          <p className="mt-1.5 leading-relaxed">
            Sign in with an administrator account, or ask an existing administrator to create your access. For security,
            new administrator accounts cannot be created from this page.
          </p>
        </div>
        <Button className="mt-4 w-full" onClick={() => navigate('/login')}>
          Go to sign in
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Initialise FDR Sentinel"
      subtitle="Create the first System Administrator for this deployment. This page stops working as soon as an administrator exists."
      footer={
        <p className="text-xs text-slate-500">
          Already set up?{' '}
          <Link className="font-medium text-navy-700 hover:underline" to="/login">
            Sign in
          </Link>
        </p>
      }
    >
      {(loadError || formError) && (
        <div role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {loadError ?? formError}
        </div>
      )}
      <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
        <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <span>
          Choose a strong password and keep it out of source control. The password is sent directly to Supabase Auth and
          is never stored by the application.
        </span>
      </div>
      <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
        <Field label="Full name" htmlFor="full_name" error={errors.full_name?.message} required>
          <Input id="full_name" autoComplete="name" aria-invalid={!!errors.full_name} {...register('full_name')} />
        </Field>
        <Field label="Official email" htmlFor="email" error={errors.email?.message} required>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            aria-invalid={!!errors.email}
            {...register('email')}
          />
        </Field>
        <Field
          label="Password"
          htmlFor="password"
          hint="At least 10 characters with upper case, lower case and a digit."
          error={errors.password?.message}
          required
        >
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
          Create administrator
        </Button>
      </form>
    </AuthShell>
  );
}
