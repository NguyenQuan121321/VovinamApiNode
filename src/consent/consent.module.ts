import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StudentsModule } from '../students/students.module';
import { ConsentController } from './consent.controller';
import { ConsentService } from './consent.service';

/**
 * Purpose-specific data-processing consent (plan sections 6, 7.1, 10). Uses the
 * ownership guard for parent-for-minor grants; records are append-only.
 */
@Module({
  imports: [AuthModule, StudentsModule],
  controllers: [ConsentController],
  providers: [ConsentService],
})
export class ConsentModule {}
