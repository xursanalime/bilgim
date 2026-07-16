#!/usr/bin/env -S node --enable-source-maps
/* eslint-disable no-console */
/**
 * `backup-decrypt.ts` (Task 28.4, Req 28.8). Reverse of
 * `backup-encrypt.ts`.
 *
 * Usage:
 *
 *   BACKUP_ENCRYPTION_KEY=$(cat /etc/bilgim/backup.key) \
 *     node apps/api/scripts/backup-decrypt.ts /var/backups/db-2026-05-28.sql.enc
 *
 * Streams `<input>.enc` through AES-256-GCM and writes the original
 * file path (with the `.enc` suffix stripped). Refuses to overwrite
 * an existing plaintext file unless `--force` is supplied. Exits 0
 * on success and 1 on any failure.
 *
 * **Stdin mode.** When the input path is literal `-`, the script
 * reads ciphertext from stdin and writes plaintext to stdout.
 */
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Logger } from '@nestjs/common';

import { BackupEncryptionService } from '../src/modules/security/backup/backup-encryption.service';

// Silence Nest's Logger — its `log()` writes to stdout and would
// pollute plaintext when the CLI runs in stdin/stdout pipe mode.
Logger.overrideLogger(false);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const positional = args.filter((arg) => arg !== '--force');
  if (positional.length !== 1 || positional[0] === '--help' || positional[0] === '-h') {
    printUsage();
    process.exit(positional.length === 1 ? 0 : 64);
    return;
  }
  const target = positional[0];
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

  const outputPath = absolute.endsWith('.enc')
    ? absolute.slice(0, -'.enc'.length)
    : `${absolute}.dec`;
  if (existsSync(outputPath) && !force) {
    console.error(
      `Refusing to overwrite ${outputPath}. Pass --force to overwrite.`,
    );
    process.exit(1);
    return;
  }

  const input = createReadStream(absolute);
  const output = createWriteStream(outputPath, { mode: 0o600 });

  try {
    await pipeStreams(svc, input, output);
    console.log(`Decrypted: ${absolute} -> ${outputPath}`);
  } catch (err) {
    console.error(`Decryption failed: ${(err as Error).message}`);
    process.exit(1);
  }
}

async function pipeStreams(
  svc: BackupEncryptionService,
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
): Promise<void> {
  return new Promise((resolveStream, rejectStream) => {
    const decipher = svc.decryptStream(input as never);
    decipher.on('error', rejectStream);
    output.on('error', rejectStream);
    output.on('finish', resolveStream);
    decipher.pipe(output);
  });
}

function printUsage(): void {
  console.log(`Usage: backup-decrypt.ts [--force] <input.enc | ->
  Reads <input.enc> (or stdin when '-') and writes plaintext to
  <input> (with the '.enc' suffix stripped) or stdout. Requires
  BACKUP_ENCRYPTION_KEY to be set to a base64-encoded 32-byte key.

  Pass --force to overwrite an existing plaintext output.`);
}

void main();
