import { Global, Module } from '@nestjs/common';
import { EnvService } from './env.service';

/** Global so feature modules (health, later auth/billing) can inject EnvService directly. */
@Global()
@Module({
  providers: [EnvService],
  exports: [EnvService],
})
export class AppConfigModule {}
