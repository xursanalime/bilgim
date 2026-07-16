'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation } from '@tanstack/react-query';
import { 
  GraduationCap, 
  BookOpen, 
  User, 
  CreditCard, 
  Calendar, 
  ArrowRight, 
  CheckCircle2, 
  AlertCircle,
  Loader2,
  Lock,
  Layers
} from 'lucide-react';

import { enrollmentApi, type InviteResolution } from '../../../../lib/api/enrollment';
import { billingApi } from '../../../../lib/api/billing';
import { ApiClientError } from '../../../../lib/api-client';
import { getCurrentUser } from '../../../../lib/auth';
import { cn } from '../../../../lib/utils';
import { QueryProvider } from '../../../../components/providers/query-provider';

interface InvitePageProps {
  params: { locale: string; token: string };
}

export default function InvitePage({ params: { locale, token } }: InvitePageProps) {
  return (
    <QueryProvider>
      <main id="main-content" tabIndex={-1}>
        <InvitePageContent locale={locale} token={token} />
      </main>
    </QueryProvider>
  );
}

function InvitePageContent({ locale, token }: { locale: string; token: string }) {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    setUser(getCurrentUser());
  }, []);

  const inviteQuery = useQuery({
    queryKey: ['enrollment', 'invite', token],
    queryFn: () => enrollmentApi.resolveInvite(token),
  });

  const joinMutation = useMutation({
    // Consume the invite token (increments usesCount atomically) to create
    // the enrollment request, then route through the existing Payme +
    // enrollment flow (Req 9.2):
    //   • Paid group  → redirect to the Payme checkout `payUrl`.
    //   • Free group  → land on the learner's courses / enrollment status.
    mutationFn: async () => {
      await enrollmentApi.joinViaInvite(token);
      const group = inviteQuery.data;
      if (group && group.priceUzs > 0) {
        const { payUrl } = await billingApi.checkout({
          kind: 'STUDENT_COURSE',
          groupId: group.groupId,
        });
        return { payUrl };
      }
      return { payUrl: null as string | null };
    },
    onSuccess: ({ payUrl }) => {
      if (payUrl) {
        // External Payme checkout — full-page redirect.
        window.location.href = payUrl;
        return;
      }
      router.push(`/${locale}/my-courses`);
    },
  });

  if (inviteQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <Loader2 className="h-10 w-10 animate-spin text-blue/40" />
      </div>
    );
  }

  if (inviteQuery.isError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-canvas p-6 text-center">
        <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-[2.5rem] bg-red/5 text-red shadow-sm border border-red/10">
          <AlertCircle className="h-10 w-10" />
        </div>
        <h1 className="font-display text-2xl font-extrabold text-ink-strong">Taklif havolasi yaroqsiz</h1>
        <p className="mt-2 max-w-sm text-sm text-ink-soft opacity-80">
          Ushbu havola muddati oʻtgan, oʻchirilgan yoki notoʻgʻri boʻlishi mumkin.
        </p>
        <button
          onClick={() => router.push(`/${locale}`)}
          className="mt-8 rounded-2xl bg-blue px-8 py-3.5 text-sm font-bold text-white shadow-blue-soft transition-all hover:bg-blue-600 active:scale-[0.98]"
        >
          Bosh sahifaga qaytish
        </button>
      </div>
    );
  }

  const group = inviteQuery.data!;

  return (
    <div className="min-h-screen bg-canvas flex flex-col items-center justify-center p-6 relative overflow-hidden">
      {/* Background Aurora */}
      <div className="pointer-events-none absolute -left-40 top-0 h-[600px] w-[600px] rounded-full bg-blue/5 blur-[120px]" />
      <div className="pointer-events-none absolute -right-40 bottom-0 h-[600px] w-[600px] rounded-full bg-purple/5 blur-[120px]" />

      <div className="w-full max-w-xl relative z-10 space-y-8 animate-in fade-in slide-in-from-bottom-6 duration-700">
        <div className="text-center space-y-3">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue text-white shadow-blue-soft mb-6">
            <GraduationCap className="h-8 w-8" />
          </div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink-strong sm:text-4xl">
            Sizni oʻquv guruhiga taklif qilishdi!
          </h1>
          <p className="text-base text-ink-soft opacity-80">
            BilgimAI platformasidagi maxsus oʻquv kursida ishtirok eting.
          </p>
        </div>

        <div className="overflow-hidden rounded-[2.5rem] border border-rim bg-white shadow-2xl">
          <header className="bg-tint/30 border-b border-rim p-8 text-center">
            <div className="flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-blue mb-2">
              <Layers className="h-3.5 w-3.5" />
              Topilgan guruh
            </div>
            <h2 className="font-display text-2xl font-extrabold text-ink-strong">{group.groupName}</h2>
            <p className="text-sm font-medium text-ink-faint mt-1">{group.courseTitle}</p>
          </header>

          <div className="p-8 space-y-8">
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-faint">
                  <User className="h-3 w-3" />
                  Oʻqituvchi
                </div>
                <p className="text-sm font-black text-ink-strong">{group.teacherName}</p>
              </div>
              <div className="space-y-1 text-right">
                <div className="flex items-center justify-end gap-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-faint">
                  <CreditCard className="h-3 w-3" />
                  Narxi
                </div>
                <p className="text-sm font-black text-ink-strong">
                  {group.priceUzs === 0 ? 'Bepul' : new Intl.NumberFormat('uz-UZ').format(group.priceUzs) + ' soʻm'}
                </p>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-faint">
                  <Calendar className="h-3 w-3" />
                  Boshlanishi
                </div>
                <p className="text-sm font-black text-ink-strong">
                  {group.startsOn ? new Date(group.startsOn).toLocaleDateString('uz-UZ') : 'Yaqinda'}
                </p>
              </div>
              <div className="space-y-1 text-right">
                <div className="flex items-center justify-end gap-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-faint">
                  <Lock className="h-3 w-3" />
                  Darslar
                </div>
                <p className="text-sm font-black text-ink-strong">Himoyalangan</p>
              </div>
            </div>

            {user ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3 rounded-2xl bg-blue/5 border border-blue/10 p-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue text-white">
                    <User className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-blue">Sizning hisobingiz</p>
                    <p className="text-sm font-bold text-ink-strong truncate">{user.email}</p>
                  </div>
                </div>

                <button
                  onClick={() => joinMutation.mutate()}
                  disabled={joinMutation.isPending}
                  className="w-full flex items-center justify-center gap-2.5 rounded-2xl bg-blue py-4 text-base font-bold text-white shadow-blue-soft transition-all hover:bg-blue-600 active:scale-[0.98] disabled:opacity-50"
                >
                  {joinMutation.isPending ? (
                    <Loader2 className="h-6 w-6 animate-spin" />
                  ) : (
                    <>
                      {group.priceUzs > 0
                        ? "Toʻlovga oʻtish va guruhga qoʻshilish"
                        : 'Guruhga qoʻshilish soʻrovini yuborish'}
                      <ArrowRight className="h-5 w-5" />
                    </>
                  )}
                </button>

                {joinMutation.isError && (
                  <p
                    role="alert"
                    className="flex items-center justify-center gap-2 text-center text-sm font-semibold text-red"
                  >
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {joinMutation.error instanceof ApiClientError
                      ? joinMutation.error.message
                      : 'Qoʻshilishda xatolik yuz berdi. Qayta urinib koʻring.'}
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-4 text-center">
                <p className="text-sm font-medium text-ink-soft">
                  Guruhga qoʻshilish uchun tizimga kiring yoki roʻyxatdan oʻting.
                </p>
                <div className="flex gap-3">
                  <Link
                    href={`/${locale}/login?callbackUrl=${encodeURIComponent(`/${locale}/i/${token}`)}`}
                    className="flex-1 rounded-2xl border border-rim bg-white py-4 text-sm font-bold text-ink-soft hover:bg-tint transition-all active:scale-[0.98]"
                  >
                    Kirish
                  </Link>
                  <Link
                    href={`/${locale}/register?role=student&callbackUrl=${encodeURIComponent(`/${locale}/i/${token}`)}`}
                    className="flex-1 rounded-2xl bg-blue py-4 text-sm font-bold text-white shadow-blue-soft transition-all hover:bg-blue-600 active:scale-[0.98]"
                  >
                    Roʻyxatdan oʻtish
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>

        <footer className="text-center">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-ink-faint">
            Powered by BilgimAI
          </p>
        </footer>
      </div>
    </div>
  );
}
