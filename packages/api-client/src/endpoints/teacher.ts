import type { ApiClient } from '../client';
import type { TeacherProfile } from '@bilgim/shared-types';

export const createTeacherEndpoints = (api: ApiClient) => ({
  /**
   * Fetch the current teacher's profile.
   */
  getProfile: () => {
    return api.get<
      TeacherProfile & { specialty: { modules: { moduleType: string }[] } }
    >('/teacher/profile/me');
  },
});
