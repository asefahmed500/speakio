import { UnauthorizedException } from '@nestjs/common';
import { InternalController } from './internal.controller';

/**
 * The internal route has no JWT guard — the cron secret is its only gate.
 * These tests pin the fail-closed behavior so it can never be accidentally
 * opened by an unset secret or a loose comparison.
 */
describe('InternalController', () => {
  const processPendingScoring = jest
    .fn()
    .mockResolvedValue({ claimed: 0, processed: [] });
  const controller = new InternalController({
    processPendingScoring,
  } as never);
  const originalSecret = process.env.CRON_SECRET;

  afterEach(() => {
    processPendingScoring.mockClear();
    if (originalSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalSecret;
  });

  it('fails closed when no secret is configured', async () => {
    delete process.env.CRON_SECRET;
    await expect(controller.processPending('anything')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(processPendingScoring).not.toHaveBeenCalled();
  });

  it('rejects a wrong secret', async () => {
    process.env.CRON_SECRET = 'correct-secret';
    await expect(controller.processPending('wrong')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(processPendingScoring).not.toHaveBeenCalled();
  });

  it('drives one pending job with the correct secret', async () => {
    process.env.CRON_SECRET = 'correct-secret';
    await expect(controller.processPending('correct-secret')).resolves.toEqual({
      claimed: 0,
      processed: [],
    });
    expect(processPendingScoring).toHaveBeenCalledWith(1);
  });
});
