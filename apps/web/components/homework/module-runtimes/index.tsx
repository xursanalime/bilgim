'use client';

import {
  WritingRuntime,
  type WritingRuntimeConfig,
  type WritingRuntimeAnswer,
} from './writing-runtime';
import {
  ReadingRuntime,
  type ReadingRuntimeConfig,
  type ReadingRuntimeAnswer,
} from './reading-runtime';
import {
  ListeningRuntime,
  type ListeningRuntimeConfig,
  type ListeningRuntimeAnswer,
} from './listening-runtime';
import {
  VocabularyRuntime,
  type VocabularyRuntimeConfig,
  type VocabularyRuntimeAnswer,
} from './vocabulary-runtime';
import {
  GrammarRuntime,
  type GrammarRuntimeConfig,
  type GrammarRuntimeAnswer,
} from './grammar-runtime';
import {
  SpeakingRuntime,
  type SpeakingRuntimeConfig,
  type SpeakingRuntimeAnswer,
} from './speaking-runtime';
import {
  GapFillRuntime,
  type GapFillRuntimeConfig,
  type GapFillRuntimeAnswer,
} from './gap-fill-runtime';
import type {
  AssignmentModule,
  HomeworkModuleType,
} from '../../../lib/api/homework';

/**
 * Module runtime registry — picks the right renderer for an
 * `AssignmentModule.type`. Modules without a UI runtime fall back to a
 * "not yet supported" hint so a forward-compat module type does not
 * break the page.
 */

interface ModuleRendererProps {
  module: AssignmentModule;
  initialAnswer: unknown;
  editable: boolean;
  onChange: (answer: unknown) => void;
  onAutosave?: ((answer: unknown) => Promise<void>) | undefined;
}

export function ModuleRenderer({
  module,
  initialAnswer,
  editable,
  onChange,
  onAutosave,
}: ModuleRendererProps) {
  switch (module.type) {
    case 'WRITING': {
      const config = (module.configJson ?? {}) as WritingRuntimeConfig;
      return (
        <WritingRuntime
          config={config}
          initialAnswer={(initialAnswer as WritingRuntimeAnswer | null) ?? null}
          editable={editable}
          onChange={(a) => onChange(a)}
          onAutosave={
            onAutosave ? (a) => onAutosave(a as unknown) : undefined
          }
        />
      );
    }
    case 'READING': {
      const config = (module.configJson ?? {}) as ReadingRuntimeConfig;
      return (
        <ReadingRuntime
          config={config}
          initialAnswer={(initialAnswer as ReadingRuntimeAnswer | null) ?? null}
          editable={editable}
          onChange={(a) => onChange(a)}
        />
      );
    }
    case 'LISTENING': {
      const config = (module.configJson ?? {}) as ListeningRuntimeConfig;
      return (
        <ListeningRuntime
          config={config}
          initialAnswer={(initialAnswer as ListeningRuntimeAnswer | null) ?? null}
          editable={editable}
          onChange={(a) => onChange(a)}
        />
      );
    }
    case 'VOCABULARY': {
      const config = (module.configJson ?? {}) as VocabularyRuntimeConfig;
      return (
        <VocabularyRuntime
          config={config}
          initialAnswer={(initialAnswer as VocabularyRuntimeAnswer | null) ?? null}
          editable={editable}
          onChange={(a) => onChange(a)}
        />
      );
    }
    case 'GRAMMAR': {
      const config = (module.configJson ?? {}) as GrammarRuntimeConfig;
      return (
        <GrammarRuntime
          config={config}
          initialAnswer={(initialAnswer as GrammarRuntimeAnswer | null) ?? null}
          editable={editable}
          onChange={(a) => onChange(a)}
        />
      );
    }
    case 'SPEAKING':
    case 'PRONUNCIATION': {
      const config = (module.configJson ?? {}) as SpeakingRuntimeConfig;
      return (
        <SpeakingRuntime
          config={config}
          initialAnswer={(initialAnswer as SpeakingRuntimeAnswer | null) ?? null}
          editable={editable}
          onChange={(a) => onChange(a)}
        />
      );
    }
    case 'GAP_FILL': {
      const config = (module.configJson ?? {}) as GapFillRuntimeConfig;
      return (
        <GapFillRuntime
          config={config}
          initialAnswer={(initialAnswer as GapFillRuntimeAnswer | null) ?? null}
          editable={editable}
          onChange={(a) => onChange(a)}
        />
      );
    }
    default:
      return <UnsupportedModuleNotice type={module.type} />;
  }
}

function UnsupportedModuleNotice({ type }: { type: HomeworkModuleType }) {
  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
      Bu modul turi ({type}) hali brauzerda qo&apos;llab-quvvatlanmaydi.
      O&apos;qituvchingizdan boshqa formatda topshirishni so&apos;rang.
    </div>
  );
}

export const MODULE_TYPE_LABELS: Record<HomeworkModuleType, string> = {
  WRITING: "Yozma ish",
  READING: "Oʻqish",
  LISTENING: "Tinglash",
  GRAMMAR: "Grammatika",
  SPELLING: "Imlo",
  VOCABULARY: "Lugʻat (Flashcard)",
  SPEAKING: "Gapirish",
  PRONUNCIATION: "Talaffuz",
  MULTIPLE_CHOICE: "Test (variantlar)",
  GAP_FILL: "Boʻsh joy toʻldirish",
  MATCHING: "Mos qoʻying",
  DRAG_DROP: "Sudrab tashlash",
  PROJECT_SUBMISSION: "Loyiha topshirish",
  CASE_STUDY: "Case study",
  MARKETING_COPY: "Marketing matni",
  AUDIENCE_ANALYSIS: "Auditoriya tahlili",
  CONTENT_CALENDAR: "Kontent kalendari",
  MATH_WORD_PROBLEM: "Masala (matnli)",
  MATH_EQUATION_SOLVER: "Tenglama yechish",
  MATH_GEOMETRY_PROOF: "Geometriya isboti",
  CODE_REVIEW: "Kod koʻrib chiqish",
  CODE_UNIT_TEST: "Kod testi",
};
