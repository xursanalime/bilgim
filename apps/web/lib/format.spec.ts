import {
  APP_TIME_ZONE,
  formatDate,
  formatDateTime,
  formatNumber,
  formatUzs,
  localeToBcp47,
  localizedField,
  localizedName,
} from './format';

describe('lib/format', () => {
  describe('localeToBcp47', () => {
    it('maps app locales to BCP-47 tags', () => {
      expect(localeToBcp47('uz')).toBe('uz-UZ');
      expect(localeToBcp47('ru')).toBe('ru-RU');
      expect(localeToBcp47('en')).toBe('en-US');
    });

    it('falls back to uz-UZ for an unknown locale', () => {
      expect(localeToBcp47('fr')).toBe('uz-UZ');
    });
  });

  describe('formatNumber', () => {
    it('groups thousands without fractional digits', () => {
      // Separator char varies by locale/runtime; assert on the digits.
      expect(formatNumber(1234567, 'uz')).toMatch(/^1.?234.?567$/);
    });
  });

  describe('formatUzs', () => {
    it("appends the uz suffix (so'm) by default", () => {
      expect(formatUzs(150000, 'uz')).toMatch(/150.?000 so'm$/);
    });

    it('uses the ru suffix (сум) for the ru locale', () => {
      expect(formatUzs(50000, 'ru')).toMatch(/сум$/);
    });

    it('uses the en suffix (UZS) for the en locale', () => {
      expect(formatUzs(50000, 'en')).toMatch(/UZS$/);
    });

    it('falls back to the uz suffix for an unknown locale', () => {
      expect(formatUzs(50000, 'xx')).toMatch(/so'm$/);
    });
  });

  describe('formatDate', () => {
    const iso = '2025-01-15T09:30:00.000Z';

    it('formats a date for the uz locale', () => {
      const out = formatDate(iso, 'uz');
      expect(out).toContain('2025');
      expect(out).toContain('15');
    });

    it('returns an em dash for null/invalid input', () => {
      expect(formatDate(null, 'uz')).toBe('—');
      expect(formatDate(undefined, 'uz')).toBe('—');
      expect(formatDate('not-a-date', 'uz')).toBe('—');
    });

    it('accepts Date and epoch-millis inputs', () => {
      expect(formatDate(new Date(iso), 'en')).toContain('2025');
      expect(formatDate(Date.parse(iso), 'en')).toContain('2025');
    });

    it('honors override options', () => {
      const out = formatDate(iso, 'en', {
        year: 'numeric',
        month: 'short',
        day: undefined,
      });
      expect(out).toContain('2025');
    });
  });

  describe('formatDateTime', () => {
    it('renders the Asia/Tashkent wall-clock time', () => {
      // 09:30 UTC is 14:30 in Asia/Tashkent (UTC+5). ru uses a 24h clock.
      const out = formatDateTime('2025-01-15T09:30:00.000Z', 'ru');
      expect(out).toContain('14:30');
    });

    it('returns an em dash for invalid input', () => {
      expect(formatDateTime(null, 'ru')).toBe('—');
    });
  });

  describe('localizedName', () => {
    const entity = { nameUz: 'Matematika', nameRu: 'Математика', nameEn: 'Mathematics' };

    it('picks the field matching the active locale', () => {
      expect(localizedName(entity, 'uz')).toBe('Matematika');
      expect(localizedName(entity, 'ru')).toBe('Математика');
      expect(localizedName(entity, 'en')).toBe('Mathematics');
    });

    it('falls back uz → ru → en when the preferred field is missing', () => {
      expect(localizedName({ nameUz: 'Faqat UZ' }, 'en')).toBe('Faqat UZ');
      expect(localizedName({ nameRu: 'Только RU' }, 'en')).toBe('Только RU');
      expect(localizedName({ nameEn: 'Only EN' }, 'uz')).toBe('Only EN');
    });

    it('returns an empty string when all fields are missing', () => {
      expect(localizedName({}, 'uz')).toBe('');
      expect(localizedName({ nameUz: null, nameRu: null, nameEn: null }, 'ru')).toBe('');
    });
  });

  describe('localizedField', () => {
    const page = { titleUz: 'Bosh sahifa', titleRu: 'Главная', titleEn: 'Home' };

    it('picks the suffixed field matching the active locale', () => {
      expect(localizedField(page, 'title', 'ru')).toBe('Главная');
      expect(localizedField(page, 'title', 'en')).toBe('Home');
    });

    it('falls back when the preferred translation is missing', () => {
      expect(localizedField({ titleUz: 'Sarlavha' }, 'title', 'en')).toBe('Sarlavha');
    });
  });

  it('exposes the Asia/Tashkent timezone constant', () => {
    expect(APP_TIME_ZONE).toBe('Asia/Tashkent');
  });
});
