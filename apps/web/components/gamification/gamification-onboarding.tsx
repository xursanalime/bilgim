'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, X, Sparkles, Flame, Award, Trophy } from 'lucide-react';
import { cn } from '../../lib/utils';

const TOUR_STEPS = [
  {
    title: "Gamifikatsiyaga xush kelibsiz!",
    description: "Endi o'rganish yanada qiziqarli! Platformadagi faolligingiz uchun sizga XP (tajriba ballari) beriladi.",
    icon: Sparkles,
    color: "text-blue",
    bg: "bg-blue/10",
  },
  {
    title: "Faollik Seriyasi (Streak)",
    description: "Har kuni tizimga kirib yoki vazifa bajarib olovni saqlang. Ketma-ketlik uzoqroq bo'lsa, bonuslar ko'payadi.",
    icon: Flame,
    color: "text-orange",
    bg: "bg-orange/10",
  },
  {
    title: "Nishonlar va Yutuqlar",
    description: "Maxsus topshiriqlarni bajaring va eksklyuziv nishonlarni (Badges) qo'lga kiriting. Ular profilizni bezab turadi.",
    icon: Award,
    color: "text-purple",
    bg: "bg-purple/10",
  },
  {
    title: "Global Reyting",
    description: "Topshiriqlarni o'z vaqtida bajarib peshqadamlar qatoriga kiring va platformadagi eng yaxshilar bilan bellashing.",
    icon: Trophy,
    color: "text-teal",
    bg: "bg-teal/10",
  }
];

export function GamificationOnboarding() {
  const [isOpen, setIsOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    // Only show once
    const hasSeen = localStorage.getItem('gamification-onboarding-seen');
    if (!hasSeen) {
      // Small delay so page loads first
      const timer = setTimeout(() => setIsOpen(true), 1500);
      return () => clearTimeout(timer);
    }
  }, []);

  function handleClose() {
    setIsOpen(false);
    localStorage.setItem('gamification-onboarding-seen', 'true');
  }

  function handleNext() {
    if (currentStep < TOUR_STEPS.length - 1) {
      setCurrentStep(prev => prev + 1);
    } else {
      handleClose();
    }
  }

  if (!isOpen) return null;

  const step = TOUR_STEPS[currentStep];
  if (!step) return null;
  const Icon = step.icon;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-tint-strong/40 p-4 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="relative w-full max-w-md overflow-hidden rounded-[2rem] bg-white shadow-2xl"
      >
        <button
          onClick={handleClose}
          className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-tint text-ink-faint hover:bg-rim hover:text-ink-strong"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex flex-col items-center p-8 text-center pt-12">
          <motion.div
            key={currentStep}
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', bounce: 0.5 }}
            className={cn("mb-6 flex h-24 w-24 items-center justify-center rounded-[2rem]", step.bg)}
          >
            <Icon className={cn("h-12 w-12", step.color)} />
          </motion.div>

          <h2 className="mb-3 font-display text-2xl font-extrabold text-ink-strong">
            {step.title}
          </h2>
          <p className="min-h-[60px] text-sm leading-relaxed text-ink-soft">
            {step.description}
          </p>

          <div className="mt-8 flex w-full items-center justify-between">
            <div className="flex gap-1.5">
              {TOUR_STEPS.map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    "h-1.5 rounded-full transition-all duration-300",
                    i === currentStep ? "w-6 bg-blue" : "w-1.5 bg-rim"
                  )}
                />
              ))}
            </div>

            <button
              onClick={handleNext}
              className="flex items-center gap-2 rounded-2xl bg-blue px-6 py-3 text-sm font-bold text-white shadow-blue-soft transition-all hover:bg-blue-600 active:scale-95"
            >
              {currentStep === TOUR_STEPS.length - 1 ? "Boshladik!" : "Keyingisi"}
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
