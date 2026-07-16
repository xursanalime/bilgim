'use client';

import { useState } from 'react';
import { 
  BookOpen, 
  Sparkles, 
  DollarSign, 
  CheckCircle,
  PlayCircle,
  FileText,
  CreditCard,
  ChevronRight
} from 'lucide-react';
import { cn } from '../../lib/utils';

interface CourseSetupGuideProps {
  locale: string;
}

export function CourseSetupGuide({ locale }: CourseSetupGuideProps) {
  const [activeStep, setActiveStep] = useState<'curriculum' | 'pricing'>('curriculum');

  return (
    <div className="mx-auto max-w-4xl space-y-8 pb-12">
      <header className="space-y-2">
        <h1 className="font-display text-2xl font-extrabold text-ink-strong sm:text-3xl">
          Kursni sozlash qo'llanmasi
        </h1>
        <p className="text-sm text-ink-soft">
          O'z onlayn maktabingizni va kursingizni bir necha qadamda sotuvga tayyorlang.
        </p>
      </header>

      <div className="grid gap-6 md:grid-cols-[240px_1fr]">
        <div className="space-y-2">
          <button
            onClick={() => setActiveStep('curriculum')}
            className={cn(
              "w-full flex items-center gap-3 rounded-2xl p-4 text-left transition-all",
              activeStep === 'curriculum' 
                ? "bg-white border border-blue/20 shadow-sm" 
                : "border border-transparent hover:bg-tint"
            )}
          >
            <div className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full transition-colors",
              activeStep === 'curriculum' ? "bg-blue text-white" : "bg-white text-ink-faint border border-rim"
            )}>
              1
            </div>
            <div className="flex-1 font-bold text-sm text-ink-strong">Kurs mundarijasi</div>
          </button>
          <button
            onClick={() => setActiveStep('pricing')}
            className={cn(
              "w-full flex items-center gap-3 rounded-2xl p-4 text-left transition-all",
              activeStep === 'pricing' 
                ? "bg-white border border-blue/20 shadow-sm" 
                : "border border-transparent hover:bg-tint"
            )}
          >
            <div className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full transition-colors",
              activeStep === 'pricing' ? "bg-blue text-white" : "bg-white text-ink-faint border border-rim"
            )}>
              2
            </div>
            <div className="flex-1 font-bold text-sm text-ink-strong">Narxlash</div>
          </button>
        </div>

        <div className="rounded-3xl border border-rim bg-white p-6 shadow-soft sm:p-8 transition-all duration-300 hover:shadow-medium">
          {activeStep === 'curriculum' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-8 duration-500">
              <div>
                <h2 className="text-xl font-extrabold text-ink-strong">Kurs mundarijasi</h2>
                <p className="mt-1 text-sm text-ink-soft">
                  Kurs bo'limlari va darslarni qo'shing. Bu o'quvchilaringiz uchun ta'lim jarayonini shakllantiradi.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <button className="group flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-rim bg-tint p-8 transition-all duration-300 hover:border-blue/30 hover:bg-blue/5 hover:-translate-y-1">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white text-blue shadow-sm transition-transform duration-300 group-hover:scale-110 group-hover:shadow-md">
                    <BookOpen className="h-6 w-6" />
                  </div>
                  <div className="text-center">
                    <h3 className="font-bold text-ink-strong transition-colors group-hover:text-blue">Noldan boshlash</h3>
                    <p className="mt-1 text-xs text-ink-soft transition-colors group-hover:text-ink">Darslarni o'zingiz qo'shing</p>
                  </div>
                </button>
                <button className="group flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-rim bg-tint p-8 transition-all duration-300 hover:border-purple/30 hover:bg-purple/5 hover:-translate-y-1">
                  <div className="relative">
                    <div className="absolute -inset-2 rounded-full bg-purple/10 blur-md transition-all duration-500 group-hover:bg-purple/20 group-hover:scale-150 group-hover:blur-xl" />
                    <div className="relative flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-purple to-blue text-white shadow-sm transition-transform duration-300 group-hover:scale-110 group-hover:shadow-md">
                      <Sparkles className="h-6 w-6 animate-pulse-glow" />
                    </div>
                  </div>
                  <div className="text-center">
                    <h3 className="font-bold text-ink-strong transition-colors group-hover:text-purple">AI yordamida yaratish</h3>
                    <p className="mt-1 text-xs text-ink-soft">AI yordamida tezkor tuzilma</p>
                  </div>
                </button>
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-bold text-ink-strong">Dars tiplari:</h3>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="flex items-center gap-3 rounded-xl border border-rim p-3">
                    <PlayCircle className="h-5 w-5 text-blue" />
                    <span className="text-xs font-bold text-ink-strong">Video dars</span>
                  </div>
                  <div className="flex items-center gap-3 rounded-xl border border-rim p-3">
                    <FileText className="h-5 w-5 text-orange" />
                    <span className="text-xs font-bold text-ink-strong">Matn & PDF</span>
                  </div>
                  <div className="flex items-center gap-3 rounded-xl border border-rim p-3">
                    <CheckCircle className="h-5 w-5 text-green" />
                    <span className="text-xs font-bold text-ink-strong">Topshiriq (AI)</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeStep === 'pricing' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-8 duration-500">
              <div>
                <h2 className="text-xl font-extrabold text-ink-strong">Narxlash va To'lovlar</h2>
                <p className="mt-1 text-sm text-ink-soft">
                  Talabalar uchun kurs narxini belgilang. Biz barcha mahalliy to'lov tizimlarini qo'llab-quvvatlaymiz.
                </p>
              </div>

              <div className="space-y-4">
                <div className="group flex items-start gap-4 rounded-2xl border border-rim bg-white p-5 transition-all duration-300 hover:border-blue/30 hover:shadow-md hover:-translate-y-1 cursor-pointer">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue/10 text-blue transition-colors duration-300 group-hover:bg-blue group-hover:text-white">
                    <DollarSign className="h-5 w-5 transition-transform duration-300 group-hover:scale-110" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-sm font-bold text-ink-strong transition-colors group-hover:text-blue">Bir martalik to'lov</h3>
                    <p className="mt-1 text-xs text-ink-soft transition-colors group-hover:text-ink">Talabalar kursni bir marta sotib olishadi va doimiy foydalanish huquqiga ega bo'lishadi.</p>
                  </div>
                  <ChevronRight className="mt-2 h-4 w-4 text-ink-faint transition-all duration-300 group-hover:text-blue group-hover:translate-x-1" />
                </div>
                
                <div className="group flex items-start gap-4 rounded-2xl border border-rim bg-white p-5 transition-all duration-300 hover:border-green/30 hover:shadow-md hover:-translate-y-1 cursor-pointer">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-green/10 text-green transition-colors duration-300 group-hover:bg-green group-hover:text-white">
                    <CreditCard className="h-5 w-5 transition-transform duration-300 group-hover:scale-110" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-sm font-bold text-ink-strong transition-colors group-hover:text-green">Obuna (Subscription)</h3>
                    <p className="mt-1 text-xs text-ink-soft transition-colors group-hover:text-ink">Talabalar oylik yoki yillik to'lov evaziga kurslaringizga kirish huquqini olishadi (Payme, Click orqali).</p>
                  </div>
                  <ChevronRight className="mt-2 h-4 w-4 text-ink-faint transition-all duration-300 group-hover:text-green group-hover:translate-x-1" />
                </div>
              </div>

              <div className="rounded-2xl bg-tint p-4">
                <h4 className="text-xs font-bold text-ink-strong uppercase tracking-wider mb-2">Qo'llab-quvvatlanadigan tizimlar</h4>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-ink-strong border border-rim shadow-sm transition-transform hover:scale-105 cursor-default">Payme</span>
                  <span className="rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-ink-strong border border-rim shadow-sm transition-transform hover:scale-105 cursor-default">Click</span>
                  <span className="rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-ink-strong border border-rim shadow-sm transition-transform hover:scale-105 cursor-default">Uzum Pay</span>
                  <span className="rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-ink-strong border border-rim shadow-sm transition-transform hover:scale-105 cursor-default">Visa / Mastercard</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
