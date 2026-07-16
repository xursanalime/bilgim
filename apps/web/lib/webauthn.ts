/**
 * Minimal, dependency-free WebAuthn browser helper.
 *
 * The backend MFA module verifies assertions with `@simplewebauthn/server`,
 * which speaks the JSON wire format (`PublicKeyCredentialCreationOptionsJSON`
 * / `PublicKeyCredentialRequestOptionsJSON`) with base64url-encoded binary
 * fields. The conventional client counterpart is `@simplewebauthn/browser`,
 * but that package is **not installed** in `apps/web` (see package.json), so
 * this module re-implements the small slice we need:
 *
 *   - Feature detection (`isWebAuthnSupported`).
 *   - base64url <-> ArrayBuffer conversions.
 *   - `startRegistration` — turns the server's creation options JSON into a
 *     `navigator.credentials.create()` call and serialises the resulting
 *     credential back into the JSON shape the API expects.
 *   - `startAuthentication` — the assertion equivalent.
 *
 * If/when `@simplewebauthn/browser` is added to the web app, these helpers can
 * be swapped for `startRegistration` / `startAuthentication` from that library
 * without touching the calling components.
 */

// ─────────────────────────────────────────────────────────────────────────
// Wire types (loose mirrors of the SimpleWebAuthn JSON shapes)
// ─────────────────────────────────────────────────────────────────────────

export interface PublicKeyCredentialDescriptorJSON {
  id: string;
  type: 'public-key';
  transports?: string[];
}

export interface RegistrationOptionsJSON {
  challenge: string;
  rp: { name: string; id?: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: Array<{ type: 'public-key'; alg: number }>;
  timeout?: number;
  attestation?: AttestationConveyancePreference;
  excludeCredentials?: PublicKeyCredentialDescriptorJSON[];
  authenticatorSelection?: AuthenticatorSelectionCriteria;
  extensions?: Record<string, unknown>;
}

export interface AuthenticationOptionsJSON {
  challenge: string;
  timeout?: number;
  rpId?: string;
  allowCredentials?: PublicKeyCredentialDescriptorJSON[];
  userVerification?: UserVerificationRequirement;
  extensions?: Record<string, unknown>;
}

export interface RegistrationResponseJSON {
  id: string;
  rawId: string;
  type: string;
  response: {
    clientDataJSON: string;
    attestationObject: string;
    transports?: string[];
    authenticatorData?: string;
    publicKeyAlgorithm?: number;
    publicKey?: string;
  };
  clientExtensionResults: Record<string, unknown>;
  authenticatorAttachment?: string;
}

export interface AuthenticationResponseJSON {
  id: string;
  rawId: string;
  type: string;
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle?: string;
  };
  clientExtensionResults: Record<string, unknown>;
  authenticatorAttachment?: string;
}

/** Errors thrown by the helpers carry a stable `code` for UI mapping. */
export class WebAuthnError extends Error {
  constructor(
    public code:
      | 'UNSUPPORTED'
      | 'CANCELLED'
      | 'INVALID_STATE'
      | 'SECURITY'
      | 'UNKNOWN',
    message: string,
  ) {
    super(message);
    this.name = 'WebAuthnError';
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Feature detection
// ─────────────────────────────────────────────────────────────────────────

/**
 * True when the browser exposes the WebAuthn API. WebAuthn additionally
 * requires a secure context (HTTPS or localhost); `window.isSecureContext`
 * reflects that so we don't offer an option that will instantly throw.
 */
export function isWebAuthnSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    typeof window.PublicKeyCredential === 'function' &&
    typeof navigator !== 'undefined' &&
    !!navigator.credentials &&
    typeof navigator.credentials.create === 'function' &&
    typeof navigator.credentials.get === 'function' &&
    window.isSecureContext === true
  );
}

// ─────────────────────────────────────────────────────────────────────────
// base64url <-> ArrayBuffer
// ─────────────────────────────────────────────────────────────────────────

function base64urlToBuffer(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const pad =
    padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function bufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i] as number);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function toDescriptors(
  descriptors: PublicKeyCredentialDescriptorJSON[] | undefined,
): PublicKeyCredentialDescriptor[] | undefined {
  if (!descriptors || descriptors.length === 0) return undefined;
  return descriptors.map((d) => ({
    id: base64urlToBuffer(d.id),
    type: 'public-key',
    ...(d.transports
      ? { transports: d.transports as AuthenticatorTransport[] }
      : {}),
  }));
}

