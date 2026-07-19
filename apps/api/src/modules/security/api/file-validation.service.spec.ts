import { ConfigService } from '@nestjs/config';

import {
  ALLOWED_MIME_TYPES,
  AntivirusScanResult,
  ClamAvClient,
  FileValidationService,
  MAGIC_BYTES_SIGNATURES,
} from './file-validation.service';

/**
 * Unit tests for `FileValidationService` (Task 29.5, Req 30.10).
 *
 * Covers:
 *   - Magic bytes content-type validation for various file types.
 *   - Rejection of mismatched content-type declarations.
 *   - Rejection of disallowed MIME types.
 *   - ClamAV integration (clean files, infected files, scan failures).
 *   - Full validation pipeline (content-type + antivirus).
 */

function makeConfigService(overrides: Record<string, string> = {}): ConfigService {
  return {
    get: jest.fn((key: string) => overrides[key] ?? undefined),
  } as unknown as ConfigService;
}

function makeClamAvClient(
  result: Partial<AntivirusScanResult> = { clean: true, scanDurationMs: 5 },
): jest.Mocked<ClamAvClient> {
  return {
    scanBuffer: jest.fn().mockResolvedValue({
      clean: true,
      scanDurationMs: 5,
      scanner: 'clamav',
      ...result,
    }),
    scanFile: jest.fn().mockResolvedValue({
      clean: true,
      scanDurationMs: 5,
      scanner: 'clamav',
      ...result,
    }),
    ping: jest.fn().mockResolvedValue(true),
  };
}

// Helper to create buffers with specific magic bytes
function makeJpegBuffer(): Buffer {
  const buf = Buffer.alloc(16);
  buf.write('ffd8ffe0', 0, 'hex'); // JPEG magic bytes
  return buf;
}

function makePngBuffer(): Buffer {
  const buf = Buffer.alloc(16);
  buf.write('89504e47', 0, 'hex'); // PNG magic bytes
  return buf;
}

function makePdfBuffer(): Buffer {
  const buf = Buffer.alloc(16);
  buf.write('25504446', 0, 'hex'); // %PDF
  return buf;
}

function makeZipBuffer(): Buffer {
  const buf = Buffer.alloc(16);
  buf.write('504b0304', 0, 'hex'); // PK (ZIP)
  return buf;
}

function makeMp4Buffer(): Buffer {
  const buf = Buffer.alloc(16);
  buf.write('0000001866747970', 0, 'hex'); // ftyp at offset 4
  return buf;
}

function makeMp3Id3Buffer(): Buffer {
  const buf = Buffer.alloc(16);
  buf.write('494433', 0, 'hex'); // ID3
  return buf;
}

