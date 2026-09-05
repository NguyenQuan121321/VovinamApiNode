import { Global, Module } from '@nestjs/common';
import { InMemorySharedStore, SHARED_STORE } from './shared-store';

/** Global: the SharedStore boundary (plan 3) is available to every feature module. */
@Global()
@Module({
  providers: [{ provide: SHARED_STORE, useClass: InMemorySharedStore }],
  exports: [SHARED_STORE],
})
export class SharedStoreModule {}
