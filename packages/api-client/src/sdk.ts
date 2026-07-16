/**
 * SDK convenience wrapper.
 *
 * Most callers want a single object that bundles the transport client
 * with every typed endpoint group. `createApiSdk` returns that object,
 * keeping the underlying `ApiClient` accessible for ad-hoc requests
 * (e.g. file uploads with custom multipart bodies).
 */

import { createApiClient, type ApiClient, type ApiClientConfig } from './client';
import {
  createAuthEndpoints,
  type AuthEndpoints,
} from './endpoints/auth';
import {
  createGroupsEndpoints,
  createLessonsEndpoints,
  type GroupsEndpoints,
  type LessonsEndpoints,
} from './endpoints/lessons';
import {
  createHomeworkEndpoints,
  type HomeworkEndpoints,
} from './endpoints/homework';
import { createGamificationApi } from './endpoints/gamification';

export interface ApiSdk {
  /** Underlying transport — useful for endpoints not yet wrapped. */
  client: ApiClient;
  auth: AuthEndpoints;
  lessons: LessonsEndpoints;
  groups: GroupsEndpoints;
  homework: HomeworkEndpoints;
  gamification: ReturnType<typeof createGamificationApi>;
}

export function createApiSdk(config: ApiClientConfig): ApiSdk {
  const client = createApiClient(config);
  return {
    client,
    auth: createAuthEndpoints(client),
    lessons: createLessonsEndpoints(client),
    groups: createGroupsEndpoints(client),
    homework: createHomeworkEndpoints(client),
    gamification: createGamificationApi(client),
  };
}

/**
 * Build an SDK from an already-constructed client. Useful when an app
 * wants to share the transport (and therefore the refresh-promise
 * dedup) across SDK instances or extend it with custom endpoints.
 */
export function createApiSdkFromClient(client: ApiClient): ApiSdk {
  return {
    client,
    auth: createAuthEndpoints(client),
    lessons: createLessonsEndpoints(client),
    groups: createGroupsEndpoints(client),
    homework: createHomeworkEndpoints(client),
    gamification: createGamificationApi(client),
  };
}
