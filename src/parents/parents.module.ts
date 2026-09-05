import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ParentsController } from './parents.controller';
import { ParentsService } from './parents.service';
import { StudentsModule } from '../students/students.module';

@Module({
  imports: [AuthModule, StudentsModule],
  controllers: [ParentsController],
  providers: [ParentsService],
})
export class ParentsModule {}
