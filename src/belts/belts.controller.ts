import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/guards/roles.decorator';
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
