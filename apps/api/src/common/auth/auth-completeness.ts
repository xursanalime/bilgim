import { INestApplication, Logger, Type } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * The three roles the platform recognizes (Req 17.1). Anything outside this
 * set is treated as misconfiguration.
 */
export const ALLOWED_ROLES = ['STUDENT', 'TEACHER', 'ADMIN'] as const;
export type AllowedRole = (typeof ALLOWED_ROLES)[number];
const ALLOWED_ROLE_SET = new Set<string>(ALLOWED_ROLES);

/**
 * Failure modes recorded by the scanner. Each entry pinpoints the
 * controller/handler/path so it can be fixed without grep-spelunking.
 */
export type AuthCompletenessIssueReason =
  | 'NO_AUTH'
  | 'NO_ROLES'
  | 'INVALID_ROLES';

export interface MissingGuardRoute {
  controller: string;
  handler: string;
  path: string;
  reason: AuthCompletenessIssueReason;
  /** Roles seen on the route, when applicable (only set for INVALID_ROLES). */
  roles?: string[];
}

export interface AuthCompletenessOptions {
  /**
   * Names of guard classes that satisfy the "JWT auth in effect" check.
   * The default `JwtAuthGuard` is wired globally; this list adds extra guards
   * that imply authentication (e.g. `LessonAccessGuard` already requires
   * `request.user`).
   */
  authGuardNames?: string[];
  /**
   * When true, every non-public route MUST also declare `@Roles(...)` with
   * at least one role from {STUDENT, TEACHER, ADMIN}. Defaults to true; the
   * legacy "guard-only" mode is preserved by passing `false`.
   *
   * Requirements 17.1, 17.4, 17.5, 17.6.
   */
  requireRoles?: boolean;
}

export interface AuthCompletenessReport {
  scanned: number;
  missing: MissingGuardRoute[];
}

const GUARDS_METADATA_KEY = '__guards__';

/**
 * Walk every controller route and verify that EITHER:
 *   - the handler/class has `@Public()` metadata, OR
 *   - a JWT auth guard is in effect (global or per-route) AND the route
 *     declares an explicit `@Roles(...)` from {STUDENT, TEACHER, ADMIN}.
 *
 * The role check can be disabled with `requireRoles: false` to keep the
 * legacy contract for callers that only need the auth-guard scan.
 *
 * Globally registered guards count: when the app wires `JwtAuthGuard` via
 * `APP_GUARD`, every non-public route is implicitly authenticated. Callers
 * pass that fact explicitly via `globalAuthGuards`.
 *
 * The check is intentionally fail-closed: if `globalAuthGuards` is empty and a
 * route does not declare its own auth guard, we report it as missing. This
 * prevents accidentally exposing controllers when the global guard wiring is
 * removed or misconfigured.
 *
 * Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6.
 */
export function inspectAuthCompleteness(
  app: INestApplication,
  globalAuthGuards: ReadonlyArray<Type<unknown>> = [],
  options: AuthCompletenessOptions = {},
): AuthCompletenessReport {
  const discovery = app.get(DiscoveryService);
  const scanner = app.get(MetadataScanner);
  const reflector = app.get(Reflector);

  const controllers = discovery
    .getControllers()
    .map((wrapper) => wrapper.metatype as Type<unknown> | null)
    .filter((m): m is Type<unknown> => typeof m === 'function');

  return inspectControllerClasses(controllers, globalAuthGuards, options, {
    reflector,
    scanner,
  });
}

/**
 * Static / class-based variant — walks the same metadata as
 * `inspectAuthCompleteness` but does NOT require a live Nest app. Useful for
 * unit tests and CI lint-style checks where booting the full DI graph is
 * undesirable.
 *
 * Requirements: 17.1, 17.2, 17.3, 17.4.
 */
