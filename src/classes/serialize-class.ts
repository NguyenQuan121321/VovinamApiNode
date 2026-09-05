import type { Class, ClassSchedule } from '@prisma/client';
import { formatHhMm } from './time';

export function serializeSchedule(schedule: ClassSchedule): Record<string, unknown> {
  return {
    id: schedule.id,
    weekday: schedule.weekday,
    startTime: formatHhMm(schedule.startTime),
    endTime: formatHhMm(schedule.endTime),
    effectiveFrom: schedule.effectiveFrom,
    effectiveTo: schedule.effectiveTo,
  };
}

export function serializeClass(
  cls: Class,
  schedules: ClassSchedule[] = [],
  activeEnrollmentCount?: number,
): Record<string, unknown> {
  const base = {
    id: cls.id,
    name: cls.name,
    instructorId: cls.instructorId,
    location: cls.location,
    capacity: cls.capacity,
    status: cls.status,
    createdAt: cls.createdAt,
    updatedAt: cls.updatedAt,
    schedules: schedules.map(serializeSchedule),
  };
  return activeEnrollmentCount === undefined ? base : { ...base, activeEnrollmentCount };
}
