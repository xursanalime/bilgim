#!/usr/bin/env -S node --enable-source-maps
/* eslint-disable no-console */
/**
 * `backup-encrypt.ts` (Task 28.4, Req 28.8).
 *
 * Encrypts a file in place, writing `<input>.enc` next to the
 * original. Wraps `BackupEncryptionService` with a thin CLI shell so
 * the cron pipeline (`infra/security/backup/run-backup.sh`) can
 * invoke it without booting the full Nest application.
 *
 * Usage:
 *
 *   BACKUP_ENCRYPTION_KEY=$(cat /etc/bilgim/backup.key) \
 *     node apps/api/scripts/backup-encrypt.ts /var/backups/db-2026-05-28.sql
 *
 * Streams the input through AES-256-GCM and writes
 * `/var/backups/db-2026-05-28.sql.enc`. Exits 0 on success and 1 on
 * any failure (key missing, IO error, etc.) so cron can alert.
 *
 * **Stdin mode.** When the input path is literal `-`, the script
 * reads stdin and writes ciphertext to stdout — useful for piping
 * directly from `pg_dump`:
 *
 *   pg_dump ... | node apps/api/scripts/backup-encrypt.ts - > backup.enc
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Logger } from '@nestjs/common';

import { BackupEncryptionService } from '../src/modules/security/backup/backup-encryption.service';

// Silence Nest's Logger — its `log()` writes to stdout and would
// pollute ciphertext when the CLI runs in stdin/stdout pipe mode.
// Logger is reset on first use, so doing this at module load is
// enough.
Logger.overrideLogger(false);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0] === '--help' || args[0] === '-h') {
    printUsage();
    process.exit(args.length === 1 ? 0 : 64);
    return;
  }
  const target = args[0];
  const keyMaterial = process.env.BACKUP_ENCRYPTION_KEY;
  if (!keyMaterial) {
    console.error(
      'BACKUP_ENCRYPTION_KEY env var is not set. Generate with `openssl rand -base64 32`.',
    );
    process.exit(2);
    return;
  }

  let svc: BackupEncryptionService;
  try {
    svc = BackupEncryptionService.fromKeyMaterial(keyMaterial);
  } catch (err) {
    console.error(`Invalid BACKUP_ENCRYPTION_KEY: ${(err as Error).message}`);
    process.exit(2);
    return;
  }

  if (target === '-') {
    await pipeStreams(svc, process.stdin, process.stdout);
    return;
  }

  const absolute = resolve(target);
  try {
    const info = await stat(absolute);
    if (!info.isFile()) {
      console.error(`Input path is not a regular file: ${absolute}`);
      process.exit(1);
      return;
    }
  } catch (err) {
    console.error(`Cannot stat ${absolute}: ${(err as Error).message}`);
    process.exit(1);
    return;
  }

  const outputPath = `${absolute}.enc`;
  const input = createReadStream(absolute);
  const output = createWriteStream(outputPath, { mode: 0o600 });

  try {
    await pipeStreams(svc, input, output);
    console.log(`Encrypted: ${absolute} -> ${outputPath}`);
  } catch (err) {
    console.error(`Encryption failed: ${(err as Error).message}`);
    process.exit(1);
  }
}

async function pipeStreams(
  svc: BackupEncryptionService,
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
): Promise<void> {
  return new Promise((resolveStream, rejectStream) => {
    const cipher = svc.encryptStream(input as never);
    cipher.on('error', rejectStream);
    output.on('error', rejectStream);
    output.on('finish', resolveStream);
    cipher.pipe(output);
  });
}

function printUsage(): void {
  console.log(`Usage: backup-encrypt.ts <input-file | ->
  Reads <input-file> (or stdin when '-') and writes ciphertext to
  <input-file>.enc (or stdout). Requires BACKUP_ENCRYPTION_KEY to be
  set to a base64-encoded 32-byte key.

  Generate a key with:
      openssl rand -base64 32`);
}

void main();
