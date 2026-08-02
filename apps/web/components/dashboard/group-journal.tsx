'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ClipboardList,
  CreditCard,
  Users,
  GraduationCap,
  User,
  MessageCircle,
  MoreVertical,
  UserMinus,
  Loader2,
} from 'lucide-react';

import {
  teacherAnalyticsApi,
  type TeacherAnalyticsStudentRow,
} from '../../lib/api/teacher-analytics';
import { enrollmentApi } from '../../lib/api/enrollment';
import { dmApi } from '../../lib/api/dm';
import { ApiClientError } from '../../lib/api-client';
import { cn } from '../../lib/utils';

interface GroupJournalProps {
  locale: string;
  courseId: string;
  groupId: string;
  groupName: string;
  priceUzs: number;
  capacity: number | null;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('uz-UZ', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatPrice(amount: number): string {
  if (amount === 0) return 'Bepul';
  return new Intl.NumberFormat('uz-UZ').format(amount) + ' so‘m';
}

export function GroupJournal({
  locale,
  courseId,
  groupId,
  groupName,
  priceUzs,
  capacity,
}: GroupJournalProps) {
  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['teacher', 'journal', groupId],
    queryFn: () => teacherAnalyticsApi.students(groupId),
  });

  const rows = data ?? [];
  const paidCount = rows.filter((r) => r.paymentStatus === 'PAID').length;
  const gradedRows = rows.map((r) => r.averageGrade).filter((v): v is number => v !== null);
  const groupAverage =
    gradedRows.length === 0 ? null : gradedRows.reduce((sum, v) => sum + v, 0) / gradedRows.length;

