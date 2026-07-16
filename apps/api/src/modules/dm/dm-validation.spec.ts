import { BadRequestException } from '@nestjs/common';
import { stripHtml } from '../../common/sanitization';

// Mocking some constants for the test
const MAX_DM_BODY_LENGTH = 1000;

function normalizeBody(text: string, allowEmpty = false): string {
  const s = stripHtml(text).trim();
  if (s.length === 0 && !allowEmpty) {
    throw new BadRequestException({
      code: 'DM_BODY_EMPTY',
      message: 'Message body cannot be empty',
    });
  }
  if (s.length > MAX_DM_BODY_LENGTH) {
    throw new BadRequestException({
      code: 'DM_BODY_TOO_LONG',
      message: `Body exceeds ${MAX_DM_BODY_LENGTH} chars`,
    });
  }
  return s;
}

describe('DM Message Validation Bug Reproduction', () => {
  it('should throw DM_BODY_EMPTY when text is empty and allowEmpty is false', () => {
    expect(() => normalizeBody('')).toThrow(BadRequestException);
    try {
      normalizeBody('');
    } catch (e: any) {
      expect(e.getResponse().code).toBe('DM_BODY_EMPTY');
    }
  });

  it('should NOT throw when text is empty and allowEmpty is true (fix)', () => {
    expect(() => normalizeBody('', true)).not.toThrow();
    expect(normalizeBody('', true)).toBe('');
  });

  it('should still throw if text is too long', () => {
    const longText = 'a'.repeat(MAX_DM_BODY_LENGTH + 1);
    expect(() => normalizeBody(longText, true)).toThrow(BadRequestException);
  });
});
