import type { StudentProfile } from '@prisma/client';

export type CallerRole = 'ADMIN' | 'INSTRUCTOR' | 'STUDENT' | 'PARENT';

/**
 * Field-level serializer (plan 7.4): medical notes visible to all four roles for
 * safety; address, emergency contact and phone are hidden from instructors.
 * Students and parents only ever receive their own/linked profiles via the
 * ownership guard, so "full" here is scoped by the guard, not by this function.
 */
export function serializeStudent(
  profile: StudentProfile,
  callerRole: CallerRole,
): Record<string, unknown> {
  const base = {
    id: profile.id,
    fullName: profile.fullName,
    dob: profile.dob,
    gender: profile.gender,
    currentBeltRankId: profile.currentBeltRankId,
    status: profile.status,
    joinedAt: profile.joinedAt,
  };
  if (callerRole === 'INSTRUCTOR') {
    // Instructors see identity, belt and medical notes (plan 7.4) but no contacts.
    return { ...base, medicalNotes: profile.medicalNotes };
  }
  return {
    ...base,
    phone: profile.phone,
    address: profile.address,
    emergencyContactName: profile.emergencyContactName,
    emergencyContactPhone: profile.emergencyContactPhone,
    medicalNotes: profile.medicalNotes,
    hasLinkedAccount: profile.userId !== null,
  };
}
