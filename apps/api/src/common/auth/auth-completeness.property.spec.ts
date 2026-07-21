import { Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import * as fc from 'fast-check';
import 'reflect-metadata';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import {
  ALLOWED_ROLES,
  inspectControllerClasses,
  MissingGuardRoute,
} from './auth-completeness';

/**
 * Property 7 — Authorization completeness
 * (Task 9.4 from .kiro/specs/edubridge-platform/tasks.md)
 *
 * For any synthetic controller graph with arbitrary mixes of `@Public()`,
 * `@Roles(...)`, `@UseGuards(...)` (or none of them), the static inspector
 * `inspectControllerClasses` must return EXACTLY the set of leaks predicted
 * by the spec — no false positives, no false negatives — across the three
 * failure modes the platform recognises:
 *
 *   - NO_AUTH       — non-public route with no auth guard in effect
 *   - NO_ROLES      — non-public, authenticated route with no `@Roles()`
 *   - INVALID_ROLES — `@Roles(...)` references a role outside
 *                     {STUDENT, TEACHER, ADMIN}
 *
 * The "oracle" below is a direct reading of the contract documented in
 * `auth-completeness.ts`. Each fast-check run generates a fresh world
 * (controllers, handlers, decorators, global auth wiring) and we assert
 * that the inspector's report matches the oracle.
 *
 * This file ONLY implements Property 7 from the design document.
 *
 * **Validates: Requirements 17.1, 17.2, 17.3, 17.4, 17.5, 17.6**
 */

// ----------------------------------------------------------------------------
// Constants mirroring the inspector's internals
// ----------------------------------------------------------------------------

const GUARDS_METADATA_KEY = '__guards__';
const ALLOWED_ROLE_SET = new Set<string>(ALLOWED_ROLES);
const INVALID_ROLE_VALUES = ['SUPERADMIN', 'OWNER', 'GUEST', 'ROOT'] as const;

// Synthetic guard classes. Their *names* are what the inspector keys on
// (via `__guards__` metadata + the `authGuardNames` option), so they need
// no behaviour beyond having a stable `.name`.
class FakeAuthGuard {
  canActivate() {
    return true;
  }
}
class FakeDomainGuard {
  canActivate() {
    return true;
  }
}
class FakeOtherGuard {
  canActivate() {
    return true;
  }
}

type GuardClass =
  | typeof FakeAuthGuard
  | typeof FakeDomainGuard
  | typeof FakeOtherGuard;

// ----------------------------------------------------------------------------
// Generators
// ----------------------------------------------------------------------------

const guardSubsetArb: fc.Arbitrary<GuardClass[]> = fc
  .record({
    hasAuth: fc.boolean(),
    hasDomain: fc.boolean(),
    hasOther: fc.boolean(),
  })
  .map(({ hasAuth, hasDomain, hasOther }) => {
    const out: GuardClass[] = [];
    if (hasAuth) out.push(FakeAuthGuard);
    if (hasDomain) out.push(FakeDomainGuard);
    if (hasOther) out.push(FakeOtherGuard);
    return out;
  });

// A role token is either a real platform role or a typo / made-up role
// that should be flagged INVALID_ROLES.
const roleTokenArb = fc.oneof(
  fc.constantFrom<string>(...ALLOWED_ROLES),
  fc.constantFrom<string>(...INVALID_ROLE_VALUES),
);

/**
 * The three observable states of @Roles metadata:
 *   - `undefined` — decorator was never applied
 *   - `[]`        — decorator was applied with no arguments (a misuse)
 *   - `[...]`     — decorator was applied with one or more role tokens
 *
 * The inspector treats the first two as NO_ROLES and the third as either
 * pass or INVALID_ROLES depending on token validity.
 */
const rolesMetadataArb: fc.Arbitrary<string[] | undefined> = fc.oneof(
  fc.constant(undefined as string[] | undefined),
  fc.constant([] as string[]),
  fc.array(roleTokenArb, { minLength: 1, maxLength: 4 }),
);

interface RawHandler {
  isPublic: boolean;
  roles: string[] | undefined;
  guards: GuardClass[];
  pathSeed: string;
}

const rawHandlerArb: fc.Arbitrary<RawHandler> = fc.record({
  isPublic: fc.boolean(),
  roles: rolesMetadataArb,
  guards: guardSubsetArb,
  pathSeed: fc.constantFrom('', 'list', 'one', 'create', 'detail'),
});

interface RawController {
  classPublic: boolean;
  classRoles: string[] | undefined;
  classGuards: GuardClass[];
  pathSeed: string;
  handlers: RawHandler[];
}

const rawControllerArb: fc.Arbitrary<RawController> = fc.record({
  classPublic: fc.boolean(),
  classRoles: rolesMetadataArb,
  classGuards: guardSubsetArb,
  pathSeed: fc.constantFrom('', 'a', 'b', 'foo', 'bar'),
  handlers: fc.array(rawHandlerArb, { minLength: 1, maxLength: 4 }),
});

interface Scenario {
  controllers: RawController[];
  /** when true, `globalAuthGuards = [FakeAuthGuard]` (mirrors APP_GUARD wiring). */
  globalAuth: boolean;
  /** when true, options.authGuardNames includes 'FakeDomainGuard'. */
  includeDomainAuthName: boolean;
  /** when false, the legacy guard-only contract is exercised (no NO_ROLES / INVALID_ROLES). */
  requireRoles: boolean;
}

const scenarioArb: fc.Arbitrary<Scenario> = fc.record({
  controllers: fc.array(rawControllerArb, { minLength: 1, maxLength: 5 }),
  globalAuth: fc.boolean(),
  includeDomainAuthName: fc.boolean(),
  requireRoles: fc.boolean(),
});

// ----------------------------------------------------------------------------
// Builder — turns a raw spec into a real class with NestJS-shaped metadata
// ----------------------------------------------------------------------------

interface ResolvedHandler extends RawHandler {
  name: string;
  path: string;
}

interface ResolvedController extends Omit<RawController, 'handlers'> {
  name: string;
  path: string;
  handlers: ResolvedHandler[];
}

function resolveScenario(scenario: Scenario): ResolvedController[] {
  return scenario.controllers.map((c, ci) => ({
    ...c,
    name: `Synth${ci}Controller`,
    path: c.pathSeed,
    handlers: c.handlers.map((h, hi) => ({
      ...h,
      // unique within the controller — drives `methodName` in the report.
      name: `h${ci}_${hi}`,
      path: h.pathSeed,
    })),
  }));
}

function buildControllerClass(spec: ResolvedController): Type<unknown> {
  // A fresh anonymous class per generation so prior runs cannot leak
  // metadata into the next one.
  const Synth = class {};
  Object.defineProperty(Synth, 'name', {
    value: spec.name,
    configurable: true,
  });

  Reflect.defineMetadata(PATH_METADATA, spec.path, Synth);
  if (spec.classPublic) {
    Reflect.defineMetadata(IS_PUBLIC_KEY, true, Synth);
  }
  if (spec.classRoles !== undefined) {
    Reflect.defineMetadata(ROLES_KEY, spec.classRoles, Synth);
  }
  if (spec.classGuards.length > 0) {
    Reflect.defineMetadata(GUARDS_METADATA_KEY, spec.classGuards, Synth);
  }

  for (const h of spec.handlers) {
    // Each handler is a fresh function — METHOD_METADATA on it is what
    // the inspector uses to recognise "this method is a route".
    const fn = function () {
      return undefined;
    };
    Reflect.defineMetadata(METHOD_METADATA, /* RequestMethod.GET */ 0, fn);
    Reflect.defineMetadata(PATH_METADATA, h.path, fn);
    if (h.isPublic) {
      Reflect.defineMetadata(IS_PUBLIC_KEY, true, fn);
    }
    if (h.roles !== undefined) {
      Reflect.defineMetadata(ROLES_KEY, h.roles, fn);
    }
    if (h.guards.length > 0) {
      Reflect.defineMetadata(GUARDS_METADATA_KEY, h.guards, fn);
    }
    (Synth.prototype as Record<string, unknown>)[h.name] = fn;
  }

  return Synth as Type<unknown>;
}

// ----------------------------------------------------------------------------
// Oracle — the spec, expressed as a pure function over the resolved scenario
// ----------------------------------------------------------------------------

function joinPath(controllerPath: string, handlerPath: string): string {
  const left = controllerPath.replace(/^\/+|\/+$/g, '');
  const right = handlerPath.replace(/^\/+|\/+$/g, '');
  if (!left && !right) return '/';
  if (!left) return `/${right}`;
  if (!right) return `/${left}`;
  return `/${left}/${right}`;
}

function computeExpected(
  specs: ResolvedController[],
  globalAuthGuardNames: ReadonlyArray<string>,
  extraAuthGuardNames: ReadonlyArray<string>,
  requireRoles: boolean,
): MissingGuardRoute[] {
  const authGuardNameSet = new Set<string>([
    ...globalAuthGuardNames,
    ...extraAuthGuardNames,
  ]);
  const hasGlobalAuth = authGuardNameSet.size > 0;
  const expected: MissingGuardRoute[] = [];

  for (const c of specs) {
    for (const h of c.handlers) {
      const isPublic = c.classPublic || h.isPublic;
      if (isPublic) continue;

      const allGuardNames = [...c.classGuards, ...h.guards].map((g) => g.name);
      const guardCovered = allGuardNames.some((n) => authGuardNameSet.has(n));
      const path = joinPath(c.path, h.path);

      if (!hasGlobalAuth && !guardCovered) {
        expected.push({
          controller: c.name,
          handler: h.name,
          path,
          reason: 'NO_AUTH',
        });
        continue;
      }

      if (!requireRoles) continue;

      const handlerRolesPresent = h.roles !== undefined;
      const effectiveRoles = handlerRolesPresent ? h.roles : c.classRoles;

      if (effectiveRoles === undefined || effectiveRoles.length === 0) {
        expected.push({
          controller: c.name,
          handler: h.name,
          path,
          reason: 'NO_ROLES',
        });
        continue;
      }

      const invalid = effectiveRoles.filter((r) => !ALLOWED_ROLE_SET.has(r));
      if (invalid.length > 0) {
        expected.push({
          controller: c.name,
          handler: h.name,
          path,
          reason: 'INVALID_ROLES',
          roles: effectiveRoles,
        });
      }
    }
  }

  return expected;
}

// Stable ordering so set-equality assertions don't depend on iteration order.
function sortMissing(arr: MissingGuardRoute[]): MissingGuardRoute[] {
  return [...arr].sort((a, b) => {
    const ka = `${a.controller}|${a.handler}|${a.reason}`;
    const kb = `${b.controller}|${b.handler}|${b.reason}`;
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    return 0;
  });
}

// ----------------------------------------------------------------------------
// Property
// ----------------------------------------------------------------------------

describe('auth-completeness — Property 7: Authorization completeness', () => {
  it('inspectControllerClasses(...) reports exactly NO_AUTH ∪ NO_ROLES ∪ INVALID_ROLES leaks for any decorator mix [Validates: Requirements 17.1, 17.2, 17.3, 17.4, 17.5, 17.6]', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const specs = resolveScenario(scenario);
        const controllers = specs.map(buildControllerClass);

        const globalAuthGuards = scenario.globalAuth ? [FakeAuthGuard] : [];
        const authGuardNames = scenario.includeDomainAuthName
          ? ['FakeDomainGuard']
          : undefined;

        const report = inspectControllerClasses(
          controllers,
          globalAuthGuards,
          {
            requireRoles: scenario.requireRoles,
            ...(authGuardNames ? { authGuardNames } : {}),
          },
        );

        const expectedScanned = specs.reduce(
          (sum, c) => sum + c.handlers.length,
          0,
        );
        if (report.scanned !== expectedScanned) {
          throw new Error(
            `scanned mismatch — got ${report.scanned}, want ${expectedScanned}`,
          );
        }

        const expected = computeExpected(
          specs,
          globalAuthGuards.map((g) => g.name),
          authGuardNames ?? [],
          scenario.requireRoles,
        );

        const got = sortMissing(report.missing);
        const want = sortMissing(expected);

        // Use deep-equal via JSON for clear shrinking output.
        expect(got).toEqual(want);
      }),
      { numRuns: 200 },
    );
  });
});
