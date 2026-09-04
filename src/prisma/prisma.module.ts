import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/** Global: every domain module owns its queries through PrismaService (plan section 3). */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
