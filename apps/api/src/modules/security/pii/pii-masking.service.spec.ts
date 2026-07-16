import { PiiMaskingService } from './pii-masking.service';
import fc from 'fast-check';

describe('PiiMaskingService', () => {
  let service: PiiMaskingService;

  beforeEach(() => {
    service = new PiiMaskingService();
  });

  describe('mask()', () => {
    it('Property 20: masks any generated email address', () => {
      fc.assert(
        fc.property(fc.emailAddress(), (email: string) => {
          const masked = service.mask(email);
          // Standard mask for email: u***@e***.com
          expect(masked).not.toBe(email);
          expect(masked).toContain('***');
          expect(masked).toContain('@');
        }),
      );
    });

    describe('email masking', () => {
      it('should mask a standard email address', () => {
        const result = service.mask('Contact user@example.com for info');
        expect(result).toBe('Contact u***@e***.com for info');
      });

      it('should mask multiple emails in the same string', () => {
        const result = service.mask(
          'From alice@gmail.com to bob@yahoo.org',
        );
        expect(result).toContain('a***@g***.com');
        expect(result).toContain('b***@y***.org');
      });

      it('should handle single-char local part', () => {
        const result = service.mask('a@b.co');
        expect(result).toBe('a***@b***.co');
      });
    });

    describe('phone masking', () => {
      it('should mask an Uzbek phone number', () => {
        const result = service.mask('Call +998901234567 now');
        expect(result).toBe('Call ***4567 now');
      });

      it('should mask a US-format phone number', () => {
        const result = service.mask('Phone: +1-555-123-4567');
        expect(result).toBe('Phone: ***4567');
      });

      it('should not mask short number sequences (port numbers, etc.)', () => {
        const result = service.mask('Port 8080');
        expect(result).toBe('Port 8080');
      });
    });

    describe('IP masking', () => {
      it('should mask an IPv4 address', () => {
        const result = service.mask('Client IP: 192.168.1.100');
        expect(result).toBe('Client IP: 192.168.*.*');
      });

      it('should mask an IPv6 address', () => {
        const result = service.mask(
          'From 2001:0db8:85a3:0000:0000:8a2e:0370:7334',
        );
        expect(result).toContain('2001:0db8:****');
      });

      it('should mask multiple IPs', () => {
        const result = service.mask('10.0.0.1 → 172.16.0.1');
        expect(result).toContain('10.0.*.*');
        expect(result).toContain('172.16.*.*');
      });
    });

    describe('card number masking', () => {
      it('should mask a 16-digit card number', () => {
        const result = service.mask('Card: 4111111111111111');
        expect(result).toBe('Card: ****1111');
      });

      it('should mask a card number with spaces', () => {
        const result = service.mask('Card: 4111 1111 1111 1111');
        expect(result).toBe('Card: ****1111');
      });

      it('should mask a card number with dashes', () => {
        const result = service.mask('Card: 4111-1111-1111-1111');
        expect(result).toBe('Card: ****1111');
      });
    });

    describe('mixed PII', () => {
      it('should mask multiple PII types in one string', () => {
        const input =
          'User user@test.com from 10.0.0.1 called +998901234567';
        const result = service.mask(input);
        expect(result).toContain('u***@t***.com');
        expect(result).toContain('10.0.*.*');
        expect(result).toContain('***4567');
      });

      it('should handle empty string', () => {
        expect(service.mask('')).toBe('');
      });

      it('should handle null/undefined gracefully', () => {
        expect(service.mask(null as unknown as string)).toBe(null);
        expect(service.mask(undefined as unknown as string)).toBe(undefined);
      });

      it('should handle string with no PII', () => {
        const input = 'Hello world, this is a normal message';
        expect(service.mask(input)).toBe(input);
      });
    });
  });

  describe('detect()', () => {
    it('should detect email addresses', () => {
      const matches = service.detect('Contact admin@example.com');
      expect(matches).toHaveLength(1);
      expect(matches[0]).toEqual({
        original: 'admin@example.com',
        type: 'email',
        masked: 'a***@e***.com',
      });
    });

    it('should detect multiple PII types', () => {
      const matches = service.detect(
        'User test@mail.com from 192.168.1.1',
      );
      expect(matches.length).toBeGreaterThanOrEqual(2);
      const types = matches.map((m) => m.type);
      expect(types).toContain('email');
      expect(types).toContain('ip');
    });

    it('should return empty array for no PII', () => {
      const matches = service.detect('No PII here');
      expect(matches).toHaveLength(0);
    });
  });

  describe('maskValue()', () => {
    it('should mask email by type', () => {
      expect(service.maskValue('test@example.com', 'email')).toBe(
        't***@e***.com',
      );
    });

    it('should mask phone by type', () => {
      expect(service.maskValue('+998901234567', 'phone')).toBe('***4567');
    });

    it('should mask IP by type', () => {
      expect(service.maskValue('192.168.1.1', 'ip')).toBe('192.168.*.*');
    });

    it('should mask card by type', () => {
      expect(service.maskValue('4111111111111111', 'card')).toBe(
        '****1111',
      );
    });
  });

  describe('configuration', () => {
    it('should only mask enabled types', () => {
      const emailOnly = new PiiMaskingService({
        enabledTypes: ['email'],
      });
      const input = 'user@test.com from 192.168.1.1';
      const result = emailOnly.mask(input);
      expect(result).toContain('u***@t***.com');
      // IP should NOT be masked
      expect(result).toContain('192.168.1.1');
    });

    it('should mask nothing when no types enabled', () => {
      const noMask = new PiiMaskingService({ enabledTypes: [] });
      const input = 'user@test.com 192.168.1.1 +998901234567';
      expect(noMask.mask(input)).toBe(input);
    });
  });
});
