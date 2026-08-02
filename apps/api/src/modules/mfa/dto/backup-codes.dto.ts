import { z } from 'zod';

/**
 * Body for `POST /mfa/backup-codes/generate`. Re-issuing a batch
 * invalidates any previously unused codes server-side. Empty body —
 * we declare it explicitly so the validation pipe rejects unknown
 * fields when zod runs in strict mode.
 */
export const GenerateBackupCodesSchema = z.object({}).partial();
export type GenerateBackupCodesDto = z.infer<typeof GenerateBackupCodesSchema>;

/**
 * Body for `POST /mfa/backup-codes/use`. Backup codes are XXXX-XXXX
 * format (10 lowercase alphanumeric chars + a dash); we accept both
 * shapes ("xxxxxxxxxx" and "xxxxx-xxxxx") and normalise server-side.
 */
export const UseBackupCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .min(8, 'Backup code is too short')
    .max(32, 'Backup code is too long'),
});
export type UseBackupCodeDto = z.infer<typeof UseBackupCodeSchema>;
