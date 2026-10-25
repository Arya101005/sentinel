import { describe, expect, it } from 'vitest';
import { availableTransitions, canTransition, isTerminal, nextStatuses, requiresNote } from './workflow';

const officer = { actorRole: 'aicte_officer' as const, actorId: 'officer-1', requestedBy: 'inst-user-1' };
const admin = { actorRole: 'system_admin' as const, actorId: 'admin-1', requestedBy: 'inst-user-1' };
const institution = { actorRole: 'institution_user' as const, actorId: 'inst-user-1', requestedBy: 'inst-user-1' };
const auditor = { actorRole: 'read_only_auditor' as const, actorId: 'auditor-1', requestedBy: 'inst-user-1' };

describe('lifecycle structure', () => {
  it('allows the documented path end to end', () => {
    expect(nextStatuses('draft')).toEqual(['submitted']);
    expect(nextStatuses('submitted')).toContain('under_review');
    expect(nextStatuses('under_review')).toContain('approved');
    expect(nextStatuses('info_required')).toEqual(['resubmitted']);
    expect(nextStatuses('approved')).toEqual(['completed']);
  });

  it('treats rejected and completed as terminal', () => {
    expect(isTerminal('rejected')).toBe(true);
    expect(isTerminal('completed')).toBe(true);
    expect(isTerminal('under_review')).toBe(false);
  });

  it('cannot skip required steps', () => {
    expect(canTransition('submitted', 'completed', officer).allowed).toBe(false);
    expect(canTransition('draft', 'approved', officer).allowed).toBe(false);
    expect(canTransition('info_required', 'approved', officer).allowed).toBe(false);
    expect(canTransition('submitted', 'under_review', officer).allowed).toBe(true);
  });

  it('requires a note for consequential decisions', () => {
    expect(requiresNote('rejected')).toBe(true);
    expect(requiresNote('approved')).toBe(true);
    expect(requiresNote('info_required')).toBe(true);
    expect(requiresNote('under_review')).toBe(false);
  });
});

describe('role gates', () => {
  it('prevents institution users from reviewing or approving', () => {
    expect(canTransition('submitted', 'under_review', institution).allowed).toBe(false);
    expect(canTransition('under_review', 'approved', institution).allowed).toBe(false);
  });

  it('allows the owning institution to submit', () => {
    expect(canTransition('draft', 'submitted', institution).allowed).toBe(true);
    expect(canTransition('info_required', 'resubmitted', institution).allowed).toBe(true);
  });

  it('gives auditors no transitions at all', () => {
    expect(availableTransitions('submitted', auditor)).toEqual([]);
    expect(canTransition('under_review', 'approved', auditor).allowed).toBe(false);
  });

  it('allows officers and administrators to decide', () => {
    expect(canTransition('submitted', 'under_review', officer).allowed).toBe(true);
    expect(canTransition('under_review', 'approved', admin).allowed).toBe(true);
    expect(canTransition('approved', 'completed', admin).allowed).toBe(true);
  });
});

describe('segregation of duties', () => {
  it('blocks self-approval by default', () => {
    const selfReviewer = { actorRole: 'system_admin' as const, actorId: 'admin-1', requestedBy: 'admin-1' };
    const decision = canTransition('under_review', 'approved', selfReviewer);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/cannot approve/i);
  });

  it('allows self-approval only when policy explicitly enables it', () => {
    const selfReviewer = {
      actorRole: 'system_admin' as const,
      actorId: 'admin-1',
      requestedBy: 'admin-1',
      allowSelfApproval: true,
    };
    expect(canTransition('under_review', 'approved', selfReviewer).allowed).toBe(true);
  });

  it('does not block approval of somebody else\'s application', () => {
    expect(canTransition('under_review', 'approved', officer).allowed).toBe(true);
  });
});

describe('availableTransitions', () => {
  it('lists only permitted actions with note requirements', () => {
    const options = availableTransitions('submitted', officer);
    expect(options.map((option) => option.status)).toEqual(['under_review', 'info_required', 'rejected']);
    expect(options.find((option) => option.status === 'rejected')?.requiresNote).toBe(true);
  });
});
