import { render, screen } from '@testing-library/react';

import { SubscriptionRestrictionBanner } from './subscription-restriction-banner';

describe('SubscriptionRestrictionBanner', () => {
  it('renders nothing when the status grants access', () => {
    const { container: trial } = render(
      <SubscriptionRestrictionBanner status="TRIAL" locale="uz" />,
    );
    expect(trial).toBeEmptyDOMElement();

    const { container: active } = render(
      <SubscriptionRestrictionBanner status="ACTIVE" locale="uz" />,
    );
    expect(active).toBeEmptyDOMElement();
  });

  it('renders nothing for a null status', () => {
    const { container } = render(
      <SubscriptionRestrictionBanner status={null} locale="uz" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a PAST_DUE restriction alert linking to the subscription page', () => {
    render(<SubscriptionRestrictionBanner status="PAST_DUE" locale="uz" />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/uz/settings/subscription');
  });

  it('renders an EXPIRED restriction alert', () => {
    render(<SubscriptionRestrictionBanner status="EXPIRED" locale="uz" />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/muddati tugadi/i)).toBeInTheDocument();
  });

  it('honors a custom resolve href', () => {
    render(
      <SubscriptionRestrictionBanner
        status="PAST_DUE"
        locale="uz"
        href="/uz/custom/billing"
      />,
    );
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      '/uz/custom/billing',
    );
  });
});
