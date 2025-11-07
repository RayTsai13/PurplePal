import type {
  HallService,
  RoomService,
  CaseService,
  DecisionService,
  NotificationService,
  RoleService,
  AuditService,
  PolicyService,
} from "../ports";

export class VerificationOrchestrator {
  constructor(
    private readonly hall: HallService,
    private readonly room: RoomService,
    private readonly cases: CaseService,
    private readonly decisions: DecisionService,
    private readonly notify: NotificationService,
    private readonly roles: RoleService,
    private readonly audit: AuditService,
    private readonly policy: PolicyService,
  ) {}

  // TODO: implement state machine handlers (no logic now)
  onUserJoined(_userId: string, _idempotencyKey: string): Promise<void> {
    return Promise.resolve();
  }

  onHallChosen(_userId: string, _hall: string, _idempotencyKey: string): Promise<void> {
    return Promise.resolve();
  }

  onRoomEntered(_userId: string, _roomRaw: string, _idempotencyKey: string): Promise<void> {
    return Promise.resolve();
  }

  onRAResponded(
    _caseId: string,
    _raUserId: string,
    _decision: "approve" | "deny",
    _reason?: string,
    _idempotencyKey?: string,
  ): Promise<void> {
    return Promise.resolve();
  }

  expire(_caseId: string, _idempotencyKey: string): Promise<void> {
    return Promise.resolve();
  }
}
