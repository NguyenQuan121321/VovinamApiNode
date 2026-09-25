import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/guards/roles.decorator';
import { CurrentUser } from '../auth/guards/current-user.decorator';
import type { AuthenticatedUser } from '../auth/guards/authenticated-request';
import { BeltsService } from './belts.service';
import { CreateBeltRankDto, UpdateBeltRankDto } from './dto/belts.dto';

@Controller('belt-ranks')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BeltsController {
  constructor(private readonly belts: BeltsService) {}

  /** Any authenticated role may browse the rank catalog (plan 8). */
  @Get()
  list() {
    return this.belts.list();
  }

  @Post()
  @Roles('ADMIN')
  create(@Body() dto: CreateBeltRankDto) {
    return this.belts.create(dto);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(@Param('id') id: string, @Body() dto: UpdateBeltRankDto) {
    const rankId = Number.parseInt(id, 10);
    if (!Number.isInteger(rankId) || rankId <= 0) {
      throw new BadRequestException('Invalid belt rank id');
    }
    return this.belts.update(rankId, dto);
  }
}

/** Belt distribution report (matrix row 28); instructors scoped to own classes. */
@Controller('admin/reports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BeltReportsController {
  constructor(private readonly belts: BeltsService) {}

  @Get('belts')
  @Roles('ADMIN', 'INSTRUCTOR')
  distribution(@CurrentUser() caller: AuthenticatedUser) {
    return this.belts.distribution(caller);
  }
}
