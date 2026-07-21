'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft, ChevronRight, RotateCcw, Volume2,
  CheckCircle2, XCircle, Shuffle, Eye,
} from 'lucide-react';
import { cn } from '../../../lib/utils';

export interface FlashCard {
  id: string;
  word: string;
  translation: string;
  example?: string;
  exampleTranslation?: string;
  partOfSpeech?: string;
  imageUrl?: string;
}

export interface VocabularyRuntimeConfig {
  cards: FlashCard[];
  studyMode: 'flashcard' | 'quiz' | 'both';
}

export interface VocabularyRuntimeAnswer {
  known: string[];
  unknown: string[];
  completedAt?: string | undefined;
}

interface Props {
  config: VocabularyRuntimeConfig;
  initialAnswer: VocabularyRuntimeAnswer | null;
  editable: boolean;
  onChange: (answer: VocabularyRuntimeAnswer) => void;
}

export function VocabularyRuntime({ config, initialAnswer, editable, onChange }: Props) {
  const [cards, setCards] = useState<FlashCard[]>(() => [...config.cards]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [known, setKnown] = useState<string[]>(initialAnswer?.known ?? []);
  const [unknown, setUnknown] = useState<string[]>(initialAnswer?.unknown ?? []);
  const [mode, setMode] = useState<'study' | 'results'>('study');
  const [showExample, setShowExample] = useState(false);

  const current = cards[index];
  const total = cards.length;
  const doneCount = known.length + unknown.length;
  const progress = total > 0 ? (doneCount / total) * 100 : 0;

  useEffect(() => {
    onChange({ known, unknown, completedAt: mode === 'results' ? new Date().toISOString() : undefined });
  }, [known, unknown, mode]); // eslint-disable-line

  const speak = useCallback((text: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 0.85;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }, []);

  const markKnown = () => {
    if (!current || !editable) return;
    setKnown((p) => [...p, current.id]);
    next();
  };

  const markUnknown = () => {
    if (!current || !editable) return;
    setUnknown((p) => [...p, current.id]);
    next();
  };

  const next = () => {
    if (index + 1 >= total) {
      setMode('results');
    } else {
      setIndex((i) => i + 1);
      setFlipped(false);
      setShowExample(false);
    }
  };

  const prev = () => {
    if (index > 0) {
      setIndex((i) => i - 1);
      setFlipped(false);
      setShowExample(false);
    }
  };

  const shuffle = () => {
    setCards((c) => [...c].sort(() => Math.random() - 0.5));
    setIndex(0);
    setFlipped(false);
    setShowExample(false);
    setKnown([]);
    setUnknown([]);
    setMode('study');
  };

  const restart = () => {
    setIndex(0);
    setFlipped(false);
    setShowExample(false);
    setKnown([]);
    setUnknown([]);
    setMode('study');
    setCards([...config.cards]);
  };

  // Results screen
  if (mode === 'results') {
    return (
      <div className="flex flex-col items-center py-8 space-y-6">
        <div className="h-20 w-20 rounded-[2rem] bg-gradient-to-br from-green/20 to-blue/20 border border-green/20 flex items-center justify-center">
          <CheckCircle2 className="h-10 w-10 text-green" />
        </div>
        <div className="text-center">
          <h3 className="text-xl font-black text-white mb-1">Mashq tugadi!</h3>
          <p className="text-sm text-white/50">
            {total} ta so'zdan {known.length} tasini bilasiz
          </p>
        </div>

        {/* Progress bars */}
        <div className="w-full max-w-xs space-y-3">
          <div className="flex items-center justify-between text-xs text-white/50 font-bold">
            <span className="flex items-center gap-1.5 text-green">
              <CheckCircle2 className="h-3.5 w-3.5" /> Bilaman
            </span>
            <span className="font-black text-white">{known.length}/{total}</span>
          </div>
          <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
            <div
              className="h-full rounded-full bg-green transition-all"
              style={{ width: `${total > 0 ? (known.length / total) * 100 : 0}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-xs text-white/50 font-bold mt-2">
            <span className="flex items-center gap-1.5 text-orange">
              <XCircle className="h-3.5 w-3.5" /> Qayta o'rganish kerak
            </span>
            <span className="font-black text-white">{unknown.length}/{total}</span>
          </div>
          <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
            <div
              className="h-full rounded-full bg-orange transition-all"
              style={{ width: `${total > 0 ? (unknown.length / total) * 100 : 0}%` }}
            />
          </div>
        </div>

        {unknown.length > 0 && editable && (
          <button
            onClick={() => {
              setCards(config.cards.filter((c) => unknown.includes(c.id)));
              setIndex(0);
              setFlipped(false);
              setShowExample(false);
              setKnown([]);
              setUnknown([]);
              setMode('study');
            }}
            className="rounded-2xl bg-orange/20 border border-orange/30 px-6 py-3 text-sm font-black text-orange hover:bg-orange/30 transition-all"
          >
            Bilmagan so'zlarni qayta mashq qilish ({unknown.length} ta)
          </button>
        )}

        <button
          onClick={restart}
          className="flex items-center gap-2 rounded-2xl border border-white/[0.08] px-5 py-2.5 text-sm font-bold text-white/60 hover:text-white hover:border-white/[0.15] transition-all"
        >
          <RotateCcw className="h-4 w-4" /> Boshidan boshlash
        </button>
      </div>
    );
  }

  if (!current) return null;

  return (
    <div className="space-y-5">
      {/* Progress */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px] font-bold text-white/40">
          <span>{index + 1} / {total}</span>
          <button onClick={shuffle} className="flex items-center gap-1 hover:text-white/60 transition-colors">
            <Shuffle className="h-3.5 w-3.5" /> Aralashtirish
          </button>
        </div>
        <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
          <div
            className="h-full rounded-full bg-blue transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex gap-1">
          {cards.map((c, i) => (
            <div
              key={c.id}
              className={cn(
                'h-1 flex-1 rounded-full transition-colors',
                known.includes(c.id) ? 'bg-green' :
                unknown.includes(c.id) ? 'bg-orange/60' :
                i === index ? 'bg-blue' : 'bg-white/[0.08]'
              )}
            />
          ))}
        </div>
      </div>

      {/* Flashcard */}
      <div
        className="relative cursor-pointer select-none"
        style={{ perspective: '1000px' }}
        onClick={() => setFlipped((f) => !f)}
      >
        <motion.div
          style={{ transformStyle: 'preserve-3d' }}
          animate={{ rotateY: flipped ? 180 : 0 }}
          transition={{ duration: 0.45, type: 'spring', damping: 20 }}
          className="relative"
        >
          {/* Front */}
          <div
            className="rounded-3xl border border-white/[0.08] bg-gradient-to-br from-[#14141f] to-[#1a1a2e] p-8 min-h-[220px] flex flex-col items-center justify-center text-center"
            style={{ backfaceVisibility: 'hidden' }}
          >
            <div className="flex items-center gap-2 mb-6">
              {current.partOfSpeech && (
                <span className="text-[10px] font-black uppercase tracking-widest text-blue/60 bg-blue/10 px-2.5 py-1 rounded-full">
                  {current.partOfSpeech}
                </span>
              )}
            </div>
            <h2 className="text-4xl font-black text-white tracking-tight mb-3">{current.word}</h2>
            <button
              onClick={(e) => { e.stopPropagation(); speak(current.word); }}
              className="flex items-center gap-2 text-xs font-bold text-white/30 hover:text-white/60 transition-colors mt-2"
            >
              <Volume2 className="h-3.5 w-3.5" /> Talaffuz
            </button>
            <p className="text-[11px] text-white/20 mt-6">Kartani tilt qilish uchun bosing</p>
          </div>

          {/* Back */}
          <div
            className="absolute inset-0 rounded-3xl border border-blue/20 bg-gradient-to-br from-blue/10 to-purple/10 p-8 min-h-[220px] flex flex-col items-center justify-center text-center"
            style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
          >
            <p className="text-2xl font-black text-white mb-3">{current.translation}</p>

            {current.example && (
              <div className="mt-4 space-y-1.5">
                <p className="text-sm text-white/60 italic">"{current.example}"</p>
                {current.exampleTranslation && (
                  <p className="text-xs text-white/40 italic">"{current.exampleTranslation}"</p>
                )}
              </div>
            )}

            <button
              onClick={(e) => { e.stopPropagation(); speak(current.word); }}
              className="flex items-center gap-2 text-xs font-bold text-white/30 hover:text-white/60 transition-colors mt-4"
            >
              <Volume2 className="h-3.5 w-3.5" /> Talaffuz
            </button>
          </div>
        </motion.div>
      </div>

      {/* Actions */}
      {editable && flipped && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex gap-3"
        >
          <button
            onClick={markUnknown}
            className="flex-1 flex items-center justify-center gap-2 rounded-2xl border border-orange/30 bg-orange/10 py-3.5 text-sm font-black text-orange hover:bg-orange/20 transition-all active:scale-95"
          >
            <XCircle className="h-4 w-4" /> Bilmayman
          </button>
          <button
            onClick={markKnown}
            className="flex-1 flex items-center justify-center gap-2 rounded-2xl border border-green/30 bg-green/10 py-3.5 text-sm font-black text-green hover:bg-green/20 transition-all active:scale-95"
          >
            <CheckCircle2 className="h-4 w-4" /> Bilaman
          </button>
        </motion.div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={prev}
          disabled={index === 0}
          className="h-10 w-10 rounded-xl border border-white/[0.08] flex items-center justify-center text-white/40 hover:text-white hover:border-white/[0.15] transition-all disabled:opacity-20"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <p className="text-xs font-bold text-white/30">
          {flipped ? 'Tarjimasi' : 'So\'z'} ko'rinmoqda
        </p>

        <button
          onClick={next}
          disabled={index >= total - 1}
          className="h-10 w-10 rounded-xl border border-white/[0.08] flex items-center justify-center text-white/40 hover:text-white hover:border-white/[0.15] transition-all disabled:opacity-20"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
