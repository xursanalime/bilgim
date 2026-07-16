// ═════════════════════════════════════════════════════════════════
// System settings registry (admin → "Tizim Sozlamalari").
//
// The backend persists settings as generic key/value rows
// (`SystemSetting`, `GET/PUT /admin/system-settings`). To give admins a
// typed, no-JSON management surface, this registry declares the well-known
// platform settings: their key, control type, default value, and localized
// (Uzbek) labels/descriptions, grouped into sections.
//
// Keys not present in this registry (e.g. `english.module-catalog`, which is
// managed from the "Ingliz tili moduli" screen) are surfaced separately in an
// "advanced" list so nothing is hidden, but they are never editable as a
// typed field here.
// ═════════════════════════════════════════════════════════════════

export type SettingValue = string | number | boolean;

export type SettingFieldType = 'boolean' | 'number' | 'text' | 'select';

export interface SettingSelectOption {
  value: string;
  label: string;
}

export interface SettingField {
  /** The `SystemSetting.key` this field reads/writes. */
  key: string;
  /** Control type → which input is rendered. */
  type: SettingFieldType;
  /** Short, localized label (Uzbek). */
  label: string;
  /** Helper text describing what the setting does (Uzbek). */
  description: string;
  /** Default applied when the backend has no stored row yet. */
  defaultValue: SettingValue;
  /** Options for `type: 'select'`. */
  options?: SettingSelectOption[];
  /** Unit suffix shown after numeric inputs (e.g. "MB", "daqiqa"). */
  unit?: string;
  /** Optional bounds for numeric inputs. */
  min?: number;
  max?: number;
}

export interface SettingsSection {
  id: string;
  /** Localized section title (Uzbek). */
  title: string;
  /** Localized section subtitle (Uzbek). */
  description: string;
  fields: SettingField[];
}

/**
 * The canonical platform settings catalog. Adding a setting here makes it
 * appear as a typed control on the admin settings page and persists under
 * the declared `key`.
 */
