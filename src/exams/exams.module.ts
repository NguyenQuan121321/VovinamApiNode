import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StudentsModule } from '../students/students.module';
import { BillingModule } from '../billing/billing.module';
import { ExamsController } from './exams.controller';
import { ExamsService } from './exams.service';

/** Belt exams, registration, and results (plan sections 6, 8, 13 P3). */
@Module({
  imports: [AuthModule, StudentsModule, BillingModule],
  controllers: [ExamsController],
  providers: [ExamsService],
})
export class ExamsModule {}
