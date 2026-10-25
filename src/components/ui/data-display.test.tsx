import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  AdministrativeBadge,
  ApplicationStatusBadge,
  DiscrepancyStatusBadge,
  MaturityBadge,
  MetricCard,
  VerificationBadge,
} from './data-display';

describe('status badges', () => {
  it('renders human-readable verification labels', () => {
    render(<VerificationBadge status="flagged" />);
    expect(screen.getByText('Flagged for review')).toBeInTheDocument();
  });

  it('renders administrative and application statuses', () => {
    render(
      <>
        <AdministrativeBadge status="release_pending" />
        <ApplicationStatusBadge status="info_required" />
        <DiscrepancyStatusBadge status="accepted" />
      </>,
    );
    expect(screen.getByText('Release pending')).toBeInTheDocument();
    expect(screen.getByText('Additional information required')).toBeInTheDocument();
    expect(screen.getByText('Accepted with explanation')).toBeInTheDocument();
  });

  it('renders maturity states without claiming compliance', () => {
    render(<MaturityBadge state="matured_no_application" label="Matured — no release application" />);
    expect(screen.getByText('Matured — no release application')).toBeInTheDocument();
  });
});

describe('metric card', () => {
  it('renders the metric value and hint, and links when a destination is given', () => {
    render(
      <MemoryRouter>
        <MetricCard label="Matured" value={12} hint="Needs follow-up" to="/maturity" />
      </MemoryRouter>,
    );
    expect(screen.getByText('Matured')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/maturity');
  });
});
