export interface RoleServiceResult {
  status: "success" | "partial" | "failure";
  details?: string;
}

export interface RoleService {
  assign(userId: string, roleIds: string[], idempotencyKey?: string): Promise<RoleServiceResult>;
  remove(userId: string, roleIds: string[], idempotencyKey?: string): Promise<RoleServiceResult>;
}
