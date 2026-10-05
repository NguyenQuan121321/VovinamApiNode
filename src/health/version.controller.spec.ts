import { VersionController } from './version.controller';
import type { EnvService } from '../config/env.service';

describe('VersionController', () => {
  it('exposes only the configured commit identifier', () => {
    const controller = new VersionController({ buildSha: 'a'.repeat(40) } as EnvService);
    expect(controller.getVersion()).toEqual({ commit: 'a'.repeat(40) });
  });

  it('returns null when identity cannot be established', () => {
    const controller = new VersionController({ buildSha: undefined } as EnvService);
    expect(controller.getVersion()).toEqual({ commit: null });
  });
});
