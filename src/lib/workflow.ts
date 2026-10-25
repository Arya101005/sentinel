import type { ApplicationStatus, Role } from './types';
import { APPLICATION_STATUS_LABELS } from './format';

/**
 * Controlled release / renewal lifecycle (Module F).
 *
 * The same transition table and role gates are enforced by
 * public.fn_transition_application() in PostgreSQL, so a crafted API call
 * cannot skip steps. This module drives the UI and the unit tests.
 *
 *   draft -> submitted -> under_review -> approved -> completed
 *                              |  \-> rejected
 *                              \-> info_required -> resubmitted -> under_review ...
 */
export const TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  draft: ['submitted'],
  submitted: ['under_review', 'info_required', 'rejected'],
  under_review: ['info_required', 'approved', 'rejected'],
  info_required: ['resubmitted'],
  resubmitted: ['under_review', 'approved', 'rejected'],
  approved: ['completed'],
  rejected: [],
  completed: [],
};

export const TERMINAL_STATUSES: ApplicationStatus[] = ['rejected', 'completed'];

export const STAFF_ONLY_TRANSITIONS: ApplicationStatus[] = [
  'under_review',
  'info_required',
  'approved',
  'rejected',
  'completed',
];

export const INSTITUTION_TRANSITIONS: ApplicationStatus[] = ['submitted', 'resubmitted'];

export interface TransitionContext {
  actorRole: Role;
  actorId: string | null;
  requestedBy: string | null;
  allowSelfApproval?: boolean;
}

export interface TransitionDecision {
  allowed: boolean;
  reason?: string;
}

export function nextStatuses(status: ApplicationStatus): ApplicationStatus[] {
  return TRANSITIONS[status] ?? [];
}

export function isTerminal(status: ApplicationStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function transitionLabel(status: ApplicationStatus): string {
  switch (status) {
    case 'submitted':
      return 'Submit for review';
    case 'under_review':
      return 'Start review';
    case 'info_required':
      return 'Request additional information';
    case 'resubmitted':
      return 'Resubmit';
    case 'approved':
      return 'Approve (recommendation)';
    case 'rejected':
      return 'Reject';
    case 'completed':
      return 'Record as completed';
    default:
      return APPLICATION_STATUS_LABELS[status];
  }
}

/** Transitions a note is mandatory for. */
export function requiresNote(status: ApplicationStatus): boolean {
  return status === 'info_required' || status === 'approved' || status === 'rejected' || status === 'completed';
}

/**
 * Mirrors fn_transition_application(): structural transition, role gate, and
 * the self-approval prohibition.
 */
export function canTransition(
  from: ApplicationStatus,
  to: ApplicationStatus,
  context: TransitionContext,
): TransitionDecision {
  if (!nextStatuses(from).includes(to)) {
    return { allowed: false, reason: `The workflow does not allow "${from}" to move directly to "${to}".` };
  }
  const role = context.actorRole;
  if (STAFF_ONLY_TRANSITIONS.includes(to) && role !== 'system_admin' && role !== 'aicte_officer') {
    return { allowed: false, reason: 'Only an AICTE Officer or System Administrator can perform this action.' };
  }
  if (INSTITUTION_TRANSITIONS.includes(to) && role !== 'institution_user' && role !== 'system_admin') {
    return { allowed: false, reason: 'Only the submitting institution can submit or resubmit an application.' };
  }
  if (role === 'read_only_auditor') {
    return { allowed: false, reason: 'Read-only auditors cannot change workflow status.' };
  }
  if ((to === 'approved' || to === 'completed') && context.requestedBy && context.requestedBy === context.actorId) {
    if (!context.allowSelfApproval) {
      return {
        allowed: false,
        reason: 'You cannot approve or complete an application you submitted. Self-approval is disabled by policy.',
      };
    }
  }
  return { allowed: true };
}

export function availableTransitions(
  from: ApplicationStatus,
  context: TransitionContext,
): Array<{ status: ApplicationStatus; label: string; requiresNote: boolean }> {
  return nextStatuses(from)
    .map((status) => ({
      status,
      label: transitionLabel(status),
      requiresNote: requiresNote(status),
      decision: canTransition(from, status, context),
    }))
    .filter((entry) => entry.decision.allowed)
    .map(({ status, label, requiresNote: note }) => ({ status, label, requiresNote: note }));
}
