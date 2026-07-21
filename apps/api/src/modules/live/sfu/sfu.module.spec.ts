import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { FakeMediasoupAdapter } from './fake-mediasoup.adapter';
import { MEDIASOUP_PORT } from './mediasoup.port';
import { SfuModule } from './sfu.module';
import { SfuService } from './sfu.service';

/**
 * Smoke test for `SfuModule` wiring. We override `MEDIASOUP_PORT` with
 * the in-memory fake so the test never loads the real `mediasoup`
 * native bindings. This is the same override path higher-level live
 * tests will use.
 */
describe('SfuModule', () => {
  it('wires SfuService with the MEDIASOUP_PORT provider', async () => {
    const fake = new FakeMediasoupAdapter();
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ ignoreEnvFile: true }), SfuModule],
    })
      .overrideProvider(MEDIASOUP_PORT)
      .useValue(fake)
      .compile();

    const service = moduleRef.get(SfuService);
    expect(service).toBeInstanceOf(SfuService);

    const room = await service.ensureRoomForLesson('lesson-smoke');
    expect(room.routerId).toBe('router_1');
    expect(fake.countCalls('createRouter')).toBe(1);
  });
});
