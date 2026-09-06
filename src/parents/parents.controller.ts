import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/guards/roles.decorator';
import { CurrentUser } from '../auth/guards/current-user.decorator';
import type { AuthenticatedUser } from '../auth/guards/authenticated-request';
import { ParentsService } from './parents.service';
import { LinkChildDto } from '../students/dto/students.dto';
import { ParseUuidPipe } from '../common/parse-uuid.pipe';

@Controller('parents')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('PARENT')
export class ParentsController {
  constructor(private readonly parents: ParentsService) {}

  @Post('link')
  linkChild(@CurrentUser() user: AuthenticatedUser, @Body() dto: LinkChildDto) {
    return this.parents.linkChild(user.id, dto);
  }

  @Get('me/children')
  myChildren(@CurrentUser() user: AuthenticatedUser) {
    return this.parents.myChildren(user.id);
  }

  @Delete('links/:studentId')
  @HttpCode(200)
  async unlink(
    @CurrentUser() user: AuthenticatedUser,
    @Param('studentId', ParseUuidPipe) studentId: string,
  ): Promise<{ unlinked: boolean }> {
    return this.parents.unlink(user.id, studentId);
  }
}
