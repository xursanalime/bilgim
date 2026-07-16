'use client';

import { useMemo, useState } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  Check,
  Copy,
  KeyRound,
  Link as LinkIcon,
  Loader2,
  Plus,
  RefreshCw,
  Share2,
  Trash2,
  X,
} from 'lucide-react';

import {
  enrollmentApi,
  type CreateInviteLinkDto,
  type CreatedInvite,
} from '../../lib/api/enrollment';
import { groupsApi } from '../../lib/api/catalog';
import { ApiClientError } from '../../lib/api-client';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/form-field';
import { Select } from '../ui/select';
import { Badge } from '../ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../ui/card';
import { toast } from '../ui/toast';
import { cn } from '../../lib/utils';

// ═══════════════════════════════════════════════════════════════════
// InviteManager — teacher-side invite link + join code management.
//
// Task 5.1 (Req 9.1, 9.2):
//   • Create invite links with an optional expiry window and usage limit.
//   • List active links with status, usage, copy-to-clipboard, and revoke.
//   • Set / regenerate / clear the Group's shareable join code.
//
// Talks to `enrollmentApi` for invite links and `groupsApi.updateJoinCode`
// for the per-group code. See the endpoint ASSUMPTIONS documented in
// `lib/api/enrollment.ts`.
// ═══════════════════════════════════════════════════════════════════

export interface InviteManagerProps {
  /** The Group the invites belong to. */
  groupId: string;
  /** Current join code for the Group (server value), or null when unset. */
  joinCode?: string | null;
}

// Expiry presets (days). `0` means "never expires".
const EXPIRY_OPTIONS: ReadonlyArray<{ value: string; label: string; days: number }> = [
  { value: 'never', label: 'Muddatsiz', days: 0 },
  { value: '1', label: '1 kun', days: 1 },
  { value: '7', label: '7 kun', days: 7 },
  { value: '30', label: '30 kun', days: 30 },
  { value: '90', label: '90 kun', days: 90 },
];

const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

function randomJoinCode(length = 8): string {
  let out = '';
  const cryptoObj =
    typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (cryptoObj?.getRandomValues) {
    const bytes = new Uint8Array(length);
    cryptoObj.getRandomValues(bytes);
    for (let i = 0; i < length; i += 1) {
      out += JOIN_CODE_ALPHABET[bytes[i]! % JOIN_CODE_ALPHABET.length];
    }
  } else {
    for (let i = 0; i < length; i += 1) {
      out +=
        JOIN_CODE_ALPHABET[
          Math.floor(Math.random() * JOIN_CODE_ALPHABET.length)
        ];
    }
  }
  return out;
}

