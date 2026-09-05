import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';
import { StudentOwnershipService } from './student-ownership.service';

@Module({
  imports: [AuthModule],
  controllers: [StudentsController],
  providers: [StudentsService, StudentOwnershipService],
  exports: [StudentsService, StudentOwnershipService],
})
export class StudentsModule {}
