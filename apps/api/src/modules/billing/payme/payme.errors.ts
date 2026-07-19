/**
 * Payme JSON-RPC error codes.
 *
 * Reference: https://developer.help.paycom.uz/protokol-merchant-api/spisok-oshibok
 *
 * The negative codes outside the standard JSON-RPC 2.0 range (-32700..-32600)
 * are Payme-specific business errors. We surface them verbatim in the
 * response envelope so Payme's verifier accepts them without translation.
 */
export const PAYME_ERROR_CODES = {
  // Standard JSON-RPC 2.0 transport errors
  TRANSPORT_PARSE: -32700,
  TRANSPORT_INVALID_REQUEST: -32600,
  TRANSPORT_METHOD_NOT_FOUND: -32601,
  TRANSPORT_INVALID_PARAMS: -32602,

  // Payme-specific
  AUTH_INSUFFICIENT_PRIVILEGE: -32504,
  ACCOUNT_NOT_FOUND: -31050,
  ACCOUNT_INACTIVE: -31051,
  INVALID_AMOUNT: -31001,
  TRANSACTION_NOT_FOUND: -31003,
  CANNOT_CANCEL_TRANSACTION: -31007,
  CANNOT_PERFORM_TRANSACTION: -31008,
} as const;

export type PaymeErrorCode =
  (typeof PAYME_ERROR_CODES)[keyof typeof PAYME_ERROR_CODES];

/**
 * Payme returns localized error messages keyed by language. We default each
 * code to a sensible uz/ru/en triplet; callers may override per-throw.
 */
export interface PaymeLocalizedMessage {
  uz: string;
  ru: string;
  en: string;
}

export const DEFAULT_PAYME_ERROR_MESSAGES: Record<number, PaymeLocalizedMessage> = {
  [PAYME_ERROR_CODES.TRANSPORT_PARSE]: {
    uz: 'JSON-RPC parse xatosi',
    ru: 'Ошибка разбора JSON-RPC',
    en: 'Parse error',
  },
  [PAYME_ERROR_CODES.TRANSPORT_INVALID_REQUEST]: {
    uz: "Noto'g'ri so'rov",
    ru: 'Неверный запрос',
    en: 'Invalid request',
  },
  [PAYME_ERROR_CODES.TRANSPORT_METHOD_NOT_FOUND]: {
    uz: 'Metod topilmadi',
    ru: 'Метод не найден',
    en: 'Method not found',
  },
  [PAYME_ERROR_CODES.TRANSPORT_INVALID_PARAMS]: {
    uz: "Noto'g'ri parametrlar",
    ru: 'Неверные параметры',
    en: 'Invalid params',
  },
  [PAYME_ERROR_CODES.AUTH_INSUFFICIENT_PRIVILEGE]: {
    uz: 'Avtorizatsiya talab etiladi',
    ru: 'Недостаточно привилегий',
    en: 'Insufficient privilege',
  },
  [PAYME_ERROR_CODES.ACCOUNT_NOT_FOUND]: {
    uz: 'Hisob topilmadi',
    ru: 'Счёт не найден',
    en: 'Account not found',
  },
  [PAYME_ERROR_CODES.ACCOUNT_INACTIVE]: {
    uz: 'Hisob faol emas',
    ru: 'Счёт неактивен',
    en: 'Account inactive',
  },
  [PAYME_ERROR_CODES.INVALID_AMOUNT]: {
    uz: "Noto'g'ri summa",
    ru: 'Неверная сумма',
    en: 'Invalid amount',
  },
  [PAYME_ERROR_CODES.TRANSACTION_NOT_FOUND]: {
    uz: 'Tranzaksiya topilmadi',
    ru: 'Транзакция не найдена',
    en: 'Transaction not found',
  },
  [PAYME_ERROR_CODES.CANNOT_CANCEL_TRANSACTION]: {
    uz: "Tranzaksiyani bekor qilib bo'lmaydi",
    ru: 'Невозможно отменить транзакцию',
    en: 'Cannot cancel transaction',
  },
  [PAYME_ERROR_CODES.CANNOT_PERFORM_TRANSACTION]: {
    uz: "Tranzaksiyani bajarib bo'lmaydi",
    ru: 'Невозможно выполнить транзакцию',
    en: 'Cannot perform transaction',
  },
};

/**
 * PaymeError — thrown by the auth guard, service, and controller. Caught by
 * `PaymeExceptionFilter` and serialized to a JSON-RPC `{ error }` body with
 * HTTP 200 (Payme always expects 200; errors travel in the response body).
 */
export class PaymeError extends Error {
  readonly code: number;
  readonly data: unknown;
  readonly localizedMessage: PaymeLocalizedMessage;

  constructor(
    code: number,
    data?: unknown,
    customMessage?: PaymeLocalizedMessage,
  ) {
    const localizedMessage =
      customMessage ??
      DEFAULT_PAYME_ERROR_MESSAGES[code] ?? {
        uz: 'Xatolik',
        ru: 'Ошибка',
        en: 'Error',
      };
    super(localizedMessage.en);
    this.name = 'PaymeError';
    this.code = code;
    this.data = data;
    this.localizedMessage = localizedMessage;
  }

  /** Serialize to the `error` field of a JSON-RPC 2.0 response. */
  toJsonRpcError(): {
    code: number;
    message: PaymeLocalizedMessage;
    data?: unknown;
  } {
    if (this.data === undefined) {
      return { code: this.code, message: this.localizedMessage };
    }
    return { code: this.code, message: this.localizedMessage, data: this.data };
  }
}
