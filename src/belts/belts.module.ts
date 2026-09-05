import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BeltsController } from './belts.controller';
import { BeltsService } from './belts.service';

/** Belt rank catalog (plan sections 6, 8). */
@Module({
  imports: [AuthModule],
  controllers: [BeltsController],
  providers: [BeltsService],
})
export class BeltsModule {}
