import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Smoke tests for `apps/api/scripts/backup-encrypt.ts` and
 * `backup-decrypt.ts` (Task 28.4, Req 28.8).
 *
 * Spawns the scripts via `ts-node` (the same runtime the cron uses
 * via Node's `--loader=ts-node/esm` shim or `tsx`). We deliberately
 * exercise the CLI path end-to-end so a regression in argv parsing,
 * stdout/stderr handling, or the file-not-found path surfaces here
 * instead of at deploy time.
 *
 * The tests are skipped automatically on a runner without `ts-node`
 * (e.g. minimal CI images without dev deps).
 */

const KEY = randomBytes(32).toString('base64');
const ENCRYPT_SCRIPT = join(__dirname, 'backup-encrypt.ts');
const DECRYPT_SCRIPT = join(__dirname, 'backup-decrypt.ts');

function runScript(
  scriptPath: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  input?: Buffer,
): { stdout: Buffer; stderr: string; status: number | null } {
  const result = spawnSync(
    process.execPath,
    ['-r', 'ts-node/register/transpile-only', scriptPath, ...args],
    {
      input: input ?? undefined,
      env: { ...process.env, ...env, TS_NODE_TRANSPILE_ONLY: 'true' },
      encoding: 'buffer',
    },
  );
  return {
    stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout ?? ''),
    stderr: result.stderr?.toString('utf8') ?? '',
    status: result.status,
  };
}

const itIfTsNode =
  (() => {
    try {
      require.resolve('ts-node');
      return true;
    } catch {
      return false;
    }
  })()
    ? it
    : it.skip;

describe('backup CLI scripts', () => {
  itIfTsNode('round-trips a file end-to-end', () => {
    const dir = mkdtempSync(join(tmpdir(), 'edubridge-backup-'));
    const plaintextPath = join(dir, 'sample.sql');
    const original = Buffer.from(
      'CREATE TABLE users (id UUID PRIMARY KEY); INSERT INTO users VALUES (gen_random_uuid());\n',
    );
    writeFileSync(plaintextPath, original);

    const enc = runScript(ENCRYPT_SCRIPT, [plaintextPath], {
      BACKUP_ENCRYPTION_KEY: KEY,
    });
    expect(enc.status).toBe(0);
    expect(existsSync(`${plaintextPath}.enc`)).toBe(true);

    // Remove the original to make sure decrypt overwrite logic
    // doesn't clobber valuable plaintext.
    writeFileSync(plaintextPath, Buffer.from(''));

    const dec = runScript(
      DECRYPT_SCRIPT,
      [`${plaintextPath}.enc`, '--force'],
      {
        BACKUP_ENCRYPTION_KEY: KEY,
      },
    );
    expect(dec.status).toBe(0);

    const restored = readFileSync(plaintextPath);
    expect(restored.equals(original)).toBe(true);
  });

  itIfTsNode('round-trips through stdin/stdout', () => {
    const original = Buffer.from('hello-stdio');

    const enc = runScript(
      ENCRYPT_SCRIPT,
      ['-'],
      { BACKUP_ENCRYPTION_KEY: KEY },
      original,
    );
    expect(enc.status).toBe(0);

    const dec = runScript(
      DECRYPT_SCRIPT,
      ['-'],
      { BACKUP_ENCRYPTION_KEY: KEY },
      enc.stdout,
    );
    expect(dec.status).toBe(0);
    expect(dec.stdout.toString('utf8')).toBe('hello-stdio');
  });

  itIfTsNode('fails fast when BACKUP_ENCRYPTION_KEY is missing', () => {
    const result = runScript(ENCRYPT_SCRIPT, ['-'], {
      BACKUP_ENCRYPTION_KEY: '',
    }, Buffer.from('payload'));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/BACKUP_ENCRYPTION_KEY/);
  });
});
