import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClassesController } from './classes.controller';
import { ClassesService } from './classes.service';
import { EnrollmentsController } from './enrollments.controller';
import { EnrollmentsService } from './enrollments.service';

/** Classes, schedules, enrollments (plan sections 6, 8). */
@Module({
  imports: [AuthModule],
  controllers: [ClassesController, EnrollmentsController],
  providers: [ClassesService, EnrollmentsService],
  exports: [ClassesService],
})
export class ClassesModule {}
