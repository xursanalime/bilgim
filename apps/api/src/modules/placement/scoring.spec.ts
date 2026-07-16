import {
  CEFR_THRESHOLDS,
  PerSkillScore,
  ratioToCefrLevel,
  scoreAssessment,
} from './scoring';
import { PLACEMENT_QUESTION_BANK, PLACEMENT_SKILLS } from './question-bank';

/** All-correct answer set (selected option index === correctOption). */
const allCorrect = PLACEMENT_QUESTION_BANK.map((q) => ({
  questionRef: q.questionRef,
  answer: q.correctOption,
}));

/** All-wrong answer set (an index that is never the key). */
const allWrong = PLACEMENT_QUESTION_BANK.map((q) => ({
  questionRef: q.questionRef,
  answer: -1,
}));

/**
 * Pure scoring → CEFR mapping unit tests (Task 3.2, Req 5.2, 5.5). These run
 * without Nest/Prisma since `scoring.ts` is dependency-free.
 */
describe('scoring → CEFR mapping', () => {
  describe('ratioToCefrLevel (threshold mapping)', () => {
    it('is a total function: every ratio in [0,1] maps to a valid CEFR level', () => {
      for (let r = 0; r <= 1.0001; r += 0.05) {
        expect(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']).toContain(
          ratioToCefrLevel(r),
        );
      }
    });

    it('maps the documented boundary points deterministically', () => {
      expect(ratioToCefrLevel(0)).toBe('A1');
      expect(ratioToCefrLevel(0.14)).toBe('A1');
      expect(ratioToCefrLevel(0.15)).toBe('A2');
      expect(ratioToCefrLevel(0.34)).toBe('A2');
      expect(ratioToCefrLevel(0.35)).toBe('B1');
      expect(ratioToCefrLevel(0.54)).toBe('B1');
      expect(ratioToCefrLevel(0.55)).toBe('B2');
      expect(ratioToCefrLevel(0.74)).toBe('B2');
      expect(ratioToCefrLevel(0.75)).toBe('C1');
      expect(ratioToCefrLevel(0.89)).toBe('C1');
      expect(ratioToCefrLevel(0.9)).toBe('C2');
      expect(ratioToCefrLevel(1)).toBe('C2');
    });

    it('is monotonic non-decreasing in the ratio', () => {
      const order = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
      let prev = 0;
      for (let r = 0; r <= 1.0; r += 0.01) {
        const idx = order.indexOf(ratioToCefrLevel(r));
        expect(idx).toBeGreaterThanOrEqual(prev);
        prev = idx;
      }
    });

    it('thresholds are ordered ascending and terminate at Infinity', () => {
      for (let i = 1; i < CEFR_THRESHOLDS.length; i++) {
        expect(CEFR_THRESHOLDS[i]!.maxExclusive).toBeGreaterThan(
          CEFR_THRESHOLDS[i - 1]!.maxExclusive,
        );
      }
      expect(CEFR_THRESHOLDS[CEFR_THRESHOLDS.length - 1]!.maxExclusive).toBe(
        Number.POSITIVE_INFINITY,
      );
    });
  });

  describe('scoreAssessment', () => {
    it('produces a per-skill breakdown covering every required skill (Req 5.5)', () => {
      const result = scoreAssessment(allCorrect);
      const skills = result.perSkill.map((s) => s.skill);
      for (const required of PLACEMENT_SKILLS) {
        expect(skills).toContain(required);
      }
    });

    it('awards a perfect (all-correct) assessment the maximum ratio → C2', () => {
      const result = scoreAssessment(allCorrect);
      expect(result.overallRatio).toBeCloseTo(1, 10);
      expect(result.computedLevel).toBe('C2');
      for (const s of result.perSkill) {
        expect(s.correct).toBe(s.total);
        expect(s.ratio).toBeCloseTo(1, 10);
      }
    });

    it('awards an all-wrong assessment a zero ratio → A1', () => {
      const result = scoreAssessment(allWrong);
      expect(result.overallRatio).toBe(0);
      expect(result.computedLevel).toBe('A1');
      for (const s of result.perSkill) {
        expect(s.correct).toBe(0);
        expect(s.weightedScore).toBe(0);
      }
    });

    it('treats missing answers as incorrect (no answer → A1)', () => {
      const result = scoreAssessment([]);
      expect(result.overallRatio).toBe(0);
      expect(result.computedLevel).toBe('A1');
    });

    it('is deterministic: identical answers always yield the same result', () => {
      const a = scoreAssessment(allCorrect);
      const b = scoreAssessment(allCorrect);
      expect(a).toEqual(b);
    });

    it('difficulty-weights items: a correct C1 item outscores a correct A1 item', () => {
      const a1 = PLACEMENT_QUESTION_BANK.find((q) => q.targetLevel === 'A1')!;
      const c1 = PLACEMENT_QUESTION_BANK.find((q) => q.targetLevel === 'C1')!;

      const onlyA1 = scoreAssessment([
        { questionRef: a1.questionRef, answer: a1.correctOption },
      ]);
      const onlyC1 = scoreAssessment([
        { questionRef: c1.questionRef, answer: c1.correctOption },
      ]);

      const earned = (r: { perSkill: PerSkillScore[] }) =>
        r.perSkill.reduce((sum, s) => sum + s.weightedScore, 0);

      expect(earned(onlyC1)).toBeGreaterThan(earned(onlyA1));
    });
  });
});
