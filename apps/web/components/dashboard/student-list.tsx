'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { 
  Users, 
  Search, 
  Filter, 
  Mail, 
  Layers, 
  GraduationCap, 
  ChevronRight,
  MoreVertical,
  User,
  Calendar
} from 'lucide-react';
import { enrollmentApi, type TeacherStudentEnrollment } from '../../lib/api/enrollment';
import { ApiClientError } from '../../lib/api-client';
import { cn } from '../../lib/utils';

interface StudentListProps {
  locale: string;
}

export function StudentList({ locale }: StudentListProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCourse, setSelectedCourse] = useState<string | 'all'>('all');
  const [selectedGroup, setSelectedGroup] = useState<string | 'all'>('all');

  const { data, isLoading, error } = useQuery({
    queryKey: ['teacher', 'students'],
    queryFn: () => enrollmentApi.listStudents(),
  });

  const students = data ?? [];

  // Extract unique courses and groups for filters
  const filters = useMemo(() => {
    const courses = new Map<string, string>();
    const groups = new Map<string, string>();
    
    students.forEach(item => {
      courses.set(item.group.course.id, item.group.course.title);
      groups.set(item.group.id, item.group.name);
    });

    return {
      courses: Array.from(courses.entries()).map(([id, title]) => ({ id, title })),
      groups: Array.from(groups.entries()).map(([id, name]) => ({ id, name })),
    };
  }, [students]);

  const filteredStudents = useMemo(() => {
    return students.filter(item => {
      const matchesSearch = 
        item.student.user.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.student.user.email.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesCourse = selectedCourse === 'all' || item.group.course.id === selectedCourse;
      const matchesGroup = selectedGroup === 'all' || item.group.id === selectedGroup;

      return matchesSearch && matchesCourse && matchesGroup;
    });
  }, [students, searchQuery, selectedCourse, selectedGroup]);

  if (error) {
    return (
      <div className="rounded-2xl border border-red/20 bg-red-tint p-4 text-sm font-medium text-red">
        {error instanceof ApiClientError ? error.message : "Talabalarni yuklashda xato yuz berdi."}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8 pb-12 sm:space-y-10">
      <header className="group relative overflow-hidden rounded-[2.5rem] border border-rim bg-white p-6 shadow-soft sm:p-10 lg:p-12">
        <div className="pointer-events-none absolute -right-20 -top-20 h-80 w-80 rounded-full bg-blue/5 blur-[80px]" />
        
        <div className="relative z-10 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div className="min-w-0 flex-1 space-y-4">
            <div className="flex items-center gap-2.5 text-[10px] font-bold uppercase tracking-[0.25em] text-blue">
              <GraduationCap className="h-3.5 w-3.5" />
              CRM Tizimi
            </div>

            <div className="space-y-2">
              <h1 className="font-display text-2xl font-extrabold tracking-tight text-ink-strong sm:text-3xl lg:text-4xl">
                Talabalar
              </h1>
              <p className="max-w-xl text-sm leading-relaxed text-ink-soft opacity-80">
                Kurslaringizda taʼlim olayotgan barcha talabalar roʻyxati va ularning guruhlari.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 lg:pt-0 pt-2 border-t border-rim/50 lg:border-0">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue/5 text-blue sm:h-10 sm:w-10">
              <Users className="h-4.5 w-4.5 sm:h-5 sm:w-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Jami talaba</p>
              <p className="text-sm font-black text-ink-strong">{students.length} nafar</p>
            </div>
          </div>
        </div>
      </header>

      {/* Filters & Search */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative flex-1 lg:max-w-md">
          <Search className="absolute left-4 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-ink-faint" />
          <input
            type="text"
            placeholder="Ism yoki email boʻyicha qidirish..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-2xl border border-rim bg-white py-3 pl-11 pr-4 text-sm outline-none transition-all focus:border-blue/30 focus:ring-4 focus:ring-blue/5"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-2xl border border-rim bg-white px-3 py-1.5 shadow-sm">
            <Filter className="h-3.5 w-3.5 text-ink-faint" />
            <select
              value={selectedCourse}
              onChange={(e) => setSelectedCourse(e.target.value)}
              className="bg-transparent text-xs font-bold text-ink-strong outline-none"
            >
              <option value="all">Barcha kurslar</option>
              {filters.courses.map(c => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 rounded-2xl border border-rim bg-white px-3 py-1.5 shadow-sm">
            <Layers className="h-3.5 w-3.5 text-ink-faint" />
            <select
              value={selectedGroup}
              onChange={(e) => setSelectedGroup(e.target.value)}
              className="bg-transparent text-xs font-bold text-ink-strong outline-none"
            >
              <option value="all">Barcha guruhlar</option>
              {filters.groups.map(g => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-40 animate-pulse rounded-[2rem] bg-white border border-rim" />
          ))}
        </div>
      ) : filteredStudents.length === 0 ? (
        <div className="flex min-h-[300px] flex-col items-center justify-center rounded-[2.5rem] border-2 border-dashed border-rim bg-white p-12 text-center shadow-soft">
          <div className="relative mb-6">
            <div className="absolute -inset-4 rounded-full bg-blue/5 blur-xl animate-pulse" />
            <div className="relative flex h-16 w-16 items-center justify-center rounded-[1.5rem] bg-blue/10 text-blue shadow-sm">
              <Search className="h-8 w-8" />
            </div>
          </div>
          <h2 className="font-display text-lg font-extrabold text-ink-strong">
            Talabalar topilmadi
          </h2>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-soft">
            Qidiruv soʻrovi yoki filtrlar boʻyicha hech qanday talaba topilmadi.
          </p>
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filteredStudents.map((item) => (
            <StudentCard key={item.id} item={item} locale={locale} />
          ))}
        </div>
      )}
    </div>
  );
}

