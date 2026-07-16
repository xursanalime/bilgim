import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { MfaChallenge } from './mfa-challenge';
import type { MfaChallengeRequired, LoginTokens } from '../../../lib/mfa-api';
import { mfaApi } from '../../../lib/mfa-api';
import { ApiClientError } from '../../../lib/api-client';

jest.mock('../../../lib/mfa-api', () => ({
  mfaApi: {
    completeChallengeWithCode: jest.fn(),
  },
}));

const completeChallengeWithCode =
  mfaApi.completeChallengeWithCode as jest.MockedFunction<
    typeof mfaApi.completeChallengeWithCode
  >;

const TOKENS: LoginTokens = {
  accessToken: 'a',
  refreshToken: 'r',
  user: { id: 'u1', email: 'u@x.uz', role: 'TEACHER', fullName: 'U' },
};

function makeChallenge(
  methods: MfaChallengeRequired['methods'],
): MfaChallengeRequired {
  return { requiresMfa: true, mfaToken: 'mfa-token', expiresIn: 300, methods };
}

describe('MfaChallenge', () => {
  beforeEach(() => {
    completeChallengeWithCode.mockReset();
  });

  it('verifies a TOTP code and reports the resulting tokens', async () => {
    completeChallengeWithCode.mockResolvedValue(TOKENS);
    const onSuccess = jest.fn();

    render(
      <MfaChallenge
        challenge={makeChallenge(['totp', 'backup'])}
        locale="uz"
        onSuccess={onSuccess}
        onCancel={jest.fn()}
      />,
    );

    await userEvent.type(screen.getByLabelText(/tasdiqlash kodi/i), '123456');
    await userEvent.click(screen.getByRole('button', { name: /tasdiqlash/i }));

    await waitFor(() => {
      expect(completeChallengeWithCode).toHaveBeenCalledWith(
        'mfa-token',
        '123456',
      );
    });
    expect(onSuccess).toHaveBeenCalledWith(TOKENS);
  });

  it('shows a localized error and does not call onSuccess on an invalid code', async () => {
    completeChallengeWithCode.mockRejectedValue(
      new ApiClientError(401, 'bad', { code: 'INVALID_TOTP_CODE' }),
    );
    const onSuccess = jest.fn();

    render(
      <MfaChallenge
        challenge={makeChallenge(['totp'])}
        locale="uz"
        onSuccess={onSuccess}
        onCancel={jest.fn()}
      />,
    );

    await userEvent.type(screen.getByLabelText(/tasdiqlash kodi/i), '000000');
    await userEvent.click(screen.getByRole('button', { name: /tasdiqlash/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('lets the user switch to backup-code entry when available', async () => {
    render(
      <MfaChallenge
        challenge={makeChallenge(['totp', 'backup'])}
        locale="uz"
        onSuccess={jest.fn()}
        onCancel={jest.fn()}
      />,
    );

    await userEvent.click(
      screen.getByRole('button', { name: /zaxira kodi bilan kirish/i }),
    );
    expect(screen.getByLabelText(/zaxira kodi/i)).toBeInTheDocument();
  });

  it('guides passkey-only accounts instead of showing a code field', () => {
    render(
      <MfaChallenge
        challenge={makeChallenge(['webauthn'])}
        locale="uz"
        onSuccess={jest.fn()}
        onCancel={jest.fn()}
      />,
    );

    expect(screen.queryByLabelText(/tasdiqlash kodi/i)).not.toBeInTheDocument();
    expect(screen.getByText(/passkey/i)).toBeInTheDocument();
  });
});
