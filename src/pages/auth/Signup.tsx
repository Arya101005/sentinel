import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { Info } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { signupSchema } from '@/lib/validation';
import { Button, Field, Input } from '@/components/ui/primitives';
import { AuthShell } from './AuthShell';

type SignupValues = z.infer<typeof signupSchema>;

export default function SignupPage() {
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState<{ needsConfirmation: boolean } | null>(null);
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignupValues>({ resolver: zodResolver(signupSchema) });

  const onSubmit = async (values: SignupValues) => {
    setFormError(null);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: values.email.trim(),
        password: values.password,
        options: { data: { full_name: values.full_name.trim() } },
      });
      if (error) throw new Error(error.message);
      if (data.session) {
        navigate('/fdrs', { replace: true });
      } else {
        setDone({ needsConfirmation: true });
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Registration failed.');
    }
  };

  if (done) {
    return (
      <AuthShell title="Account created" subtitle="One more step before you can sign in.">
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm leading-relaxed text-emerald-900">
          {done.needsConfirmation ? (
            <>
              <p className="font-semibold">Confirm your email address</p>
              <p className="mt-1">
                Supabase Auth has sent a confirmation email. Follow the link, then sign in. Your account starts with the
                restricted <strong>Institution User</strong> role and no institution — an AICTE administrator assigns
                both before records are visible.
              </p>
            </>
          ) : (
            <p>Your account is ready. An administrator still needs to assign your role and institution.</p>
          )}
        </div>
        <Button className="mt-4 w-full" onClick={() => navigate('/login')}>
          Go to sign in
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Request an account"
      subtitle="Self-registration creates a restricted institution account. Roles and institution access are assigned by AICTE."
      footer={
        <p className="text-xs text-slate-500">
          Already registered?{' '}
          <Link className="font-medium text-navy-700 hover:underline" to="/login">
            Sign in
          </Link>
        </p>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
        {formError && (
          <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {formError}
          </div>
        )}
        <div className="flex items-start gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs leading-relaxed text-sky-900">
          <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>
            Self-registration can never create an administrator, officer or auditor account. Privileged roles are
            granted server-side by an existing administrator.
          </span>
        </div>
        <Field label="Full name" htmlFor="full_name" error={errors.full_name?.message} required>
          <Input id="full_name" autoComplete="name" aria-invalid={!!errors.full_name} {...register('full_name')} />
        </Field>
        <Field label="Official email" htmlFor="email" error={errors.email?.message} required>
          <Input id="email" type="email" autoComplete="email" aria-invalid={!!errors.email} {...register('email')} />
        </Field>
        <Field label="Password" htmlFor="password" hint="At least 8 characters." error={errors.password?.message} required>
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
          Create account
        </Button>
      </form>
    </AuthShell>
  );
}
