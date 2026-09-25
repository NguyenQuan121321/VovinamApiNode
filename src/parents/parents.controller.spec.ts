import { ParentsController } from './parents.controller';

describe('ParentsController', () => {
  const service = {
    linkChild: jest.fn().mockResolvedValue({ id: 'link-1' }),
    myChildren: jest.fn().mockResolvedValue([]),
    unlink: jest.fn().mockResolvedValue({ unlinked: true }),
  };
  const controller = new ParentsController(service as never);
  const parent = { id: 'parent-1', role: 'PARENT', sessionId: 's', jti: 'j' } as never;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates link, children list, and unlink to the service', async () => {
    const dto = { inviteCode: 'ABCD2345' };
    await controller.linkChild(parent, dto);
    expect(service.linkChild).toHaveBeenCalledWith('parent-1', dto);

    await controller.myChildren(parent);
    expect(service.myChildren).toHaveBeenCalledWith('parent-1');

    await controller.unlink(parent, 'sp-1');
    expect(service.unlink).toHaveBeenCalledWith('parent-1', 'sp-1');
  });
});