export function inspectControllerClasses(
  controllers: ReadonlyArray<Type<unknown>>,
  globalAuthGuards: ReadonlyArray<Type<unknown>> = [],
  options: AuthCompletenessOptions = {},
  deps?: { reflector?: Reflector; scanner?: MetadataScanner },
): AuthCompletenessReport {
  const reflector = deps?.reflector ?? new Reflector();
  const scanner = deps?.scanner ?? new MetadataScanner();

  const authGuardNameSet = new Set<string>([
    ...globalAuthGuards.map((g) => g.name),
    ...(options.authGuardNames ?? []),
  ]);
  const hasGlobalAuth = authGuardNameSet.size > 0;
  const requireRoles = options.requireRoles ?? true;

  const missing: MissingGuardRoute[] = [];
  let scanned = 0;

  for (const metatype of controllers) {
    const proto = metatype.prototype;
    if (!proto) continue;

    const controllerName = metatype.name ?? 'AnonymousController';
    const controllerPath: string =
      Reflect.getMetadata(PATH_METADATA, metatype) ?? '';
    const classPublic = !!reflector.get<boolean>(IS_PUBLIC_KEY, metatype);
    const classGuards = readGuardNames(metatype);
    const classRoles = readRoles(reflector, metatype);

    for (const methodName of scanner.getAllMethodNames(proto)) {
      const handler = (proto as Record<string, unknown>)[methodName];
      if (typeof handler !== 'function') continue;
      const httpMethod = Reflect.getMetadata(METHOD_METADATA, handler);
      if (httpMethod === undefined) continue; // not a route
      scanned += 1;

      const handlerPath: string =
        Reflect.getMetadata(PATH_METADATA, handler) ?? '';
      const path = joinPath(controllerPath, handlerPath);
      const isPublic =
        classPublic || !!reflector.get<boolean>(IS_PUBLIC_KEY, handler);

      if (isPublic) continue;

      const handlerGuards = readGuardNames(handler);
      const guardCovered = [...classGuards, ...handlerGuards].some((name) =>
        authGuardNameSet.has(name),
      );

      if (!hasGlobalAuth && !guardCovered) {
        missing.push({
          controller: controllerName,
          handler: methodName,
          path,
          reason: 'NO_AUTH',
        });
        continue;
      }

      if (!requireRoles) continue;

      const handlerRoles = readRoles(reflector, handler);
      const effectiveRoles =
        handlerRoles !== undefined ? handlerRoles : classRoles;

      if (effectiveRoles === undefined || effectiveRoles.length === 0) {
        missing.push({
          controller: controllerName,
          handler: methodName,
          path,
          reason: 'NO_ROLES',
        });
        continue;
      }

      const invalid = effectiveRoles.filter(
        (role) => !ALLOWED_ROLE_SET.has(role),
      );
      if (invalid.length > 0) {
        missing.push({
          controller: controllerName,
          handler: methodName,
          path,
          reason: 'INVALID_ROLES',
          roles: effectiveRoles,
        });
      }
    }
  }

  return { scanned, missing };
}

/**
 * Hard-fail variant invoked at bootstrap to make the app refuse to start
 * if any route is unguarded or missing an explicit @Roles declaration.
 * Logs a structured report and throws.
 *
 * Requirements: 17.2, 17.3, 17.4, 17.5, 17.6.
 */
export function assertAuthCompleteness(
  app: INestApplication,
  globalAuthGuards: ReadonlyArray<Type<unknown>>,
  options: AuthCompletenessOptions = {},
): AuthCompletenessReport {
  const logger = new Logger('AuthCompleteness');
  const report = inspectAuthCompleteness(app, globalAuthGuards, options);

  if (report.missing.length > 0) {
    const formatted = report.missing
      .map((m) => `  - [${m.reason}] ${m.controller}.${m.handler} (${m.path || '/'})${
        m.roles ? ` roles=${JSON.stringify(m.roles)}` : ''
      }`)
      .join('\n');
    const msg = `Auth completeness check failed — every non-public route must have JwtAuthGuard + @Roles(STUDENT|TEACHER|ADMIN):\n${formatted}`;
    logger.error(msg);
    throw new Error(msg);
  }

  logger.log(
    `Auth completeness OK — ${report.scanned} routes scanned, all protected or @Public()`,
  );
  return report;
}

function readGuardNames(target: unknown): string[] {
  if (!target) return [];
  const guards = Reflect.getMetadata(GUARDS_METADATA_KEY, target as object);
  if (!Array.isArray(guards)) return [];
  return guards
    .map((g: any) => {
      if (typeof g === 'function') return g.name;
      if (g && typeof g === 'object' && typeof g.constructor === 'function') {
        return g.constructor.name;
      }
      return undefined;
    })
    .filter((n): n is string => typeof n === 'string');
}

/**
 * Read the `@Roles(...)` metadata from a target. Returns:
 *   - `undefined` when no metadata is set,
 *   - an array (possibly empty) when the decorator was applied.
 *
 * The distinction matters: an empty array means the developer wrote
 * `@Roles()` (a misuse), while undefined means they forgot to write it.
 */
function readRoles(
  reflector: Reflector,
  target: object | Function,
): string[] | undefined {
  const value = reflector.get<unknown>(ROLES_KEY, target as Function);
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

function joinPath(controllerPath: string, handlerPath: string): string {
  const left = controllerPath.replace(/^\/+|\/+$/g, '');
  const right = handlerPath.replace(/^\/+|\/+$/g, '');
  if (!left && !right) return '/';
  if (!left) return `/${right}`;
  if (!right) return `/${left}`;
  return `/${left}/${right}`;
}
