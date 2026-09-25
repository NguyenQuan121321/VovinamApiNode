import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './guards/roles.decorator';
import { CurrentUser } from './guards/current-user.decorator';
import type { AuthenticatedUser } from './guards/authenticated-request';
import { ParseUuidPipe } from '../common/parse-uuid.pipe';
import { AdminUsersService } from './admin-users.service';
import {
  CreateUserDto,
  ListAuditLogQueryDto,
  ListUsersQueryDto,
  UpdateUserDto,
} from './dto/users.dto';

/**
 * Admin backoffice for user accounts (matrix rows 2/5/6: manage users and
 * instructor/master accounts) and the system-wide audit trail (row 30). The
 * ADMIN MFA gate in RolesGuard applies to all of these routes automatically.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class AdminUsersController {
  constructor(private readonly adminUsers: AdminUsersService) {}

  @Get('users')
  @Roles('ADMIN')
  list(@Query() query: ListUsersQueryDto) {
    return this.adminUsers.list(query);
  }

  @Post('users')
  @Roles('ADMIN')
  create(@CurrentUser() caller: AuthenticatedUser, @Body() dto: CreateUserDto) {
    return this.adminUsers.create(caller, dto);
  }

  @Patch('users/:id')
  @Roles('ADMIN')
  update(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.adminUsers.update(caller, id, dto);
  }

  @Delete('users/:id')
  @Roles('ADMIN')
  deactivate(@CurrentUser() caller: AuthenticatedUser, @Param('id', ParseUuidPipe) id: string) {
    return this.adminUsers.deactivate(caller, id);
  }

  @Get('admin/audit-log')
  @Roles('ADMIN')
  auditLog(@Query() query: ListAuditLogQueryDto) {
    return this.adminUsers.listAuditLog(query);
  }
}
