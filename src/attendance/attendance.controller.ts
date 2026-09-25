import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/guards/roles.decorator';
import { CurrentUser } from '../auth/guards/current-user.decorator';
import type { AuthenticatedUser } from '../auth/guards/authenticated-request';
import { ParseUuidPipe } from '../common/parse-uuid.pipe';
import { AttendanceService } from './attendance.service';
import {
  AttendanceHistoryQueryDto,
  AttendanceReportQueryDto,
  AttendanceSummaryQueryDto,
  BulkAttendanceRecordsDto,
  CreateAttendanceSessionDto,
} from './dto/attendance.dto';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Post('attendance-sessions')
  @Roles('ADMIN', 'INSTRUCTOR')
  createSession(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateAttendanceSessionDto) {
    return this.attendance.createSession(user, dto);
  }

  /** Bulk upsert is create-or-update, so 200 rather than 201 (consistency with result entry). */
  @Post('attendance-sessions/:id/records')
  @HttpCode(200)
  @Roles('ADMIN', 'INSTRUCTOR')
  upsertRecords(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: BulkAttendanceRecordsDto,
  ) {
    return this.attendance.upsertRecords(user, id, dto);
  }

  @Get('attendance-sessions/:id/records')
  @Roles('ADMIN', 'INSTRUCTOR')
  listRecords(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUuidPipe) id: string) {
    return this.attendance.listRecords(user, id);
  }

  /** Attendance history per the ownership guard 7.3 (any role, scoped data). */
  @Get('students/:id/attendance')
  history(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Query() query: AttendanceHistoryQueryDto,
  ) {
    return this.attendance.history(user, id, query);
  }

  @Get('attendance/summary')
  summary(@CurrentUser() user: AuthenticatedUser, @Query() query: AttendanceSummaryQueryDto) {
    return this.attendance.summary(user, query);
  }

  /** Club/class attendance report for one month (matrix row 26). */
  @Get('admin/reports/attendance')
  @Roles('ADMIN', 'INSTRUCTOR')
  monthlyReport(@CurrentUser() user: AuthenticatedUser, @Query() query: AttendanceReportQueryDto) {
    const parts = query.month.split('-');
    const year = Number.parseInt(parts[0] ?? '', 10);
    const month = Number.parseInt(parts[1] ?? '', 10);
    return this.attendance.monthlyReport(user, month, year);
  }
}
