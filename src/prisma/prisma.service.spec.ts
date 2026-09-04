import { PrismaService } from './prisma.service';
import { PrismaModule } from './prisma.module';

describe('PrismaService', () => {
  it('connects on module init and disconnects on destroy', async () => {
    process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/db?schema=public';
    const service = new PrismaService();
    const connect = jest.spyOn(service, '$connect').mockResolvedValue();
    const disconnect = jest.spyOn(service, '$disconnect').mockResolvedValue();

    await service.onModuleInit();
    await service.onModuleDestroy();

    expect(connect).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(new PrismaModule()).toBeDefined();
  });
});
