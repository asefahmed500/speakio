import { AgentRunRecoveryService } from './agent-run-recovery.service';

/**
 * Regression test for the stale-RUNNING bug: a crashed/aborted worker left
 * agent runs in RUNNING forever, poisoning the admin Ops dashboard.
 */
describe('AgentRunRecoveryService', () => {
  it('releases RUNNING runs older than the stale window as FAILED', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 3 });
    const prisma = { agentRun: { updateMany } } as never;
    const service = new AgentRunRecoveryService(prisma);

    const released = await service.sweep();

    expect(released).toBe(3);
    expect(updateMany).toHaveBeenCalledTimes(1);
    const args = updateMany.mock.calls[0][0];
    expect(args.where.status).toBe('RUNNING');
    expect(args.where.createdAt.lt).toBeInstanceOf(Date);
    expect(args.data.status).toBe('FAILED');
    expect(args.data.error).toContain('worker interruption');
    expect(args.data.completedAt).toBeInstanceOf(Date);
  });

  it('never touches recent runs or runs already in a terminal state', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const prisma = { agentRun: { updateMany } } as never;
    const service = new AgentRunRecoveryService(prisma);

    expect(await service.sweep()).toBe(0);
    const args = updateMany.mock.calls[0][0];
    expect(args.where.status).toBe('RUNNING');
    // The cutoff must be in the past, not in the future.
    expect(args.where.createdAt.lt.getTime()).toBeLessThan(Date.now());
  });

  it('swallows sweep errors so a DB blip never crashes the host process', async () => {
    const updateMany = jest.fn().mockRejectedValue(new Error('DB down'));
    const prisma = { agentRun: { updateMany } } as never;
    const service = new AgentRunRecoveryService(prisma);

    await expect(service.sweep()).resolves.toBe(0);
  });
});
