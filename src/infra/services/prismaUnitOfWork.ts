import type { PrismaClient } from '../../../generated/prisma';
import type { TransactionalRepositories, UnitOfWork } from '../../core/ports';
import { PrismaCaseRepository } from './prismaCaseService';
import { PrismaDecisionRepository } from './prismaDecisionService';
import { PrismaAuditRepository } from './prismaAuditService';
import { PrismaOutboxRepository } from './prismaOutboxService';

// Runs work inside one interactive Prisma transaction, handing it repositories bound to that transaction
export class PrismaUnitOfWork implements UnitOfWork {
  constructor(private readonly prisma: PrismaClient) {}

  async run<T>(work: (repos: TransactionalRepositories) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) =>
      work({
        cases: new PrismaCaseRepository(tx),
        decisions: new PrismaDecisionRepository(tx),
        audit: new PrismaAuditRepository(tx),
        outbox: new PrismaOutboxRepository(tx),
      }),
    );
  }
}
