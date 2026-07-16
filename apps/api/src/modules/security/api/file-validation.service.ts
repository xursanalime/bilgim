import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Magic bytes signatures for common file types.
 * Used to validate that the actual file content matches the declared content-type.
 */
export interface MagicBytesSignature {
  /** MIME type this signature identifies. */
  mimeType: string;
  /** Byte offset where the signature starts. */
  offset: number;
  /** Expected bytes at the offset (as hex string). */
  bytes: string;
  /** Human-readable file type name. */
  description: string;
}

/**
 * Known magic bytes signatures for allowed file types (Req 30.10).
 */
export const MAGIC_BYTES_SIGNATURES: ReadonlyArray<MagicBytesSignature> = [
  // Images
  { mimeType: 'image/jpeg', offset: 0, bytes: 'ffd8ff', description: 'JPEG' },
  { mimeType: 'image/png', offset: 0, bytes: '89504e47', description: 'PNG' },
  { mimeType: 'image/gif', offset: 0, bytes: '474946', description: 'GIF' },
  { mimeType: 'image/webp', offset: 8, bytes: '57454250', description: 'WebP' },
  { mimeType: 'image/bmp', offset: 0, bytes: '424d', description: 'BMP' },
  { mimeType: 'image/svg+xml', offset: 0, bytes: '3c737667', description: 'SVG' },

  // Documents
  { mimeType: 'application/pdf', offset: 0, bytes: '25504446', description: 'PDF' },
  // DOCX/XLSX/PPTX are ZIP-based (PK signature)
  {
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    offset: 0,
    bytes: '504b0304',
    description: 'DOCX (ZIP)',
  },
  {
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    offset: 0,
    bytes: '504b0304',
    description: 'XLSX (ZIP)',
  },

  // Audio
  { mimeType: 'audio/mpeg', offset: 0, bytes: '494433', description: 'MP3 (ID3)' },
  { mimeType: 'audio/mpeg', offset: 0, bytes: 'fffb', description: 'MP3 (sync)' },
  { mimeType: 'audio/mpeg', offset: 0, bytes: 'fff3', description: 'MP3 (sync)' },
  { mimeType: 'audio/wav', offset: 0, bytes: '52494646', description: 'WAV (RIFF)' },
  { mimeType: 'audio/ogg', offset: 0, bytes: '4f676753', description: 'OGG' },
  { mimeType: 'audio/flac', offset: 0, bytes: '664c6143', description: 'FLAC' },

  // Video
  { mimeType: 'video/mp4', offset: 4, bytes: '66747970', description: 'MP4 (ftyp)' },
  { mimeType: 'video/webm', offset: 0, bytes: '1a45dfa3', description: 'WebM (EBML)' },
  { mimeType: 'video/x-matroska', offset: 0, bytes: '1a45dfa3', description: 'MKV (EBML)' },
  { mimeType: 'video/avi', offset: 0, bytes: '52494646', description: 'AVI (RIFF)' },
];

/**
 * Allowed MIME types for file uploads (Req 8.7 + Req 30.10).
 */
export const ALLOWED_MIME_TYPES: ReadonlyArray<string> = [
  // Images
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/svg+xml',
  // Documents
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  // Audio
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/flac',
  'audio/mp4',
  // Video
  'video/mp4',
  'video/webm',
  'video/x-matroska',
  'video/avi',
  'video/quicktime',
];

/**
 * Result of file content-type validation.
 */
export interface FileValidationResult {
  valid: boolean;
  declaredType: string;
  detectedType: string | null;
  reason?: string;
}

/**
 * Result of ClamAV antivirus scan.
 */
export interface AntivirusScanResult {
  clean: boolean;
  /** Virus name if detected. */
  virusName?: string;
  /** Scan duration in milliseconds. */
  scanDurationMs: number;
  /** Scanner used. */
  scanner: 'clamav';
}

/**
 * Interface for ClamAV client adapter.
 * Allows swapping implementations (real ClamAV, mock, cloud-based).
 */
export interface ClamAvClient {
  /**
   * Scan a file buffer for viruses.
   * @param buffer - File content to scan
   * @returns Scan result
   */
  scanBuffer(buffer: Buffer): Promise<AntivirusScanResult>;

  /**
   * Scan a file at a given path.
   * @param filePath - Path to the file to scan
   * @returns Scan result
   */
  scanFile(filePath: string): Promise<AntivirusScanResult>;

  /**
   * Check if ClamAV daemon is available and responsive.
   */
  ping(): Promise<boolean>;
}

/** DI token for ClamAV client injection. */
export const CLAMAV_CLIENT_TOKEN = Symbol('CLAMAV_CLIENT');

/**
 * `FileValidationService` — validates file uploads via magic bytes
 * content-type verification and ClamAV antivirus scanning
 * (Task 29.5, Req 30.10).
 *
 * Two-layer validation:
 *   1. **Magic bytes check**: Reads the first N bytes of the file and
 *      compares against known signatures to verify the declared
 *      content-type matches the actual file content.
 *   2. **Antivirus scan**: Sends the file to ClamAV daemon for
 *      malware detection.
 *
 * Both checks must pass for a file to be accepted.
 */
@Injectable()
export class FileValidationService {
  private readonly logger = new Logger(FileValidationService.name);
  private readonly clamAvEnabled: boolean;

