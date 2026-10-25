import { z } from 'zod';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date picker or yyyy-mm-dd format')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    // Round-trip check rejects rolled-over dates such as 2025-02-31.
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'Enter a valid calendar date');

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters`)
    .optional()
    .transform((value) => (value === '' ? undefined : value));

export const fdrFormSchema = z
  .object({
    institution_id: z.string().uuid('Select an institution'),
    fdr_reference_number: z
      .string()
      .trim()
      .min(3, 'Reference number must be at least 3 characters')
      .max(80, 'Reference number is too long')
      .regex(/^[A-Za-z0-9][A-Za-z0-9/\-_. ]*$/, 'Use letters, digits, and / - _ . only'),
    issuing_bank: z.string().trim().min(2, 'Enter the issuing bank').max(120),
    branch_name: optionalText(120),
    deposit_amount: z.coerce
      .number({ invalid_type_error: 'Enter the deposit amount' })
      .positive('Amount must be greater than zero')
      .max(9_99_99_99_999, 'Amount looks too large'),
    issue_date: isoDate,
    maturity_date: isoDate,
    notes: optionalText(2000),
  })
  .superRefine((value, context) => {
    if (value.issue_date && value.maturity_date && value.maturity_date <= value.issue_date) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['maturity_date'],
        message: 'Maturity date must be after the issue date',
      });
    }
    if (value.issue_date) {
      const issue = new Date(`${value.issue_date}T00:00:00Z`);
      const limit = new Date();
      limit.setUTCFullYear(limit.getUTCFullYear() + 1);
      if (issue > limit) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['issue_date'],
          message: 'Issue date cannot be more than a year in the future',
        });
      }
    }
  });

export type FdrFormValues = z.input<typeof fdrFormSchema>;
export type FdrFormParsed = z.output<typeof fdrFormSchema>;

export const institutionSchema = z.object({
  institution_code: z
    .string()
    .trim()
    .min(3, 'Code must be at least 3 characters')
    .max(30)
    .regex(/^[A-Z0-9-]+$/, 'Use capital letters, digits and hyphens only'),
  institution_name: z.string().trim().min(3, 'Enter the institution name').max(160),
  institution_type: z.enum([
    'Engineering',
    'Management',
    'Pharmacy',
    'Architecture',
    'Hotel Management',
    'Applied Arts',
    'Other',
  ]),
  region: optionalText(80),
  address: optionalText(300),
  contact_email: z
    .string()
    .trim()
    .email('Enter a valid email')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  contact_phone: z
    .string()
    .trim()
    .max(20)
    .regex(/^[0-9+\-\s()]*$/, 'Use digits and + - ( ) only')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  status: z.enum(['active', 'inactive']).default('active'),
});

export type InstitutionFormValues = z.input<typeof institutionSchema>;

export const applicationSchema = z.object({
  fdr_id: z.string().uuid('Select an FDR record'),
  application_type: z.enum(['release', 'renewal']),
  reason: z.string().trim().min(15, 'Explain the request in at least 15 characters').max(2000),
  amount_claimed: z
    .union([z.coerce.number().positive('Amount must be greater than zero'), z.literal(''), z.undefined()])
    .transform((value) => (value === '' ? undefined : value))
    .optional(),
  supporting_notes: optionalText(2000),
});

export type ApplicationFormValues = z.input<typeof applicationSchema>;

export const profileSchema = z.object({
  full_name: z.string().trim().min(2, 'Enter your name').max(120),
  phone: z
    .string()
    .trim()
    .max(20)
    .regex(/^[0-9+\-\s()]*$/, 'Use digits and + - ( ) only')
    .optional()
    .or(z.literal('').transform(() => undefined)),
});

export const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export const signupSchema = z
  .object({
    full_name: z.string().trim().min(2, 'Enter your full name').max(120),
    email: z.string().trim().email('Enter a valid email address'),
    password: z.string().min(8, 'Use at least 8 characters'),
    confirm_password: z.string(),
    institution_id: z.string().uuid().optional().or(z.literal('').transform(() => undefined)),
  })
  .refine((value) => value.password === value.confirm_password, {
    path: ['confirm_password'],
    message: 'Passwords do not match',
  });

export const bootstrapRequestSchema = z.object({
  full_name: z.string().trim().min(2, 'Enter your full name').max(120),
  email: z.string().trim().email('Enter a valid email address'),
  password: z
    .string()
    .min(10, 'Use at least 10 characters for the administrator account')
    .regex(/[A-Z]/, 'Include at least one uppercase letter')
    .regex(/[a-z]/, 'Include at least one lowercase letter')
    .regex(/[0-9]/, 'Include at least one digit'),
});

export const bootstrapSchema = bootstrapRequestSchema
  .extend({ confirm_password: z.string() })
  .refine((value) => value.password === value.confirm_password, {
    path: ['confirm_password'],
    message: 'Passwords do not match',
  });

export const userInviteSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  full_name: z.string().trim().min(2, 'Enter the user name').max(120),
  role: z.enum(['system_admin', 'aicte_officer', 'institution_user', 'read_only_auditor']),
  institution_id: z.string().uuid().optional().or(z.literal('').transform(() => undefined)),
  password: z.string().min(10, 'Use at least 10 characters (shared with the user securely)'),
});

export const warningDaysSchema = z
  .array(z.coerce.number().int().min(1).max(365))
  .min(1, 'Keep at least one warning interval')
  .max(5)
  .refine((days) => new Set(days).size === days.length, 'Intervals must be unique');

export const ALLOWED_DOCUMENT_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'] as const;
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export function validateDocumentFile(file: Pick<File, 'type' | 'size' | 'name'>): string | null {
  if (!ALLOWED_DOCUMENT_TYPES.includes(file.type as (typeof ALLOWED_DOCUMENT_TYPES)[number])) {
    return 'Unsupported file type. Upload a PDF, PNG, JPEG or WebP file.';
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    return 'This file is larger than 10 MB. Compress or scan it at a lower resolution.';
  }
  if (file.size === 0) return 'The selected file is empty.';
  return null;
}
