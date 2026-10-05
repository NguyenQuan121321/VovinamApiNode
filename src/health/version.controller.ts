import { Controller, Get } from '@nestjs/common';
import { EnvService } from '../config/env.service';

@Controller()
export class VersionController {
  constructor(private readonly env: EnvService) {}

  @Get('version')
  getVersion(): { commit: string | null } {
    return { commit: this.env.buildSha ?? null };
  }
}
