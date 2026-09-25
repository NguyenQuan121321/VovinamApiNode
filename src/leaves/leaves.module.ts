import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StudentsModule } from '../students/students.module';
import { LeavesController } from './leaves.controller';
import { LeavesService } from './leaves.service';

/** Absence requests ("xin nghỉ", matrix row 11). */
@Module({
  imports: [AuthModule, StudentsModule],
  controllers: [LeavesController],
  providers: [LeavesService],
})
export class LeavesModule {}