  constructor(
    private readonly config: ConfigService,
    private readonly clamAvClient?: ClamAvClient,
  ) {
    this.clamAvEnabled =
      this.config.get<string>('CLAMAV_ENABLED') !== 'false' &&
      !!this.clamAvClient;
  }

  /**
   * Validate file content-type by checking magic bytes.
   *
   * @param buffer - File content (at least first 16 bytes needed)
   * @param declaredMimeType - The MIME type declared by the client
   * @returns Validation result
   */
  validateContentType(
    buffer: Buffer,
    declaredMimeType: string,
  ): FileValidationResult {
    // Check if declared type is in allowed list
    if (!ALLOWED_MIME_TYPES.includes(declaredMimeType)) {
      return {
        valid: false,
        declaredType: declaredMimeType,
        detectedType: null,
        reason: `MIME type '${declaredMimeType}' is not allowed`,
      };
    }

    // Detect actual type from magic bytes
    const detectedType = this.detectMimeType(buffer);

    if (!detectedType) {
      // Could not detect type from magic bytes — reject for safety
      return {
        valid: false,
        declaredType: declaredMimeType,
        detectedType: null,
        reason: 'Could not determine file type from content',
      };
    }

    // Check if detected type matches declared type
    if (!this.mimeTypesMatch(declaredMimeType, detectedType)) {
      return {
        valid: false,
        declaredType: declaredMimeType,
        detectedType,
        reason: `Content-type mismatch: declared '${declaredMimeType}' but detected '${detectedType}'`,
      };
    }

    return {
      valid: true,
      declaredType: declaredMimeType,
      detectedType,
    };
  }

  /**
   * Scan a file buffer for viruses using ClamAV.
   *
   * @param buffer - File content to scan
   * @returns Scan result, or a clean result if ClamAV is disabled
   */
  async scanForViruses(buffer: Buffer): Promise<AntivirusScanResult> {
    if (!this.clamAvEnabled || !this.clamAvClient) {
      this.logger.warn('ClamAV scanning is disabled — skipping virus scan');
      return {
        clean: true,
        scanDurationMs: 0,
        scanner: 'clamav',
      };
    }

    try {
      return await this.clamAvClient.scanBuffer(buffer);
    } catch (error) {
      this.logger.error(
        'ClamAV scan failed',
        error instanceof Error ? error.message : String(error),
      );
      // Fail-closed: if scan fails, reject the file
      return {
        clean: false,
        virusName: 'SCAN_FAILED',
        scanDurationMs: 0,
        scanner: 'clamav',
      };
    }
  }

  /**
   * Full file validation: content-type check + antivirus scan.
   *
   * @param buffer - File content
   * @param declaredMimeType - Declared MIME type
   * @returns Combined validation result
   */
  async validateFile(
    buffer: Buffer,
    declaredMimeType: string,
  ): Promise<{
    contentTypeValid: FileValidationResult;
    antivirusScan: AntivirusScanResult;
    accepted: boolean;
  }> {
    const contentTypeValid = this.validateContentType(buffer, declaredMimeType);

    // If content-type validation fails, skip virus scan
    if (!contentTypeValid.valid) {
      return {
        contentTypeValid,
        antivirusScan: { clean: true, scanDurationMs: 0, scanner: 'clamav' },
        accepted: false,
      };
    }

    const antivirusScan = await this.scanForViruses(buffer);

    return {
      contentTypeValid,
      antivirusScan,
      accepted: contentTypeValid.valid && antivirusScan.clean,
    };
  }

  /**
   * Detect MIME type from file buffer using magic bytes.
   */
  detectMimeType(buffer: Buffer): string | null {
    if (buffer.length < 4) return null;

    for (const sig of MAGIC_BYTES_SIGNATURES) {
      const sigBytes = Buffer.from(sig.bytes, 'hex');
      if (buffer.length < sig.offset + sigBytes.length) continue;

      const slice = buffer.subarray(sig.offset, sig.offset + sigBytes.length);
      if (slice.equals(sigBytes)) {
        return sig.mimeType;
      }
    }

    // Special case: SVG files may start with XML declaration or whitespace
    const head = buffer.subarray(0, Math.min(256, buffer.length)).toString('utf8').trim();
    if (head.startsWith('<?xml') && head.includes('<svg')) {
      return 'image/svg+xml';
    }
    if (head.startsWith('<svg')) {
      return 'image/svg+xml';
    }

    return null;
  }

  /**
   * Check if two MIME types are compatible.
   * Handles cases like ZIP-based formats (DOCX, XLSX) which share
   * the same magic bytes.
   */
  private mimeTypesMatch(declared: string, detected: string): boolean {
    if (declared === detected) return true;

    // ZIP-based Office formats all have PK magic bytes
    const zipBasedTypes = [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/zip',
    ];
    if (zipBasedTypes.includes(declared) && zipBasedTypes.includes(detected)) {
      return true;
    }

    // RIFF-based formats (WAV, AVI) share the same header
    const riffBasedTypes = ['audio/wav', 'video/avi'];
    if (riffBasedTypes.includes(declared) && riffBasedTypes.includes(detected)) {
      return true;
    }

    // EBML-based formats (WebM, MKV)
    const ebmlBasedTypes = ['video/webm', 'video/x-matroska'];
    if (ebmlBasedTypes.includes(declared) && ebmlBasedTypes.includes(detected)) {
      return true;
    }

    // MP3 variants
    if (declared === 'audio/mpeg' && detected === 'audio/mpeg') return true;

    return false;
  }
}
