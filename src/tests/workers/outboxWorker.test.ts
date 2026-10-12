import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processOutboxBatch } from '../../adapters/scheduler/OutboxWorker';
import type { OutboxJob, OutboxRepository, DiscordService, Config } from '../../core/ports';

const limits = {
  notificationBackoffSeconds: [5, 15, 30],
  maxNotificationRetries: 5,
  roleAssignMaxRetries: 3,
  roleAssignRetryBackoffSeconds: [10, 20],
};

const createOutbox = (jobs: OutboxJob[]) => ({
  enqueueDM: vi.fn(),
  enqueueChannel: vi.fn(),
  enqueueRoleChange: vi.fn(),
  takeDue: vi.fn().mockResolvedValue(jobs),
  markSent: vi.fn(),
  markFailed: vi.fn(),
  markPermanentlyFailed: vi.fn(),
});

const createDiscord = () => ({
  normalizeRoom: vi.fn(),
  sendDM: vi.fn().mockResolvedValue(undefined),
  sendToQueue: vi.fn().mockResolvedValue(undefined),
  assignRoles: vi.fn().mockResolvedValue({ status: 'success' }),
  removeRoles: vi.fn().mockResolvedValue({ status: 'success' }),
  isRaForHall: vi.fn(),
});

const config = { limits: vi.fn().mockReturnValue(limits) };

describe('OutboxWorker', () => {
  let discord: ReturnType<typeof createDiscord>;

  beforeEach(() => {
    discord = createDiscord();
  });

  const run = (outbox: ReturnType<typeof createOutbox>, batchSize = 10) =>
    processOutboxBatch(
      outbox as unknown as OutboxRepository,
      discord as unknown as DiscordService,
      config as unknown as Config,
      batchSize,
    );

  it('delivers DM jobs and marks them sent', async () => {
    const outbox = createOutbox([
      {
        id: 'job-1',
        caseId: 'case-1',
        kind: 'dm',
        template: 'Hello {{name}}',
        payload: { targetId: 'user-123', data: { name: 'Ada' } },
        attempts: 0,
      },
    ]);

    await run(outbox, 5);

    expect(outbox.takeDue).toHaveBeenCalledWith(5);
    expect(discord.sendDM).toHaveBeenCalledWith('user-123', 'Hello {{name}}', { name: 'Ada' }, 'job-1');
    expect(outbox.markSent).toHaveBeenCalledWith('job-1');
    expect(outbox.markFailed).not.toHaveBeenCalled();
  });

  it('records failures and schedules retry with backoff', async () => {
    discord.sendToQueue.mockRejectedValue(new Error('network down'));
    const outbox = createOutbox([
      { id: 'job-2', kind: 'channel', template: 'Alert', payload: { targetId: 'channel-1' }, attempts: 1 },
    ]);

    const before = Date.now();
    await run(outbox);

    expect(outbox.markSent).not.toHaveBeenCalled();
    const [jobId, error, retryAt] = outbox.markFailed.mock.calls[0];
    expect(jobId).toBe('job-2');
    expect(error).toBe('network down');
    // attempts=1 -> second backoff entry (15s)
    expect((retryAt as Date).getTime() - before).toBeGreaterThanOrEqual(15_000);
  });

  it('gives up on the attempt that reaches maxNotificationRetries', async () => {
    discord.sendDM.mockRejectedValue(new Error('blocked DMs'));
    // 4 previous attempts; this is attempt 5 of 5
    const outbox = createOutbox([
      { id: 'job-3', kind: 'dm', template: 'x', payload: { targetId: 'user-1' }, attempts: 4 },
    ]);

    await run(outbox);

    expect(outbox.markPermanentlyFailed).toHaveBeenCalledWith('job-3', 'blocked DMs');
    expect(outbox.markFailed).not.toHaveBeenCalled();
  });

  it('applies role changes and enqueues the follow-up DM after success', async () => {
    const followUp = { userId: 'user-1', template: 'Approved for {{hall}}', data: { hall: 'North' } };
    const outbox = createOutbox([
      {
        id: 'job-4',
        caseId: 'case-4',
        kind: 'role_add',
        template: '',
        payload: { targetId: 'user-1', data: { roleIds: ['role-a'] }, followUp },
        attempts: 0,
      },
      {
        id: 'job-5',
        kind: 'role_remove',
        template: '',
        payload: { targetId: 'user-1', data: { roleIds: ['role-b'] } },
        attempts: 0,
      },
    ]);

    await run(outbox);

    expect(discord.assignRoles).toHaveBeenCalledWith('user-1', ['role-a'], 'job-4');
    expect(discord.removeRoles).toHaveBeenCalledWith('user-1', ['role-b'], 'job-5');
    expect(outbox.markSent).toHaveBeenCalledTimes(2);
    expect(outbox.enqueueDM).toHaveBeenCalledTimes(1);
    expect(outbox.enqueueDM).toHaveBeenCalledWith('user-1', 'Approved for {{hall}}', { hall: 'North' }, {
      caseId: 'case-4',
      idempotencyKey: 'job-4-followup',
    });
  });

  it('treats a failed role result as an error, retries with role limits, and holds the follow-up', async () => {
    discord.assignRoles.mockResolvedValue({ status: 'failure', details: 'Missing Permissions' });
    const outbox = createOutbox([
      {
        id: 'job-6',
        kind: 'role_add',
        template: '',
        payload: {
          targetId: 'user-1',
          data: { roleIds: ['role-a'] },
          followUp: { userId: 'user-1', template: 'Approved' },
        },
        attempts: 0,
      },
    ]);

    const before = Date.now();
    await run(outbox);

    expect(outbox.markSent).not.toHaveBeenCalled();
    expect(outbox.enqueueDM).not.toHaveBeenCalled();
    const [, error, retryAt] = outbox.markFailed.mock.calls[0];
    expect(error).toBe('Missing Permissions');
    expect((retryAt as Date).getTime() - before).toBeGreaterThanOrEqual(10_000);
  });

  it('permanently fails role jobs at roleAssignMaxRetries', async () => {
    discord.removeRoles.mockResolvedValue({ status: 'failure', details: 'Unknown Member' });
    const outbox = createOutbox([
      { id: 'job-7', kind: 'role_remove', template: '', payload: { targetId: 'u', data: { roleIds: ['r'] } }, attempts: 2 },
    ]);

    await run(outbox);

    expect(outbox.markPermanentlyFailed).toHaveBeenCalledWith('job-7', 'Unknown Member');
  });
});
