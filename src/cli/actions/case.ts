import type { CliContainer } from '../container';

// Shared admin case actions used by both the `case` commands and the interactive REPL
// They go through the orchestrator so admin overrides get the same audit trail, role changes,
// and user DMs as decisions made in Discord. Delivery happens via the running bot's outbox worker

export type ActionResult = { ok: boolean; message: string };

const CLI_ACTOR = 'cli-admin';
const DELIVERY_NOTE = 'Role changes and DMs are queued and will be delivered by the running bot.';

export async function forceExpire(c: CliContainer, caseId: string, reason?: string): Promise<ActionResult> {
  const kase = await c.cases.findById(caseId);
  if (!kase) {
    return { ok: false, message: `Case ${caseId} not found` };
  }

  const expired = await c.orchestrator.expire(caseId, `cli-expire-${caseId}-${kase.version}`, {
    admin: { actorId: CLI_ACTOR, reason: reason ?? 'Manual expiration via CLI' },
  });
  if (!expired) {
    return { ok: false, message: `Case is not in an active state (current state: ${kase.state})` };
  }
  return { ok: true, message: `Case ${caseId} expired successfully. ${DELIVERY_NOTE}` };
}

export async function forceDecide(
  c: CliContainer,
  caseId: string,
  decision: string,
  reason?: string,
): Promise<ActionResult> {
  if (decision !== 'approve' && decision !== 'deny') {
    return { ok: false, message: 'Decision must be "approve" or "deny"' };
  }

  const result = await c.orchestrator.onRAResponded(
    caseId,
    CLI_ACTOR,
    decision,
    reason ?? 'Admin override via CLI',
    undefined,
    { asAdmin: true },
  );

  if (result.ok) {
    return { ok: true, message: `Case ${caseId} ${result.state} successfully. ${DELIVERY_NOTE}` };
  }
  const reasons: Record<typeof result.reason, string> = {
    not_found: `Case ${caseId} not found`,
    not_pending: `Case ${caseId} is not awaiting RA review`,
    unauthorized: 'Not authorized',
    conflict: `Case ${caseId} was modified concurrently; inspect it and retry`,
  };
  return { ok: false, message: reasons[result.reason] };
}

export async function resetUser(
  c: CliContainer,
  userId: string,
  term?: string,
  reason?: string,
): Promise<ActionResult> {
  const targetTerm = term || c.config.currentTerm();
  const count = await c.orchestrator.adminResetUser(userId, targetTerm, CLI_ACTOR, reason ?? 'Reset via CLI');
  if (count === 0) {
    return { ok: true, message: `No active or approved cases for user ${userId} in term ${targetTerm}` };
  }
  return {
    ok: true,
    message: `Cancelled ${count} case(s) for user ${userId} in term ${targetTerm}; any granted hall role will be removed. ${DELIVERY_NOTE}`,
  };
}
