import fc from 'fast-check';

import { findBasicA11yViolations } from './a11y';

/**
 * Feature: web-accessibility
 *
 * Property 1: Positive-tabindex detection is sound and complete.
 *
 * For any generated DOM container, `findBasicA11yViolations` reports a
 * `positive-tabindex` violation IF AND ONLY IF the container holds at least one
 * element whose `tabindex` attribute parses (via `Number()`) to a finite value
 * greater than 0. Containers built only from elements with no `tabindex`, or
 * `tabindex="0"` / `tabindex="-1"`, must never trigger the rule.
 *
 * Validates: Requirements 5.2, 8.2
 */

/** The kinds of tabindex an element in our generated DOM may carry. */
type TabindexKind = 'none' | 'zero' | 'negative' | 'positive';

interface ElementSpec {
  readonly kind: TabindexKind;
  /** Concrete positive value used when kind === 'positive'. */
  readonly positiveValue: number;
}

/**
 * Generates a single element spec. Positive values are drawn from [1, 50] so
 * the generated tabindex is unambiguously > 0.
 */
const elementSpecArb: fc.Arbitrary<ElementSpec> = fc.record({
  kind: fc.constantFrom<TabindexKind>('none', 'zero', 'negative', 'positive'),
  positiveValue: fc.integer({ min: 1, max: 50 }),
});

/** Build a real DOM wrapper <div> from a list of element specs. */
function buildContainer(specs: readonly ElementSpec[]): HTMLDivElement {
  const wrapper = document.createElement('div');
  for (const spec of specs) {
    const el = document.createElement('span');
    switch (spec.kind) {
      case 'none':
        break;
      case 'zero':
        el.setAttribute('tabindex', '0');
        break;
      case 'negative':
        el.setAttribute('tabindex', '-1');
        break;
      case 'positive':
        el.setAttribute('tabindex', String(spec.positiveValue));
        break;
    }
    wrapper.appendChild(el);
  }
  return wrapper;
}

describe('Feature: web-accessibility, Property 1: positive-tabindex detection is sound and complete', () => {
  it('reports a positive-tabindex violation iff some element has a numeric tabindex > 0', () => {
    fc.assert(
      fc.property(fc.array(elementSpecArb, { maxLength: 20 }), (specs) => {
        const container = buildContainer(specs);

        const expectedPositive = specs.some((s) => s.kind === 'positive');
        const detectedPositive = findBasicA11yViolations(container).some(
          (v) => v.rule === 'positive-tabindex',
        );

        expect(detectedPositive).toBe(expectedPositive);
      }),
      { numRuns: 100 },
    );
  });
});
