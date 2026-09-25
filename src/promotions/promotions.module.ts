import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StudentsModule } from '../students/students.module';
import { PromotionsController } from './promotions.controller';
import { PromotionsService } from './promotions.service';

/** Promotion proposals ("đề xuất thăng đai", matrix row 14). */
@Module({
  imports: [AuthModule, StudentsModule],
  controllers: [PromotionsController],
  providers: [PromotionsService],
})
export class PromotionsModule {}
