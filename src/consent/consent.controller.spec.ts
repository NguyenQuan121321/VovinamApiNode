import { ConsentController } from './consent.controller';
import type { AuthenticatedUser } from '../auth/guards/authenticated-request';

describe('ConsentController', () => {
  const consent = {
    grant: jest.fn().mockResolvedValue({ id: 'c-1' }),
    revoke: jest.fn().mockResolvedValue({ purpose: 'MEDIA_USAGE' }),
    myHistory: jest.fn().mockResolvedValue({ items: [] }),
  };
  const controller = new ConsentController(consent as never);
  const user = { id: 'u-1', role: 'PARENT', sessionId: 's', jti: 'j' } as AuthenticatedUser;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates grant with the dto', async () => {
    const dto = { purpose: 'MEDIA_USAGE' as const, studentId: undefined };
    await controller.grant(user, dto);
    expect(consent.grant).toHaveBeenCalledWith(user, dto);
  });

  it('delegates revoke with the dto', async () => {
    const dto = { purpose: 'MEDIA_USAGE' as const };
    await controller.revoke(user, dto);
    expect(consent.revoke).toHaveBeenCalledWith(user, dto);
  });

  it('delegates the own history', async () => {
    await controller.history(user);
    expect(consent.myHistory).toHaveBeenCalledWith(user);
  });
});
