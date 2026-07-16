# @bilgim/i18n

Shared locale config and message catalogs for Bilgim. Consumed by the web
app (`apps/web`) through next-intl and importable anywhere via the
`@bilgim/i18n` workspace alias.

## Locales

| Code | Language   | Notes              |
| ---- | ---------- | ------------------ |
| `uz` | O'zbekcha  | **default**, canonical copy |
| `ru` | Русский    |                    |
| `en` | English    |                    |

`supportedLocales`, `defaultLocale`, and the `Locale` type are exported from
`src/index.ts`.

## Catalog structure

Messages live under `locales/<locale>/<catalog>.json`. Today there is a
single `common.json` catalog per locale; additional catalogs (e.g.
`marketing.json`, `live.json`) can be added per surface as the string sweep
progresses. The web app loads `common.json` in `apps/web/i18n.ts`.

```
locales/
  uz/common.json   ← canonical source of keys
  ru/common.json
  en/common.json
```

## Namespacing convention

Keys are grouped into **namespaces** (top-level JSON objects) named after the
feature or surface they belong to. Inside a namespace, keys are
`snake_case`. Nest one extra level only for tightly-related groups (e.g.
`settings.tabs.*`, `auth.errors.*`).

```jsonc
{
  "settings": {                 // namespace = feature/surface
    "title": "Sozlamalar",      // snake_case leaf key
    "tabs": {                   // one nested group, still scoped to the namespace
      "profile": "Shaxsiy profil"
    }
  }
}
```

Consume a namespace with next-intl's scoped translator:

```tsx
const t = useTranslations('settings.tabs');
t('profile'); // → "Shaxsiy profil"
```

Bare top-level keys (`login`, `courses`, …) are legacy shared labels. Prefer
adding new keys inside a namespace.

## Adding keys

1. Add the key to **`locales/uz/common.json` first** (uz is canonical).
2. Add the **same key path** to `ru` and `en`. All three catalogs must stay
   in structural parity — a missing key falls back to the key name at
   runtime, which surfaces as an obvious untranslated string.
3. Use the next-intl scoped translator in components
   (`useTranslations('<namespace>')` in client/server components, or
   `getTranslations` in async server code).
4. Do **not** hard-code user-facing copy in components (Req 21.1).

## Formatting (not message keys)

Locale-aware **number / currency (UZS) / date** formatting and tri-lingual
entity-name rendering live in `apps/web/lib/format.ts`
(`formatUzs`, `formatDate`, `formatDateTime`, `localizedName`,
`localizedField`). These take an explicit `locale` and are unit-tested in
`apps/web/lib/format.spec.ts`.
