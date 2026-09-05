import { AttendanceController } from './attendance.controller';
import type { AuthenticatedUser } from '../auth/guards/authenticated-request';

describe('AttendanceController', () => {
  const service = {
    createSession: jest.fn().mockResolvedValue({ id: 'sess-1' }),
    upsertRecords: jest.fn().mockResolvedValue([{ id: 'r-1' }]),
    listRecords: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    history: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    summary: jest.fn().mockResolvedValue({ total: 0 }),
  };
  const controller = new AttendanceController(service as never);
  const user = {
    id: 'u-1',
    role: 'INSTRUCTOR',
    sessionId: 's',
    jti: 'j',
  } as AuthenticatedUser;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates session and record management to the service', async () => {
    await controller.createSession(user, { classId: 'class-1', sessionDate: '2026-01-15' });
    expect(service.createSession).toHaveBeenCalledWith(user, {
      classId: 'class-1',
      sessionDate: '2026-01-15',
    });

    await controller.upsertRecords(user, 'sess-1', {
      records: [{ studentId: 'sp-1', status: 'PRESENT' }],
    });
    expect(service.upsertRecords).toHaveBeenCalledWith(user, 'sess-1', {
      records: [{ studentId: 'sp-1', status: 'PRESENT' }],
    });

    await controller.listRecords(user, 'sess-1');
    expect(service.listRecords).toHaveBeenCalledWith(user, 'sess-1');
  });

  it('delegates guarded student reads to the service', async () => {
    await controller.history(user, 'sp-1', { from: '2026-01-01' });
    expect(service.history).toHaveBeenCalledWith(user, 'sp-1', { from: '2026-01-01' });

    await controller.summary(user, { studentId: 'sp-1', month: '2026-01' });
    expect(service.summary).toHaveBeenCalledWith(user, { studentId: 'sp-1', month: '2026-01' });
  });
});