function mapDomError(err: unknown): WebAuthnError {
  if (err instanceof WebAuthnError) return err;
  const name = err instanceof DOMException ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
      return new WebAuthnError('CANCELLED', 'Operation cancelled or timed out');
    case 'InvalidStateError':
      return new WebAuthnError(
        'INVALID_STATE',
        'This authenticator is already registered',
      );
    case 'SecurityError':
      return new WebAuthnError('SECURITY', 'WebAuthn security check failed');
    default:
      return new WebAuthnError(
        'UNKNOWN',
        err instanceof Error ? err.message : 'WebAuthn request failed',
      );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────────────────────────────────

export async function startRegistration(
  options: RegistrationOptionsJSON,
): Promise<RegistrationResponseJSON> {
  if (!isWebAuthnSupported()) {
    throw new WebAuthnError('UNSUPPORTED', 'WebAuthn is not supported here');
  }

  const publicKey: PublicKeyCredentialCreationOptions = {
    challenge: base64urlToBuffer(options.challenge),
    rp: options.rp,
    user: {
      id: base64urlToBuffer(options.user.id),
      name: options.user.name,
      displayName: options.user.displayName,
    },
    pubKeyCredParams: options.pubKeyCredParams,
    ...(options.timeout ? { timeout: options.timeout } : {}),
    ...(options.attestation ? { attestation: options.attestation } : {}),
    ...(options.authenticatorSelection
      ? { authenticatorSelection: options.authenticatorSelection }
      : {}),
    ...(options.extensions ? { extensions: options.extensions } : {}),
  };

  const excludeCredentials = toDescriptors(options.excludeCredentials);
  if (excludeCredentials) {
    publicKey.excludeCredentials = excludeCredentials;
  }

  let credential: PublicKeyCredential | null;
  try {
    credential = (await navigator.credentials.create({
      publicKey,
    })) as PublicKeyCredential | null;
  } catch (err) {
    throw mapDomError(err);
  }

  if (!credential) {
    throw new WebAuthnError('UNKNOWN', 'No credential returned by the browser');
  }

  const response = credential.response as AuthenticatorAttestationResponse;
  const transports =
    typeof response.getTransports === 'function'
      ? response.getTransports()
      : undefined;

  return {
    id: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bufferToBase64url(response.clientDataJSON),
      attestationObject: bufferToBase64url(response.attestationObject),
      ...(transports && transports.length > 0 ? { transports } : {}),
    },
    clientExtensionResults: credential.getClientExtensionResults() as Record<
      string,
      unknown
    >,
    ...(credential.authenticatorAttachment
      ? { authenticatorAttachment: credential.authenticatorAttachment }
      : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Authentication
// ─────────────────────────────────────────────────────────────────────────

export async function startAuthentication(
  options: AuthenticationOptionsJSON,
): Promise<AuthenticationResponseJSON> {
  if (!isWebAuthnSupported()) {
    throw new WebAuthnError('UNSUPPORTED', 'WebAuthn is not supported here');
  }

  const publicKey: PublicKeyCredentialRequestOptions = {
    challenge: base64urlToBuffer(options.challenge),
    ...(options.timeout ? { timeout: options.timeout } : {}),
    ...(options.rpId ? { rpId: options.rpId } : {}),
    ...(options.userVerification
      ? { userVerification: options.userVerification }
      : {}),
    ...(options.extensions ? { extensions: options.extensions } : {}),
  };

  const allowCredentials = toDescriptors(options.allowCredentials);
  if (allowCredentials) {
    publicKey.allowCredentials = allowCredentials;
  }

  let credential: PublicKeyCredential | null;
  try {
    credential = (await navigator.credentials.get({
      publicKey,
    })) as PublicKeyCredential | null;
  } catch (err) {
    throw mapDomError(err);
  }

  if (!credential) {
    throw new WebAuthnError('UNKNOWN', 'No assertion returned by the browser');
  }

  const response = credential.response as AuthenticatorAssertionResponse;

  return {
    id: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bufferToBase64url(response.clientDataJSON),
      authenticatorData: bufferToBase64url(response.authenticatorData),
      signature: bufferToBase64url(response.signature),
      ...(response.userHandle
        ? { userHandle: bufferToBase64url(response.userHandle) }
        : {}),
    },
    clientExtensionResults: credential.getClientExtensionResults() as Record<
      string,
      unknown
    >,
    ...(credential.authenticatorAttachment
      ? { authenticatorAttachment: credential.authenticatorAttachment }
      : {}),
  };
}