function describeExpiry(expiresAt: string | null | undefined): {
  label: string;
  expired: boolean;
} {
  if (!expiresAt) return { label: 'Muddatsiz', expired: false };
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return { label: 'Muddati tugagan', expired: true };
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  if (days > 0) return { label: `${days} kun qoldi`, expired: false };
  return { label: `${hours} soat qoldi`, expired: false };
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiClientError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

// ── Copy-to-clipboard control ──────────────────────────────────────
function CopyButton({
  value,
  label = 'Nusxalash',
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={className}
      leftIcon={
        copied ? (
          <Check className="h-3.5 w-3.5 text-green" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )
      }
      onClick={() => {
        navigator.clipboard
          ?.writeText(value)
          .then(() => {
            setCopied(true);
            toast.success('Nusxalandi');
            setTimeout(() => setCopied(false), 2000);
          })
          .catch(() => toast.error('Nusxalab boʻlmadi'));
      }}
    >
      {copied ? 'Nusxalandi' : label}
    </Button>
  );
}

export function InviteManager({ groupId, joinCode }: InviteManagerProps) {
  const qc = useQueryClient();

  // ── Invite-link create form state ────────────────────────────────
  const [expiry, setExpiry] = useState<string>('never');
  const [usesLimit, setUsesLimit] = useState<string>('');

  // ── Join code editor state ───────────────────────────────────────
  const [codeDraft, setCodeDraft] = useState<string>(joinCode ?? '');
  const [editingCode, setEditingCode] = useState(false);

  const linksQuery = useQuery({
    queryKey: ['enrollment', 'invite-links', groupId],
    queryFn: () => enrollmentApi.listInviteLinks(groupId),
  });

  const invalidateLinks = () =>
    qc.invalidateQueries({
      queryKey: ['enrollment', 'invite-links', groupId],
    });

  const createMut = useMutation({
    mutationFn: () => {
      const preset = EXPIRY_OPTIONS.find((o) => o.value === expiry);
      const parsedLimit = Number.parseInt(usesLimit, 10);
      const dto: CreateInviteLinkDto = {
        groupId,
        ...(preset && preset.days > 0
          ? {
              expiresAt: new Date(
                Date.now() + preset.days * 86_400_000,
              ).toISOString(),
            }
          : {}),
        ...(Number.isFinite(parsedLimit) && parsedLimit > 0
          ? { usesLimit: parsedLimit }
          : {}),
      };
      return enrollmentApi.createInviteLink(dto);
    },
    onSuccess: () => {
      setExpiry('never');
      setUsesLimit('');
      toast.success('Taklif havolasi yaratildi');
      void invalidateLinks();
    },
    onError: (err) =>
      toast.error(errorMessage(err, 'Havola yaratib boʻlmadi')),
  });

  const revokeMut = useMutation({
    mutationFn: (id: string) => enrollmentApi.revokeInviteLink(id),
    onSuccess: () => {
      toast.success('Havola bekor qilindi');
      void invalidateLinks();
    },
    onError: (err) =>
      toast.error(errorMessage(err, 'Havolani bekor qilib boʻlmadi')),
  });

  const codeMut = useMutation({
    mutationFn: (next: string | null) =>
      groupsApi.updateJoinCode(groupId, next),
    onSuccess: (group) => {
      setCodeDraft(group.joinCode ?? '');
      setEditingCode(false);
      toast.success('Guruh kodi yangilandi');
      qc.invalidateQueries({ queryKey: ['catalog', 'group', groupId] });
    },
    onError: (err) =>
      toast.error(errorMessage(err, 'Kodni saqlab boʻlmadi')),
  });

  const links = linksQuery.data ?? [];
  const activeCode = joinCode ?? null;

  const sortedLinks = useMemo(
    () =>
      [...links].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [links],
  );

  return (
    <div className="space-y-6">
      {/* ── Join code ───────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-purple" />
            Guruh kodi
          </CardTitle>
          <CardDescription>
            Oʻquvchilar bu kodni kiritib guruhni topadi va qoʻshilish
            soʻrovini yuboradi.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {editingCode ? (
            <div className="space-y-3">
              <Label htmlFor="join-code">Kod</Label>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id="join-code"
                  value={codeDraft}
                  onChange={(e) =>
                    setCodeDraft(
                      e.target.value.toUpperCase().replace(/\s+/g, ''),
                    )
                  }
                  placeholder="masalan: IELTS2026"
                  className="max-w-[220px] font-mono tracking-widest uppercase"
                  maxLength={24}
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  leftIcon={<RefreshCw className="h-4 w-4" />}
                  onClick={() => setCodeDraft(randomJoinCode())}
                >
                  Tasodifiy
                </Button>
                <Button
                  type="button"
                  size="sm"
                  loading={codeMut.isPending}
                  disabled={codeDraft.trim().length < 4}
                  onClick={() => codeMut.mutate(codeDraft.trim())}
                >
                  Saqlash
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  leftIcon={<X className="h-4 w-4" />}
                  onClick={() => {
                    setCodeDraft(activeCode ?? '');
                    setEditingCode(false);
                  }}
                >
                  Bekor
                </Button>
              </div>
              <p className="text-xs text-ink-soft">
                Kamida 4 ta belgi. Faqat harf va raqamlar tavsiya etiladi.
              </p>
            </div>
          ) : activeCode ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-2xl border border-rim bg-tint px-4 py-2 font-mono text-lg font-black uppercase tracking-[0.3em] text-ink-strong">
                {activeCode}
              </span>
              <CopyButton value={activeCode} label="Kodni nusxalash" />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                leftIcon={<RefreshCw className="h-4 w-4" />}
                onClick={() => {
                  setCodeDraft(activeCode);
                  setEditingCode(true);
                }}
              >
                Oʻzgartirish
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                loading={codeMut.isPending}
                leftIcon={<Trash2 className="h-4 w-4" />}
                onClick={() => codeMut.mutate(null)}
              >
                Oʻchirish
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-ink-soft">
                Hali guruh kodi belgilanmagan.
              </p>
              <Button
                type="button"
                size="sm"
                leftIcon={<Plus className="h-4 w-4" />}
                onClick={() => {
                  setCodeDraft(randomJoinCode());
                  setEditingCode(true);
                }}
              >
                Kod yaratish
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Invite links ────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5 text-blue" />
            Taklif havolalari
          </CardTitle>
          <CardDescription>
            Muddat va foydalanish chegarasi bilan havola yarating. Havola
            orqali kelgan oʻquvchi roʻyxatdan oʻtib, toʻlov/qoʻshilish
            jarayonidan oʻtadi.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Create form */}
          <div className="grid gap-4 rounded-2xl border border-rim bg-tint/40 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="invite-expiry">Amal qilish muddati</Label>
              <Select
                id="invite-expiry"
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
              >
                {EXPIRY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-uses">Foydalanish chegarasi</Label>
              <Input
                id="invite-uses"
                type="number"
                min={1}
                inputMode="numeric"
                value={usesLimit}
                onChange={(e) => setUsesLimit(e.target.value)}
                placeholder="Cheksiz"
              />
            </div>
            <Button
              type="button"
              loading={createMut.isPending}
              leftIcon={
                createMut.isPending ? undefined : <Plus className="h-4 w-4" />
              }
              onClick={() => createMut.mutate()}
            >
              Havola yaratish
            </Button>
          </div>

          {/* Links list */}
          {linksQuery.isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-ink-faint" />
            </div>
          ) : linksQuery.isError ? (
            <div className="rounded-2xl border border-red/20 bg-red-tint p-4 text-sm font-semibold text-red">
              Havolalarni yuklab boʻlmadi.
            </div>
          ) : sortedLinks.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-rim py-10 text-center">
              <LinkIcon className="h-8 w-8 text-ink-faint" />
              <p className="text-sm font-semibold text-ink-soft">
                Hali taklif havolasi yaratilmagan.
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {sortedLinks.map((link) => (
                <InviteLinkRow
                  key={link.id}
                  link={link}
                  onRevoke={() => revokeMut.mutate(link.id)}
                  revoking={
                    revokeMut.isPending && revokeMut.variables === link.id
                  }
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function InviteLinkRow({
  link,
  onRevoke,
  revoking,
}: {
  link: CreatedInvite;
  onRevoke: () => void;
  revoking: boolean;
}) {
  const expiry = describeExpiry(link.expiresAt);
  const used = link.usesCount ?? 0;
  const exhausted = link.usesLimit != null && used >= link.usesLimit;
  const inactive = expiry.expired || exhausted;

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-2xl border border-rim bg-canvas px-4 py-3 shadow-soft">
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-xs font-bold text-blue">
          {link.url}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <Badge
            variant={expiry.expired ? 'red' : 'green'}
            size="sm"
          >
            {expiry.label}
          </Badge>
          <Badge variant={exhausted ? 'red' : 'neutral'} size="sm">
            {link.usesLimit != null
              ? `${used} / ${link.usesLimit} ishlatilgan`
              : `${used} marta ishlatilgan`}
          </Badge>
          {inactive && (
            <Badge variant="outline" size="sm">
              Faol emas
            </Badge>
          )}
        </div>
      </div>
      <CopyButton value={link.url} />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        loading={revoking}
        leftIcon={revoking ? undefined : <Trash2 className="h-4 w-4" />}
        onClick={onRevoke}
        aria-label="Havolani bekor qilish"
      >
        Bekor qilish
      </Button>
    </li>
  );
}