function StudentCard({ item, locale }: { item: TeacherStudentEnrollment; locale: string }) {
  const user = item.student.user;

  return (
    <div className="group relative overflow-hidden rounded-[2rem] border border-rim bg-white p-6 shadow-soft transition-all duration-300 hover:shadow-medium hover:border-blue/20">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-tint border border-rim transition-colors group-hover:border-blue/20">
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <User className="h-7 w-7 text-ink-faint" />
            )}
            <div className="absolute inset-0 bg-blue/5 opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
          <div className="min-w-0">
            <h3 className="truncate font-display text-base font-extrabold text-ink-strong group-hover:text-blue transition-colors">
              {user.fullName}
            </h3>
            <p className="flex items-center gap-1.5 truncate text-xs font-medium text-ink-faint">
              <Mail className="h-3 w-3" />
              {user.email}
            </p>
          </div>
        </div>
        <button className="h-8 w-8 rounded-lg text-ink-faint hover:bg-tint hover:text-ink-strong transition-colors">
          <MoreVertical className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-6 space-y-3">
        <div className="flex items-center justify-between rounded-xl bg-tint/50 p-3 border border-rim/50">
          <div className="space-y-1">
            <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-ink-faint">
              <Layers className="h-2.5 w-2.5 text-purple" />
              Guruh
            </span>
            <p className="text-xs font-bold text-ink-strong truncate max-w-[140px]">
              {item.group.name}
            </p>
          </div>
          <div className="text-right space-y-1">
            <span className="flex items-center justify-end gap-1 text-[9px] font-bold uppercase tracking-wider text-ink-faint">
              <Calendar className="h-2.5 w-2.5" />
              Qoʻshildi
            </span>
            <p className="text-xs font-bold text-ink-strong">
              {new Date(item.approvedAt).toLocaleDateString('uz-UZ', { month: 'short', day: 'numeric' })}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="truncate text-[10px] font-bold text-ink-faint">
            {item.group.course.title}
          </span>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-tint">
          <div className="h-full w-1/3 rounded-full bg-blue" />
        </div>
      </div>
    </div>
  );
}
