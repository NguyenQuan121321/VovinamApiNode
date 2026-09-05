import { ExamsController } from './exams.controller';
import type { AuthenticatedUser } from '../auth/guards/authenticated-request';

describe('ExamsController', () => {
  const service = {
    list: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    getById: jest.fn().mockResolvedValue({ id: 'exam-1' }),
    create: jest.fn().mockResolvedValue({ id: 'exam-1' }),
    update: jest.fn().mockResolvedValue({ id: 'exam-1' }),
    register: jest.fn().mockResolvedValue({ id: 'reg-1' }),
    recordResult: jest.fn().mockResolvedValue({ id: 'reg-1', status: 'RESULT_PASS' }),
  };
  const controller = new ExamsController(service as never);
  const user = {
    id: 'u-1',
    role: 'PARENT',
    sessionId: 's',
    jti: 'j',
  } as AuthenticatedUser;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates exam reads and admin writes', async () => {
    await controller.list({ page: 1, limit: 20 });
    expect(service.list).toHaveBeenCalledWith({ page: 1, limit: 20 });

    await controller.getById('exam-1');
    expect(service.getById).toHaveBeenCalledWith('exam-1');

    await controller.create({
      title: 'Grading',
      examDate: '2026-03-20',
      targetRankId: 4,
      feeAmount: 300000,
      registrationDeadline: '2026-03-01',
    });
    expect(service.create).toHaveBeenCalled();

    await controller.update('exam-1', { status: 'OPEN' });
    expect(service.update).toHaveBeenCalledWith('exam-1', { status: 'OPEN' });
  });

  it('delegates registration and result recording with the caller identity', async () => {
    await controller.register(user, 'exam-1', { studentId: 'sp-1' });
    expect(service.register).toHaveBeenCalledWith(user, 'exam-1', { studentId: 'sp-1' });

    await controller.recordResult(user, 'reg-1', { status: 'RESULT_PASS' });
    expect(service.recordResult).toHaveBeenCalledWith(user, 'reg-1', { status: 'RESULT_PASS' });
  });
});
