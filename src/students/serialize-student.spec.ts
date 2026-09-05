import type { StudentProfile } from '@prisma/client';
import { serializeStudent } from './serialize-student';

const profile = {
  id: 'p-1',
  userId: 'u-1',
  fullName: 'Nguyen Van A',
  dob: new Date('2012-03-01'),
  gender: 'MALE',
  phone: '0901234567',
  address: '12 Ly Thuong Kiet',
  emergencyContactName: 'Bo A',
  emergencyContactPhone: '0909876543',
  medicalNotes: 'Asthma',
  currentBeltRankId: 3,
  inviteCode: 'ABCD2345',
  joinedAt: new Date(),
  status: 'ACTIVE',
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as StudentProfile;

describe('serializeStudent (plan 7.4 matrix)', () => {
  it('hides contact fields from instructors but keeps medical notes', () => {
    const view = serializeStudent(profile, 'INSTRUCTOR');
    expect(view).toMatchObject({ fullName: 'Nguyen Van A', medicalNotes: 'Asthma' });
    expect(view).not.toHaveProperty('phone');
    expect(view).not.toHaveProperty('address');
    expect(view).not.toHaveProperty('emergencyContactPhone');
    expect(view).not.toHaveProperty('hasLinkedAccount');
  });

  it('gives admin, student and parent the full view', () => {
    for (const role of ['ADMIN', 'STUDENT', 'PARENT'] as const) {
      const view = serializeStudent(profile, role);
      expect(view).toHaveProperty('phone', '0901234567');
      expect(view).toHaveProperty('medicalNotes', 'Asthma');
      expect(view).toHaveProperty('emergencyContactName', 'Bo A');
    }
  });

  it('exposes account linkage only outside the instructor view', () => {
    expect(serializeStudent(profile, 'PARENT')).toHaveProperty('hasLinkedAccount', true);
    expect(serializeStudent({ ...profile, userId: null }, 'ADMIN')).toHaveProperty(
      'hasLinkedAccount',
      false,
    );
  });
});
