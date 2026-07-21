'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Globe,
  Loader2,
  Save,
} from 'lucide-react';

import { teacherApi } from '../../lib/api/teacher';
import { ApiClientError } from '../../lib/api-client';
import { cn } from '../../lib/utils';

interface TeacherPublicProfileProps {
  locale: string;
}

/**
 * "Ochiq profil" toggle — lets a teacher opt into the `/discovery/teachers`
 * marketplace listing. `TeacherProfile.publicSlug` has no other write path
 * in the app, so without this section a teacher can never appear in
 * `/teachers` or the student-facing "O'qituvchilarni qidirish" search.
 */
export function TeacherPublicProfile({ locale }: TeacherPublicProfileProps) {
  const queryClient = useQueryClient();
  const [headline, setHeadline] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const statusQuery = useQuery({
    queryKey: ['teacher', 'publicProfile'],
    queryFn: () => teacherApi.getPublicProfile(),
  });

  useEffect(() => {
    if (statusQuery.data) setHeadline(statusQuery.data.headline ?? '');
  }, [statusQuery.data]);

  const mutation = useMutation({
    mutationFn: (isPublic: boolean) =>
      teacherApi.updatePublicProfile({ isPublic, headline: headline.trim() }),
    onSuccess: (data) => {
      queryClient.setQueryData(['teacher', 'publicProfile'], data);
      setError(null);
      setSuccessMsg("Saqlandi!");
      setTimeout(() => setSuccessMsg(null), 3000);
    },
    onError: (err) => {
      setError(err instanceof ApiClientError ? err.message : 'Xatolik yuz berdi.');
    },
  });

  if (statusQuery.isLoading) {
    return <div className="h-56 animate-pulse rounded-[2rem] bg-soft/60 sm:rounded-[2.5rem]" />;
  }

  if (statusQuery.isError || !statusQuery.data) {
    return (
      <div className="flex items-center gap-3 rounded-[2rem] border border-red/15 bg-red-tint p-6 text-sm font-bold text-red sm:rounded-[2.5rem]">
        <AlertCircle className="h-5 w-5 shrink-0" />
        Ochiq profil holatini yuklab bo'lmadi.
      </div>
    );
  }

  const status = statusQuery.data;
  const hasDiscoverableCourse = status.discoverableCourseCount > 0;

  return (
    <section className="overflow-hidden rounded-[2rem] border border-rim bg-white shadow-soft sm:rounded-[2.5rem]">
      <div className="border-b border-rim bg-tint/30 px-6 py-4 sm:px-8 sm:py-5">
        <h3 className="font-display text-base font-extrabold text-ink-strong">Ochiq profil</h3>
        <p className="text-xs text-ink-faint">
          Platformadagi "Oʻqituvchilarni qidirish" boʻlimida talabalarga koʻrinishingizni boshqaring.
        </p>
      </div>

      <div className="space-y-6 p-6 sm:p-8">
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-rim bg-tint/30 p-4">
          <div className="flex items-center gap-3">
            <div className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
              status.isPublic ? 'bg-blue-tint text-blue' : 'bg-soft text-ink-faint',
            )}>
              <Globe className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-bold text-ink-strong">Platformada ko'rinish</p>
              <p className="text-xs text-ink-faint">
                {status.isPublic ? 'Talabalar sizni qidiruvda topa oladi.' : "Hozircha qidiruvda ko'rinmaysiz."}
              </p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={status.isPublic}
            disabled={mutation.isPending}
            onClick={() => mutation.mutate(!status.isPublic)}
            className={cn(
              'flex h-7 w-12 shrink-0 items-center rounded-full p-0.5 transition-colors disabled:opacity-50',
              status.isPublic ? 'justify-end bg-blue' : 'justify-start bg-soft',
            )}
          >
            <span className="h-6 w-6 rounded-full bg-white shadow-sm" />
          </button>
        </div>

        {!hasDiscoverableCourse && (
          <div className="flex items-start gap-2.5 rounded-2xl border border-orange/15 bg-orange-tint px-4 py-3 text-xs font-semibold text-orange">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            Sizda hozircha nashr etilgan ochiq kurs yo'q — profil yoqilgan bo'lsa ham, kamida bitta ochiq kurs bo'lmaguncha qidiruvda chiqmaysiz.
          </div>
        )}

        <div className="space-y-2">
          <label className="text-xs font-bold text-ink-strong uppercase tracking-wider">
            Sarlavha (headline)
          </label>
          <input
            type="text"
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            placeholder="Masalan: Sertifikatlangan IELTS instruktori"
            maxLength={200}
            className="w-full rounded-2xl border border-rim bg-tint/30 py-3 px-4 text-sm font-medium text-ink-strong outline-none transition-all focus:border-blue/30 focus:bg-white focus:ring-4 focus:ring-blue/5"
          />
          <p className="text-[10px] text-ink-faint">Profilingizda ism ostida ko'rsatiladi.</p>
        </div>

        {status.isPublic && status.profileUrlPath && (
          <Link
            href={`/${locale}${status.profileUrlPath}`}
            target="_blank"
            className="inline-flex items-center gap-1.5 text-xs font-bold text-blue hover:underline"
          >
            Ochiq profilni ko'rish
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        )}

        {error && (
          <div className="flex items-center gap-2 text-sm font-medium text-red">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}
        {successMsg && (
          <div className="flex items-center gap-2 text-sm font-medium text-green">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {successMsg}
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => mutation.mutate(status.isPublic)}
            disabled={mutation.isPending}
            className="flex items-center justify-center gap-2 rounded-2xl border border-rim bg-tint px-6 py-3 text-sm font-bold text-ink-soft transition-all hover:border-blue/20 hover:text-blue active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
          >
            {mutation.isPending ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Saqlanmoqda</>
            ) : (
              <><Save className="h-4 w-4" /> Sarlavhani saqlash</>
            )}
          </button>
        </div>
      </div>
    </section>
  );
}
