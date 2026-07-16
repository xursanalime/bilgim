# ADR 002: KMS and Envelope Encryption for PII

## Status
Accepted

## Context
Handling Personally Identifiable Information (PII) such as phone numbers, emails, and home addresses requires strong encryption at rest. We need a way to rotate encryption keys without re-encrypting the entire database and to support "crypto-shredding" for GDPR erasure compliance.

## Decision
We implement **Envelope Encryption** managed by a central **Key Management Service (KMS)**:

1.  **Master Key:** A single master key (stored in HashiCorp Vault or a Secure Env Variable) is used to encrypt Data Encryption Keys (DEKs).
2.  **Data Encryption Keys (DEKs):**
    *   Stored in the database, but encrypted by the Master Key.
    *   Represented by the `KmsKey` model.
    *   Rotated every 90 days (managed by `KeyManagementService`).
3.  **Envelope Format:**
    *   Data is stored as `v2:<keyId>:<iv>:<ciphertext>:<tag>`.
    *   This allows the system to identify which DEK was used to encrypt a specific row, supporting zero-downtime rotation.
4.  **Crypto-Shredding:**
    *   For highly sensitive user data, we generate per-user DEKs.
    *   To fulfill a GDPR erasure request, we simply destroy the user's specific DEK, rendering all their encrypted data unrecoverable even if database backups persist.

## Consequences
*   **Security:** Compromise of the database does not leak PII without the Master Key.
*   **Scalability:** Key rotation is a lightweight metadata operation.
*   **Compliance:** Fully supports GDPR "Right to be Forgotten" via crypto-shredding.
*   **Complexity:** Application logic must handle the envelope format and interact with the `KmsEnvelopeService`. This is abstracted via a Prisma Extension (`apps/api/src/modules/security/encryption/prisma-encryption.extension.ts`).
