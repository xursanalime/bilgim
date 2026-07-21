/**
 * Payme integration constants.
 *
 * The login portion of the Basic Auth header is by Payme's convention always
 * `Paycom`, regardless of the merchant. The shared secret (key) is the
 * merchant key generated in Payme's merchant cabinet — different per env
 * (`PAYME_KEY` for production, `PAYME_TEST_KEY` for sandbox).
 *
 * IP allowlist is configured via the `PAYME_IP_ALLOWLIST` env var
 * (comma-separated). When empty/unset the guard treats it as "any" — useful
 * for local dev and for the test sandbox where Payme's IP is not stable.
 *
 * Reference: https://developer.help.paycom.uz
 */
export const PAYME_DEFAULT_LOGIN = 'Paycom';

/** State numeric encoding used in JSON-RPC responses (Payme convention). */
export const PAYME_STATE_NUMBERS = {
  CREATED: 1,
  PAID: 2,
  CANCELED: -1,
  CANCELED_AFTER_PAY: -2,
} as const;

/** Map our internal `PaymeTxState` enum to Payme's numeric state code. */
export function paymeStateToNumber(
  state: 'PENDING' | 'CREATED' | 'PAID' | 'CANCELED' | 'CANCELED_AFTER_PAY',
): number {
  switch (state) {
    case 'PENDING':
      // Payme has no concept of PENDING — we use it pre-CreateTransaction.
      // Return 0 so a CheckTransaction call before CreateTransaction is
      // distinguishable, even though PerformTransaction always sees CREATED.
      return 0;
    case 'CREATED':
      return PAYME_STATE_NUMBERS.CREATED;
    case 'PAID':
      return PAYME_STATE_NUMBERS.PAID;
    case 'CANCELED':
      return PAYME_STATE_NUMBERS.CANCELED;
    case 'CANCELED_AFTER_PAY':
      return PAYME_STATE_NUMBERS.CANCELED_AFTER_PAY;
  }
}
