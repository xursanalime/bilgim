import {
  AdminAuditLog,
  Invoice,
  StudentProfile,
  User,
} from '@prisma/client';

import { CsvColumn } from './csv-stream';

/**
 * Column definitions for `/admin/exports/invoices.csv`.
 *
 * The header order MUST match the contract documented in Task 23.3
 * (id, teacherId, studentId, kind, amount, status, paidAt, paymeId).
 * Tests assert this exact ordering so a downstream consumer can rely
 * on positional parsing as well as header parsing.
 */
export const INVOICE_CSV_COLUMNS: CsvColumn<
  Pick<
    Invoice,
    | 'id'
    | 'teacherId'
    | 'studentId'
    | 'kind'
    | 'amountUzs'
    | 'status'
    | 'paidAt'
    | 'paymeTxId'
  >
>[] = [
  { header: 'id', value: (r) => r.id },
  { header: 'teacherId', value: (r) => r.teacherId },
  { header: 'studentId', value: (r) => r.studentId },
  { header: 'kind', value: (r) => r.kind },
  { header: 'amount', value: (r) => r.amountUzs },
  { header: 'status', value: (r) => r.status },
  { header: 'paidAt', value: (r) => r.paidAt },
  { header: 'paymeId', value: (r) => r.paymeTxId },
];

/**
 * Column definitions for `/admin/exports/users.csv`.
 *
 * The Prisma SELECT projection at the call site is the first line of
 * defence against leaking secrets — these columns are the second.
 * `passwordHash`, refresh-token-related fields, phone (encrypted) and
 * email-verification tokens are intentionally absent.
 */
export const USER_CSV_COLUMNS: CsvColumn<
  Pick<
    User,
    | 'id'
    | 'email'
    | 'username'
    | 'role'
    | 'status'
    | 'fullName'
    | 'locale'
    | 'createdAt'
    | 'updatedAt'
  >
>[] = [
  { header: 'id', value: (r) => r.id },
  { header: 'email', value: (r) => r.email },
  { header: 'username', value: (r) => r.username },
  { header: 'role', value: (r) => r.role },
  { header: 'status', value: (r) => r.status },
  { header: 'fullName', value: (r) => r.fullName },
  { header: 'locale', value: (r) => r.locale },
  { header: 'createdAt', value: (r) => r.createdAt },
  { header: 'updatedAt', value: (r) => r.updatedAt },
];

/** Column definitions for `/admin/exports/audit-logs.csv`. */
export const AUDIT_LOG_CSV_COLUMNS: CsvColumn<AdminAuditLog>[] = [
  { header: 'id', value: (r) => r.id },
  { header: 'createdAt', value: (r) => r.createdAt },
  { header: 'actorId', value: (r) => r.actorId },
  { header: 'action', value: (r) => r.action },
  { header: 'target', value: (r) => r.target },
  { header: 'ip', value: (r) => r.ip },
  // payload is JSON; serialize so a single CSV cell holds the whole
  // structured value. The encoder quotes / escapes as needed.
  { header: 'payload', value: (r) => (r.payload ? JSON.stringify(r.payload) : '') },
];

/**
 * Joined projection for `/admin/exports/payments.csv` (Task 23.3).
 *
 * One row per (PaymeTransaction, Invoice) pair so positional CSV
 * consumers see a flat shape. Teacher / student emails are denormalized
 * into the row to spare downstream consumers a follow-up join — they
 * are already inside the User model the operator can read on the
 * dashboard.
 *
 * Column order is documented in Task 23.3 and asserted by tests so a
 * BI consumer can rely on either header-keyed or positional parsing.
 */
export interface PaymentExportRow {
  paymeId: string | null;
  createdAt: Date;
  amountUzs: number;
  state: string;
  invoiceKind: string | null;
  teacherEmail: string | null;
  studentEmail: string | null;
  paidAt: Date | null;
}

/** Column definitions for `/admin/exports/payments.csv`. */
export const PAYMENT_CSV_COLUMNS: CsvColumn<PaymentExportRow>[] = [
  { header: 'paymeId', value: (r) => r.paymeId },
  { header: 'createdAt', value: (r) => r.createdAt },
  { header: 'amountUzs', value: (r) => r.amountUzs },
  { header: 'state', value: (r) => r.state },
  { header: 'invoiceKind', value: (r) => r.invoiceKind },
  { header: 'teacherEmail', value: (r) => r.teacherEmail },
  { header: 'studentEmail', value: (r) => r.studentEmail },
  { header: 'paidAt', value: (r) => r.paidAt },
];

/**
 * Flat projection for `/admin/exports/teachers.csv` (Task 23.3).
 * Joins User + TeacherProfile + latest non-terminal Subscription, plus
 * the cached `studentsCount` aggregate that `TeacherProfile` already
 * tracks.
 */
export interface TeacherExportRow {
  id: string;
  email: string;
  username: string | null;
  fullName: string | null;
  subscriptionStatus: string | null;
  onboardingCompletedAt: Date | null;
  totalStudents: number;
  createdAt: Date;
}

/** Column definitions for `/admin/exports/teachers.csv`. */
export const TEACHER_CSV_COLUMNS: CsvColumn<TeacherExportRow>[] = [
  { header: 'id', value: (r) => r.id },
  { header: 'email', value: (r) => r.email },
  { header: 'username', value: (r) => r.username },
  { header: 'fullName', value: (r) => r.fullName },
  { header: 'subscriptionStatus', value: (r) => r.subscriptionStatus },
  { header: 'onboardingCompletedAt', value: (r) => r.onboardingCompletedAt },
  { header: 'totalStudents', value: (r) => r.totalStudents },
  { header: 'createdAt', value: (r) => r.createdAt },
];

/**
 * Joined projection for `/teacher/exports/students.csv`. The teacher
 * endpoint streams enrolled students via Enrollment → StudentProfile →
 * User, and we expose a flat row shape to keep the CSV readable.
 */
export interface TeacherStudentExportRow {
  studentId: string;
  email: string;
  fullName: string;
  username: string | null;
  enrolledAt: Date | null;
  groupId: string;
  groupName: string;
  courseId: string;
  status: string;
}

/** Column definitions for `/teacher/exports/students.csv`. */
export const TEACHER_STUDENT_CSV_COLUMNS: CsvColumn<TeacherStudentExportRow>[] = [
  { header: 'studentId', value: (r) => r.studentId },
  { header: 'email', value: (r) => r.email },
  { header: 'fullName', value: (r) => r.fullName },
  { header: 'username', value: (r) => r.username },
  { header: 'enrolledAt', value: (r) => r.enrolledAt },
  { header: 'groupId', value: (r) => r.groupId },
  { header: 'groupName', value: (r) => r.groupName },
  { header: 'courseId', value: (r) => r.courseId },
  { header: 'status', value: (r) => r.status },
];

// `StudentProfile` is unused at the moment but re-exported via the type
// system to keep type-checks honest if the projection changes shape.
export type _StudentProfileMarker = StudentProfile;