  return (
    <div className="mx-auto max-w-7xl space-y-8 pb-12">
      <nav>
        <Link
          href={`/${locale}/dashboard/courses/${courseId}/groups/${groupId}?from=groups`}
          className="group inline-flex items-center gap-2 text-sm font-bold text-ink-soft transition-colors hover:text-blue"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-tint group-hover:bg-blue/10">
            <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          </div>
          {groupName}
        </Link>
      </nav>

      <header className="group relative overflow-hidden rounded-[2.5rem] border border-rim bg-white p-8 shadow-soft sm:p-10 lg:p-12">
        <div className="pointer-events-none absolute -right-20 -top-20 h-80 w-80 rounded-full bg-teal/5 blur-[80px]" />

        <div className="relative z-10 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex items-center gap-2.5 text-[10px] font-bold uppercase tracking-[0.25em] text-teal">
              <ClipboardList className="h-3.5 w-3.5" />
              Jurnal
            </div>
            <h1 className="font-display text-2xl font-extrabold tracking-tight text-ink-strong sm:text-3xl lg:text-4xl">
              {groupName}
            </h1>
            <p className="max-w-xl text-sm leading-relaxed text-ink-soft opacity-80">
              To&apos;lov holati va o&apos;zlashtirish natijalari bitta joyda — talabani guruhdan
              chiqarish shu yerdan amalga oshiriladi.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal/5 text-teal">
                <Users className="h-4.5 w-4.5" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">
                  Talabalar
                </p>
                <p className="text-sm font-black text-ink-strong tabular-nums">
                  {rows.length}
                  {capacity != null && (
                    <span className="font-bold text-ink-faint"> / {capacity}</span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue/5 text-blue">
                <CreditCard className="h-4.5 w-4.5" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">
                  To&apos;langan
                </p>
                <p className="text-sm font-black text-ink-strong tabular-nums">
                  {paidCount} / {rows.length}
                  <span className="font-medium text-ink-faint"> ({formatPrice(priceUzs)})</span>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange/5 text-orange">
                <GraduationCap className="h-4.5 w-4.5" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">
                  O&apos;rtacha baho
                </p>
                <p className="text-sm font-black text-ink-strong tabular-nums">
                  {groupAverage === null ? '—' : groupAverage.toFixed(1)}
                </p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {error && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red/20 bg-red-tint p-4 text-sm font-medium text-red">
          <span>
            {error instanceof ApiClientError ? error.message : 'Jurnalni yuklashda xato yuz berdi.'}
          </span>
          <button
            onClick={() => refetch()}
            disabled={isRefetching}
            className="shrink-0 rounded-lg bg-red/10 px-3 py-1.5 text-xs font-bold text-red transition-colors hover:bg-red-tint disabled:opacity-60"
          >
            {isRefetching ? 'Qayta yuklanmoqda...' : 'Qayta urinish'}
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-[2rem] border border-rim bg-white shadow-soft">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-rim bg-tint/40 text-left text-[10px] font-bold uppercase tracking-wider text-ink-faint">
                <th className="px-6 py-4">Talaba</th>
                <th className="px-4 py-4 text-center">To&apos;lov</th>
                <th className="px-4 py-4 text-center">Vazifalar</th>
                <th className="px-4 py-4 text-center">O&apos;rtacha baho</th>
                <th className="px-4 py-4">Qo&apos;shildi</th>
                <th className="px-4 py-4 text-right">Amallar</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rim">
              {isLoading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td colSpan={6} className="px-6 py-5">
                      <div className="h-4 rounded bg-tint" />
                    </td>
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-16 text-center font-medium text-ink-faint">
                    Bu guruhda hali tasdiqlangan talaba yoʻq.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <JournalRow key={row.studentId} row={row} locale={locale} groupId={groupId} />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function PaymentBadge({ status }: { status: TeacherAnalyticsStudentRow['paymentStatus'] }) {
  if (status === 'PAID') {
    return (
      <span className="inline-flex items-center rounded-lg border border-teal/20 bg-teal/10 px-2.5 py-1 text-[10px] font-bold text-teal">
        To&apos;langan
      </span>
    );
  }
  if (status === 'PENDING') {
    return (
      <span className="inline-flex items-center rounded-lg border border-orange/20 bg-orange/10 px-2.5 py-1 text-[10px] font-bold text-orange">
        Kutilmoqda
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-lg border border-rim bg-tint px-2.5 py-1 text-[10px] font-bold text-ink-faint">
      To&apos;lovsiz
    </span>
  );
}

function JournalRow({
  row,
  locale,
  groupId,
}: {
  row: TeacherAnalyticsStudentRow;
  locale: string;
  groupId: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const router = useRouter();

  const removeMutation = useMutation({
    mutationFn: () => enrollmentApi.revokeEnrollment(groupId, row.studentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teacher', 'journal', groupId] });
      queryClient.invalidateQueries({ queryKey: ['teacher', 'students'] });
    },
  });

  const openChatMutation = useMutation({
    mutationFn: () => dmApi.openThread(row.studentId),
    onSuccess: (result) => {
      router.push(`/${locale}/messages/${result.thread.id}`);
    },
  });

  function closeMenu() {
    setMenuOpen(false);
    setConfirmingRemove(false);
  }

  useEffect(() => {
    if (!menuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  return (
    <tr className="group transition-colors hover:bg-tint/20">
      <td className="px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-rim bg-tint">
            <User className="h-4 w-4 text-ink-faint" />
          </div>
          <div className="min-w-0">
            <div className="truncate font-bold text-ink-strong">{row.fullName ?? row.email}</div>
            <div className="truncate text-[11px] font-medium text-ink-faint">{row.email}</div>
          </div>
        </div>
      </td>
      <td className="px-4 py-4 text-center">
        <PaymentBadge status={row.paymentStatus} />
      </td>
      <td className="px-4 py-4 text-center font-black text-ink-strong">{row.submissionsCount}</td>
      <td className="px-4 py-4 text-center">
        {row.averageGrade === null ? (
          <span className="text-ink-faint">—</span>
        ) : (
          <span
            className={cn(
              'font-black',
              row.averageGrade >= 80
                ? 'text-teal'
                : row.averageGrade >= 60
                  ? 'text-orange'
                  : 'text-red',
            )}
          >
            {row.averageGrade.toFixed(1)}
          </span>
        )}
      </td>
      <td className="px-4 py-4 text-xs font-medium text-ink-faint whitespace-nowrap">
        {formatDate(row.enrolledAt)}
      </td>
      <td className="px-4 py-4 text-right">
        <div className="relative inline-block text-left" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Qo'shimcha amallar"
            aria-expanded={menuOpen}
            className={cn(
              'h-8 w-8 rounded-lg text-ink-faint transition-colors hover:bg-tint hover:text-ink-strong',
              menuOpen && 'bg-tint text-ink-strong',
            )}
          >
            <MoreVertical className="mx-auto h-4 w-4" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-9 z-20 w-60 overflow-hidden rounded-xl border border-rim bg-white py-1.5 text-left shadow-medium">
              <button
                type="button"
                disabled={openChatMutation.isPending}
                onClick={() => openChatMutation.mutate()}
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-xs font-bold text-ink-strong transition-colors hover:bg-tint disabled:opacity-60"
              >
                {openChatMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-blue" />
                ) : (
                  <MessageCircle className="h-3.5 w-3.5 text-blue" />
                )}
                Shaxsiy chatga o&apos;tish
              </button>
              {openChatMutation.isError && (
                <p className="px-4 pb-2 text-[10px] font-medium text-red">
                  {openChatMutation.error instanceof ApiClientError
                    ? openChatMutation.error.message
                    : 'Chatni ochib boʻlmadi.'}
                </p>
              )}

              <div className="my-1 border-t border-rim/60" />

              {!confirmingRemove ? (
                <button
                  type="button"
                  onClick={() => setConfirmingRemove(true)}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-xs font-bold text-red transition-colors hover:bg-red-tint"
                >
                  <UserMinus className="h-3.5 w-3.5" />
                  Guruhdan chiqarish
                </button>
              ) : (
                <div className="space-y-2 px-4 py-2.5">
                  <p className="text-[11px] font-medium leading-snug text-ink-soft">
                    {row.fullName ?? row.email}ni guruhdan chiqarasizmi?
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={removeMutation.isPending}
                      onClick={() => removeMutation.mutate()}
                      className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-red px-2 py-1.5 text-[11px] font-bold text-white transition-colors hover:bg-red/90 disabled:opacity-60"
                    >
                      {removeMutation.isPending ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        'Ha, chiqarish'
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingRemove(false)}
                      className="flex-1 rounded-lg border border-rim px-2 py-1.5 text-[11px] font-bold text-ink-soft transition-colors hover:bg-tint"
                    >
                      Bekor
                    </button>
                  </div>
                  {removeMutation.isError && (
                    <p className="text-[10px] font-medium text-red">
                      {removeMutation.error instanceof ApiClientError
                        ? removeMutation.error.message
                        : 'Xatolik yuz berdi. Qayta urinib koʻring.'}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}
