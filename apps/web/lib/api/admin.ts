import { apiClient } from '../api-client';

export interface AdminUser {
  id: string;
  email: string;
  fullName: string;
  role: 'STUDENT' | 'TEACHER' | 'ADMIN';
  status: 'ACTIVE' | 'SUSPENDED' | 'PENDING_VERIFY';
  createdAt: string;
}

export interface AdminSpecialty {
  id: string;
  slug: string;
  nameUz: string;
  nameRu: string;
  nameEn: string;
  dashboardKey: string;
  isActive: boolean;
}

export interface AdminAuditLog {
  id: string;
  adminId: string | null;
  adminEmail: string | null;
  targetId: string | null;
  action: string;
  context: any;
  ip: string;
  createdAt: string;
}

export interface AdminSystemSetting {
  key: string;
  value: any;
  description: string | null;
  updatedAt: string;
}

export interface AdminAiPromptTemplate {
  id: string;
  key: string;
  intent: string;
  systemText: string;
  userTemplate: string;
  modelName: string;
  maxTokens: number;
  isActive: boolean;
}

export interface AdminOnboardingQuestion {
  id: string;
  specialtyId: string | null;
  order: number;
  textUz: string;
  textRu: string;
  textEn: string;
  optionsJson: any;
  isActive: boolean;
}

export interface AdminPlan {
  id: string;
  name: string;
  priceUzs: number;
  interval: 'MONTHLY' | 'YEARLY';
  isActive: boolean;
}

export interface AdminInvoice {
  id: string;
  kind: 'STUDENT_COURSE' | 'TEACHER_SUBSCRIPTION';
  amountUzs: number;
  status: 'PENDING' | 'PAID' | 'CANCELED' | 'REFUNDED';
  studentId: string | null;
  teacherId: string | null;
  issuedAt: string;
  paidAt: string | null;
  teacher?: { user: { id: string; fullName: string; email: string } | null } | null;
}

export const adminApi = {
  // Users
  listUsers: (params: { page?: number; limit?: number; role?: string; q?: string }) =>
    apiClient.get<{ items: AdminUser[]; total: number }>('/admin/users', { params }),
  
  updateUserStatus: (id: string, status: string, idempotencyKey: string) =>
    apiClient.patch(`/admin/users/${id}/status`, { status }, { 
      headers: { 'idempotency-key': idempotencyKey } 
    }),

  // Specialties
  listSpecialties: () =>
    apiClient.get<AdminSpecialty[]>('/admin/specialties'),
  
  createSpecialty: (data: Partial<AdminSpecialty>, idempotencyKey: string) =>
    apiClient.post<AdminSpecialty>('/admin/specialties', data, {
      headers: { 'idempotency-key': idempotencyKey }
    }),
  
  updateSpecialty: (id: string, data: Partial<AdminSpecialty>, idempotencyKey: string) =>
    apiClient.patch<AdminSpecialty>(`/admin/specialties/${id}`, data, {
      headers: { 'idempotency-key': idempotencyKey }
    }),

  // Audit Logs
  listAuditLogs: (params: { page?: number; limit?: number; adminId?: string; action?: string }) =>
    apiClient.get<{ items: AdminAuditLog[]; total: number }>('/admin/audit-logs', { params }),

  // Plans
  listPlans: () =>
    apiClient.get<AdminPlan[]>('/admin/plans'),

  // System Stats
  getSystemStats: () =>
    apiClient.get<{
      totalUsers: number;
      activeTeachers: number;
      paidInvoicesLast30Days: number;
      pendingEnrollmentRequests: number;
      failedDeliveriesLast24h: number;
      pendingOutboxOlderThan5m: number;
    }>('/admin/system/stats'),

  // System Settings
  listSystemSettings: () =>
    apiClient.get<AdminSystemSetting[]>('/admin/system-settings'),
  
  updateSystemSetting: (key: string, value: any, description: string | undefined, idempotencyKey: string) =>
    apiClient.put<AdminSystemSetting>(`/admin/system-settings/${key}`, { value, description }, {
      headers: { 'idempotency-key': idempotencyKey }
    }),

  // AI Prompts
  listAiPrompts: () =>
    apiClient.get<AdminAiPromptTemplate[]>('/admin/ai-prompts'),
  
  createAiPrompt: (data: Partial<AdminAiPromptTemplate>, idempotencyKey: string) =>
    apiClient.post<AdminAiPromptTemplate>('/admin/ai-prompts', data, {
      headers: { 'idempotency-key': idempotencyKey }
    }),
  
  updateAiPrompt: (id: string, data: Partial<AdminAiPromptTemplate>, idempotencyKey: string) =>
    apiClient.patch<AdminAiPromptTemplate>(`/admin/ai-prompts/${id}`, data, {
      headers: { 'idempotency-key': idempotencyKey }
    }),

  // Invoices (recent payments for admin dashboard)
  listRecentInvoices: (params: { limit?: number; status?: string } = {}) =>
    apiClient.get<{ items: AdminInvoice[]; total: number }>('/admin/invoices', { params }),

  // Specialties with teacher count
  listSpecialtiesWithCounts: () =>
    apiClient.get<(AdminSpecialty & { teacherCount: number })[]>('/admin/specialties', { params: { withCounts: 'true' } }),

  // Onboarding Questions
  listOnboardingQuestions: () =>
    apiClient.get<AdminOnboardingQuestion[]>('/admin/onboarding-questions'),
  
  createOnboardingQuestion: (data: Partial<AdminOnboardingQuestion>, idempotencyKey: string) =>
    apiClient.post<AdminOnboardingQuestion>('/admin/onboarding-questions', data, {
      headers: { 'idempotency-key': idempotencyKey }
    }),
  
  updateOnboardingQuestion: (id: string, data: Partial<AdminOnboardingQuestion>, idempotencyKey: string) =>
    apiClient.patch<AdminOnboardingQuestion>(`/admin/onboarding-questions/${id}`, data, {
      headers: { 'idempotency-key': idempotencyKey }
    }),
};