describe('FileValidationService — content-type validation', () => {
  let service: FileValidationService;

  beforeEach(() => {
    service = new FileValidationService(makeConfigService());
  });

  it('validates JPEG files correctly', () => {
    const result = service.validateContentType(makeJpegBuffer(), 'image/jpeg');
    expect(result.valid).toBe(true);
    expect(result.detectedType).toBe('image/jpeg');
  });

  it('validates PNG files correctly', () => {
    const result = service.validateContentType(makePngBuffer(), 'image/png');
    expect(result.valid).toBe(true);
    expect(result.detectedType).toBe('image/png');
  });

  it('validates PDF files correctly', () => {
    const result = service.validateContentType(makePdfBuffer(), 'application/pdf');
    expect(result.valid).toBe(true);
    expect(result.detectedType).toBe('application/pdf');
  });

  it('validates DOCX files (ZIP-based) correctly', () => {
    const result = service.validateContentType(
      makeZipBuffer(),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(result.valid).toBe(true);
  });

  it('validates XLSX files (ZIP-based) correctly', () => {
    const result = service.validateContentType(
      makeZipBuffer(),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(result.valid).toBe(true);
  });

  it('validates MP4 files correctly (ftyp at offset 4)', () => {
    const result = service.validateContentType(makeMp4Buffer(), 'video/mp4');
    expect(result.valid).toBe(true);
    expect(result.detectedType).toBe('video/mp4');
  });

  it('validates MP3 files with ID3 header', () => {
    const result = service.validateContentType(makeMp3Id3Buffer(), 'audio/mpeg');
    expect(result.valid).toBe(true);
    expect(result.detectedType).toBe('audio/mpeg');
  });

  it('rejects content-type mismatch (PNG declared as JPEG)', () => {
    const result = service.validateContentType(makePngBuffer(), 'image/jpeg');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('mismatch');
    expect(result.detectedType).toBe('image/png');
  });

  it('rejects disallowed MIME types', () => {
    const result = service.validateContentType(
      Buffer.alloc(16),
      'application/x-executable',
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('not allowed');
  });

  it('rejects files with unrecognizable magic bytes', () => {
    const randomBuffer = Buffer.from('0000000000000000', 'hex');
    const result = service.validateContentType(randomBuffer, 'image/jpeg');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Could not determine');
  });

  it('rejects buffers that are too small', () => {
    const tinyBuffer = Buffer.alloc(2);
    const result = service.validateContentType(tinyBuffer, 'image/jpeg');
    expect(result.valid).toBe(false);
  });
});

describe('FileValidationService — SVG detection', () => {
  let service: FileValidationService;

  beforeEach(() => {
    service = new FileValidationService(makeConfigService());
  });

  it('detects SVG files starting with <svg', () => {
    const svgContent = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
    const buffer = Buffer.from(svgContent, 'utf8');
    const result = service.validateContentType(buffer, 'image/svg+xml');
    expect(result.valid).toBe(true);
    expect(result.detectedType).toBe('image/svg+xml');
  });

  it('detects SVG files with XML declaration', () => {
    const svgContent = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>';
    const buffer = Buffer.from(svgContent, 'utf8');
    const result = service.validateContentType(buffer, 'image/svg+xml');
    expect(result.valid).toBe(true);
    expect(result.detectedType).toBe('image/svg+xml');
  });
});

describe('FileValidationService — ClamAV scanning', () => {
  it('returns clean result when file is safe', async () => {
    const clamAv = makeClamAvClient({ clean: true });
    const service = new FileValidationService(makeConfigService(), clamAv);

    const result = await service.scanForViruses(makeJpegBuffer());

    expect(result.clean).toBe(true);
    expect(result.scanner).toBe('clamav');
    expect(clamAv.scanBuffer).toHaveBeenCalledWith(makeJpegBuffer());
  });

  it('returns infected result when virus detected', async () => {
    const clamAv = makeClamAvClient({
      clean: false,
      virusName: 'Eicar-Test-Signature',
      scanDurationMs: 12,
    });
    const service = new FileValidationService(makeConfigService(), clamAv);

    const result = await service.scanForViruses(makeJpegBuffer());

    expect(result.clean).toBe(false);
    expect(result.virusName).toBe('Eicar-Test-Signature');
  });

  it('fails closed when ClamAV throws an error', async () => {
    const clamAv = makeClamAvClient();
    clamAv.scanBuffer.mockRejectedValue(new Error('Connection refused'));
    const service = new FileValidationService(makeConfigService(), clamAv);

    const result = await service.scanForViruses(makeJpegBuffer());

    expect(result.clean).toBe(false);
    expect(result.virusName).toBe('SCAN_FAILED');
  });

  it('skips scan when ClamAV is disabled', async () => {
    const service = new FileValidationService(
      makeConfigService({ CLAMAV_ENABLED: 'false' }),
    );

    const result = await service.scanForViruses(makeJpegBuffer());

    expect(result.clean).toBe(true);
    expect(result.scanDurationMs).toBe(0);
  });

  it('skips scan when no ClamAV client is provided', async () => {
    const service = new FileValidationService(makeConfigService());

    const result = await service.scanForViruses(makeJpegBuffer());

    expect(result.clean).toBe(true);
  });
});

describe('FileValidationService — full validation pipeline', () => {
  it('accepts valid file with clean scan', async () => {
    const clamAv = makeClamAvClient({ clean: true });
    const service = new FileValidationService(makeConfigService(), clamAv);

    const result = await service.validateFile(makeJpegBuffer(), 'image/jpeg');

    expect(result.accepted).toBe(true);
    expect(result.contentTypeValid.valid).toBe(true);
    expect(result.antivirusScan.clean).toBe(true);
  });

  it('rejects file with invalid content-type (skips virus scan)', async () => {
    const clamAv = makeClamAvClient();
    const service = new FileValidationService(makeConfigService(), clamAv);

    const result = await service.validateFile(makePngBuffer(), 'image/jpeg');

    expect(result.accepted).toBe(false);
    expect(result.contentTypeValid.valid).toBe(false);
    // Virus scan should not be called when content-type fails
    expect(clamAv.scanBuffer).not.toHaveBeenCalled();
  });

  it('rejects file with virus detected', async () => {
    const clamAv = makeClamAvClient({
      clean: false,
      virusName: 'Trojan.Generic',
    });
    const service = new FileValidationService(makeConfigService(), clamAv);

    const result = await service.validateFile(makeJpegBuffer(), 'image/jpeg');

    expect(result.accepted).toBe(false);
    expect(result.contentTypeValid.valid).toBe(true);
    expect(result.antivirusScan.clean).toBe(false);
  });
});

describe('FileValidationService — detectMimeType', () => {
  let service: FileValidationService;

  beforeEach(() => {
    service = new FileValidationService(makeConfigService());
  });

  it('returns null for empty buffer', () => {
    expect(service.detectMimeType(Buffer.alloc(0))).toBeNull();
  });

  it('returns null for buffer smaller than 4 bytes', () => {
    expect(service.detectMimeType(Buffer.alloc(3))).toBeNull();
  });

  it('detects JPEG from magic bytes', () => {
    expect(service.detectMimeType(makeJpegBuffer())).toBe('image/jpeg');
  });

  it('detects PNG from magic bytes', () => {
    expect(service.detectMimeType(makePngBuffer())).toBe('image/png');
  });

  it('detects PDF from magic bytes', () => {
    expect(service.detectMimeType(makePdfBuffer())).toBe('application/pdf');
  });
});

describe('FileValidationService — constants', () => {
  it('ALLOWED_MIME_TYPES includes required types', () => {
    expect(ALLOWED_MIME_TYPES).toContain('image/jpeg');
    expect(ALLOWED_MIME_TYPES).toContain('image/png');
    expect(ALLOWED_MIME_TYPES).toContain('application/pdf');
    expect(ALLOWED_MIME_TYPES).toContain('video/mp4');
    expect(ALLOWED_MIME_TYPES).toContain('audio/mpeg');
    expect(ALLOWED_MIME_TYPES).toContain(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(ALLOWED_MIME_TYPES).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });

  it('MAGIC_BYTES_SIGNATURES has entries for all major types', () => {
    const mimeTypes = MAGIC_BYTES_SIGNATURES.map((s) => s.mimeType);
    expect(mimeTypes).toContain('image/jpeg');
    expect(mimeTypes).toContain('image/png');
    expect(mimeTypes).toContain('application/pdf');
    expect(mimeTypes).toContain('video/mp4');
    expect(mimeTypes).toContain('audio/mpeg');
  });
});
