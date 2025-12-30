import { describe, it, expect, vi } from 'vitest';
import { processOutboxBatch } from '../../adapters/scheduler/OutboxWorker';
import type { OutboxJob, OutboxRepository, DiscordService, Config } from '../../core/ports';

const basePolicy = {
  notificationBackoffSeconds: [5, 15, 30],
  maxNotificationRetries: 5,
  roleAssignMaxRetries: 3,
  roleAssignRetryBackoffSeconds: [5],
};

describe('OutboxWorker', () => {
  it('delivers DM jobs and marks them sent', async () => {
    const job: OutboxJob = {
      id: 'job-1',
      caseId: 'case-1',
      kind: 'dm',
      template: 'Hello {{name}}',
      payload: { targetId: 'user-123', data: { name: 'Ada' } },
      attempts: 0,
    };

    const outbox = {
      enqueueDM: vi.fn(),
      enqueueChannel: vi.fn(),
      takeDue: vi.fn().mockResolvedValue([job]),
      markSent: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn(),
      markPermanentlyFailed: vi.fn(),
    };

    const discord = {
      validateHall: vi.fn(),
      normalizeRoom: vi.fn(),
      sendDM: vi.fn().mockResolvedValue(undefined),
      sendToQueue: vi.fn(),
      assignRoles: vi.fn(),
      removeRoles: vi.fn(),
    };

    const config = {
      currentTerm: vi.fn().mockReturnValue('2024-fall'),
      timeouts: vi.fn().mockReturnValue({}),
      limits: vi.fn().mockReturnValue(basePolicy),
      messaging: vi.fn().mockReturnValue({}),
      halls: vi.fn().mockReturnValue([]),
    };

    await processOutboxBatch(
      outbox as unknown as OutboxRepository,
      discord as unknown as DiscordService,
      config as unknown as Config,
      5,
    );

    expect(outbox.takeDue).toHaveBeenCalledWith(5);
    expect(discord.sendDM).toHaveBeenCalledWith('user-123', 'Hello {{name}}', { name: 'Ada' }, 'job-1');
    expect(outbox.markSent).toHaveBeenCalledWith('job-1');
    expect(outbox.markFailed).not.toHaveBeenCalled();
  });

  it('records failures and schedules retry with backoff', async () => {
    const job: OutboxJob = {
      id: 'job-2',
      caseId: 'case-9',
      kind: 'channel',
      template: 'Alert',
      payload: { targetId: 'channel-1', data: { foo: 'bar' } },
      attempts: 1,
    };

    const outbox = {
      enqueueDM: vi.fn(),
      enqueueChannel: vi.fn(),
      takeDue: vi.fn().mockResolvedValue([job]),
      markSent: vi.fn(),
      markFailed: vi.fn().mockResolvedValue(undefined),
      markPermanentlyFailed: vi.fn(),
    };

    const discord = {
      validateHall: vi.fn(),
      normalizeRoom: vi.fn(),
      sendDM: vi.fn(),
      sendToQueue: vi.fn().mockRejectedValue(new Error('network down')),
      assignRoles: vi.fn(),
      removeRoles: vi.fn(),
    };

    const config = {
      currentTerm: vi.fn().mockReturnValue('2024-fall'),
      timeouts: vi.fn().mockReturnValue({}),
      limits: vi.fn().mockReturnValue(basePolicy),
      messaging: vi.fn().mockReturnValue({}),
      halls: vi.fn().mockReturnValue([]),
    };

    await processOutboxBatch(
      outbox as unknown as OutboxRepository,
      discord as unknown as DiscordService,
      config as unknown as Config,
      10,
    );

    expect(discord.sendToQueue).toHaveBeenCalledTimes(1);
    expect(outbox.markSent).not.toHaveBeenCalled();
    expect(outbox.markFailed).toHaveBeenCalled();
    const [, , retryAt] = outbox.markFailed.mock.calls[0];
    expect(retryAt).toBeInstanceOf(Date);
  });
});