export const SYSTEM_SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    id: 'general',
    title: 'Umumiy',
    description: 'Platformaning asosiy identifikatori va holati.',
    fields: [
      {
        key: 'platform.name',
        type: 'text',
        label: 'Platforma nomi',
        description: 'Sayt sarlavhasi va xatlarda ko‘rinadigan nom.',
        defaultValue: 'Bilgim',
      },
      {
        key: 'platform.support_email',
        type: 'text',
        label: 'Qo‘llab-quvvatlash email',
        description: 'Foydalanuvchilar murojaat qiladigan elektron pochta.',
        defaultValue: 'support@bilgim.uz',
      },
      {
        key: 'platform.default_locale',
        type: 'select',
        label: 'Standart til',
        description: 'Yangi foydalanuvchilar uchun boshlang‘ich til.',
        defaultValue: 'uz',
        options: [
          { value: 'uz', label: "O‘zbekcha" },
          { value: 'ru', label: 'Ruscha' },
          { value: 'en', label: 'Inglizcha' },
        ],
      },
      {
        key: 'platform.maintenance_mode',
        type: 'boolean',
        label: 'Texnik xizmat rejimi',
        description:
          'Yoqilganda foydalanuvchilarga texnik ishlar haqida xabar ko‘rsatiladi.',
        defaultValue: false,
      },
    ],
  },
  {
    id: 'auth',
    title: 'Ro‘yxatdan o‘tish va xavfsizlik',
    description: 'Hisob yaratish va kirish qoidalari.',
    fields: [
      {
        key: 'auth.registration_enabled',
        type: 'boolean',
        label: 'Ro‘yxatdan o‘tish ochiq',
        description: 'O‘chirilsa yangi foydalanuvchilar ro‘yxatdan o‘ta olmaydi.',
        defaultValue: true,
      },
      {
        key: 'auth.email_verification_required',
        type: 'boolean',
        label: 'Email tasdiqlash majburiy',
        description: 'Kirishdan oldin email manzilni tasdiqlash talab qilinadi.',
        defaultValue: true,
      },
      {
        key: 'auth.mfa_required_for_admins',
        type: 'boolean',
        label: 'Adminlar uchun 2 bosqichli kirish',
        description: 'Admin hisoblar uchun MFA (TOTP/WebAuthn) majburiy bo‘ladi.',
        defaultValue: false,
      },
      {
        key: 'auth.session_timeout_minutes',
        type: 'number',
        label: 'Sessiya muddati',
        description: 'Faolliksiz qancha vaqtdan keyin sessiya tugaydi.',
        defaultValue: 1440,
        unit: 'daqiqa',
        min: 15,
        max: 43200,
      },
    ],
  },
  {
    id: 'media',
    title: 'Media va kontent',
    description: 'Video/fayl yuklash va himoya sozlamalari.',
    fields: [
      {
        key: 'media.max_upload_mb',
        type: 'number',
        label: 'Maksimal yuklash hajmi',
        description: 'Bitta fayl uchun ruxsat etilgan eng katta hajm.',
        defaultValue: 500,
        unit: 'MB',
        min: 1,
        max: 10240,
      },
      {
        key: 'media.transcoding_enabled',
        type: 'boolean',
        label: 'Video transkodlash',
        description:
          'Yoqilganda yuklangan videolar HLS formatiga o‘giriladi (ffmpeg talab qilinadi).',
        defaultValue: false,
      },
      {
        key: 'media.playback_ttl_seconds',
        type: 'number',
        label: 'Playback havola muddati',
        description: 'Imzolangan media havolasi qancha soniya amal qiladi.',
        defaultValue: 600,
        unit: 'soniya',
        min: 60,
        max: 86400,
      },
      {
        key: 'content.watermark_enabled',
        type: 'boolean',
        label: 'Video ustida ID belgisi (watermark)',
        description: 'Kontentni himoya qilish uchun video ustida foydalanuvchi ID‘si ko‘rsatiladi.',
        defaultValue: true,
      },
      {
        key: 'content.download_allowed_default',
        type: 'boolean',
        label: 'Yuklab olishga ruxsat (standart)',
        description: 'Yangi guruhlarda fayllarni yuklab olish standart holatda ruxsat etiladimi.',
        defaultValue: false,
      },
    ],
  },
  {
    id: 'ai',
    title: 'Sun’iy intellekt',
    description: 'AI yordamchi va provayder sozlamalari.',
    fields: [
      {
        key: 'ai.enabled',
        type: 'boolean',
        label: 'AI funksiyalari yoqilgan',
        description: 'O‘chirilsa AI tutor va baholash yordamchisi ishlamaydi.',
        defaultValue: true,
      },
      {
        key: 'ai.provider',
        type: 'select',
        label: 'AI provayderi',
        description: 'Qaysi model provayderi ishlatilsin.',
        defaultValue: 'gemini',
        options: [
          { value: 'gemini', label: 'Google Gemini' },
          { value: 'anthropic', label: 'Anthropic Claude' },
        ],
      },
    ],
  },
  {
    id: 'notifications',
    title: 'Bildirishnomalar',
    description: 'Tashqi xabar kanallari.',
    fields: [
      {
        key: 'notifications.email_enabled',
        type: 'boolean',
        label: 'Email bildirishnomalar',
        description: 'Foydalanuvchilarga elektron pochta orqali xabar yuborish.',
        defaultValue: true,
      },
      {
        key: 'notifications.telegram_enabled',
        type: 'boolean',
        label: 'Telegram bildirishnomalar',
        description: 'Telegram bot orqali xabar yuborish.',
        defaultValue: true,
      },
    ],
  },
];

/** All keys owned by the typed registry (used to compute "advanced" extras). */
export const REGISTERED_SETTING_KEYS: ReadonlySet<string> = new Set(
  SYSTEM_SETTINGS_SECTIONS.flatMap((s) => s.fields.map((f) => f.key)),
);

/**
 * Coerce a raw stored value into the field's declared type so the control
 * always receives a well-typed value even if the backend stored a string.
 */
export function coerceSettingValue(
  field: SettingField,
  raw: unknown,
): SettingValue {
  if (raw === null || raw === undefined) return field.defaultValue;
  switch (field.type) {
    case 'boolean':
      if (typeof raw === 'boolean') return raw;
      return raw === 'true' || raw === 1;
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(raw);
      return Number.isFinite(n) ? n : (field.defaultValue as number);
    }
    case 'select':
    case 'text':
    default:
      return typeof raw === 'string' ? raw : String(raw);
  }
}
