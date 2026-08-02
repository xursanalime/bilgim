import { apiClient } from '../api-client';

export interface LiveSession {
  id: string;
  lessonId: string;
  status: 'SCHEDULED' | 'STARTING' | 'LIVE' | 'ENDED' | 'RECORDING_FAILED';
  roomId: string | null;
  startedAt: string | null;
  endedAt: string | null;
}

export interface LiveKitRoomSnapshot {
  lessonId: string;
  roomId: string;
  participantCount: number;
}

export interface LiveSessionWithSfu {
  session: LiveSession;
  sfu: LiveKitRoomSnapshot;
  lessonTitle?: string;
}

export interface JoinSessionResult extends LiveSessionWithSfu {
  token: string;
  role: 'TEACHER' | 'STUDENT';
}

export const liveApi = {
  getOne: (lessonId: string) => 
    apiClient.get<LiveSessionWithSfu>(`/live/sessions/${lessonId}`),
  
  /** `record` is the teacher's answer to the pre-start "record this lesson?" prompt. */
  start: (lessonId: string, record: boolean) =>
    apiClient.post<LiveSessionWithSfu>(`/live/sessions/${lessonId}/start`, { record }),
  
  end: (lessonId: string) => 
    apiClient.post<LiveSessionWithSfu>(`/live/sessions/${lessonId}/end`),
  
  join: (lessonId: string) => 
    apiClient.post<JoinSessionResult>(`/live/sessions/${lessonId}/join`),
  
  heartbeat: (lessonId: string) => 
    apiClient.get<LiveSessionWithSfu>(`/live/sessions/${lessonId}/heartbeat`),
  
  getLiveKitToken: (roomName: string) =>
    apiClient.post<{ token: string }>(`/live-stream/token`, { roomName }),
};
