import fs from 'fs';
import path from 'path';
import type {
  Config,
  HallConfig,
  LimitsConfig,
  MessageTemplates,
  TimeoutConfig,
} from '../../core/ports';
import { PolicySchema, type PolicyConfig, type HallConfig as PolicyHallConfig } from '../config/policySchema';
import { HallDirectory } from './hallDirectory';

// Callback type for reload notifications
// Allows dependent services to be notified when config changes
export type ConfigReloadListener = (newConfig: PolicyConfig) => void;

export const DEFAULT_POLICY_PATH = 'config/policy.json';

// Read and validate a policy file. Throws with the file path on read, JSON, or schema errors
export function readPolicyFile(configPath: string): PolicyConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (error) {
    throw new Error(`Failed to read configuration file at ${configPath}: ${(error as Error).message}`);
  }
  const result = PolicySchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`).join('\n');
    throw new Error(`Invalid configuration in ${configPath}:\n${issues}`);
  }
  return result.data;
}

// Convert policy hall (includes normalize rules) to the port HallConfig shape
const toPortHall = (hall: PolicyHallConfig): HallConfig => ({
  name: hall.name,
  aliases: hall.aliases ?? [],
  raRoleId: hall.raRoleId,
  queueChannelId: hall.queueChannelId,
  hallRoleId: hall.hallRoleId,
  room: hall.room
    ? {
        pattern: hall.room.pattern,
        example: hall.room.example,
        prefix: hall.room.prefix,
        roomNumberPattern: hall.room.roomNumberPattern,
        roomNumberExample: hall.room.roomNumberExample,
        unitPattern: hall.room.unitPattern,
        unitExample: hall.room.unitExample,
      }
    : undefined,
});

// Synchronous configuration service implementing Config port interface
// Supports hot reload via reload() and watch()
export class ConfigImpl implements Config {
  private policy: PolicyConfig;
  private readonly configPath: string;
  private readonly listeners: ConfigReloadListener[] = [];
  // Hall lookup tables, rebuilt in place on reload so holders of this reference stay current
  readonly hallDirectory: HallDirectory;

  constructor(initialPolicy: PolicyConfig, configPath?: string) {
    this.policy = initialPolicy;
    // Default path resolves to config/policy.json from project root
    this.configPath = configPath ?? path.resolve(process.cwd(), DEFAULT_POLICY_PATH);
    this.hallDirectory = new HallDirectory(initialPolicy.halls);
  }

  // Load and validate policy.json (relative to the working directory by default)
  static fromFile(configPath = path.resolve(process.cwd(), DEFAULT_POLICY_PATH)): ConfigImpl {
    return new ConfigImpl(readPolicyFile(configPath), configPath);
  }

  // Register a listener to be called when configuration reloads
  onReload(listener: ConfigReloadListener): void {
    this.listeners.push(listener);
  }

  // Return current academic term
  currentTerm(): string {
    return this.policy.term;
  }

  // Return timeout configuration for verification process
  timeouts(): TimeoutConfig {
    return {
      awaitingRA_ttl_hours: this.policy.timeouts.awaitingRA_ttl_hours,
      reminder_hours: this.policy.timeouts.reminder_hours,
    };
  }

  // Return retry and backoff limits for operations
  limits(): LimitsConfig {
    return {
      maxNotificationRetries: this.policy.limits.maxNotificationRetries,
      notificationBackoffSeconds: this.policy.limits.notificationBackoffSeconds,
      roleAssignMaxRetries: this.policy.limits.roleAssignMaxRetries,
      roleAssignRetryBackoffSeconds: this.policy.limits.roleAssignRetryBackoffSeconds,
    };
  }

  // Return all message templates for DMs and RA queue
  messaging(): MessageTemplates {
    return {
      dm: this.policy.templates.dm,
      ra_queue: this.policy.templates.ra_queue,
    };
  }

  // Return all halls with port interface shape (excludes normalize config)
  halls(): HallConfig[] {
    return this.policy.halls.map(toPortHall);
  }

  // Look up a hall by canonical name or alias
  hall(nameOrAlias: string): HallConfig | undefined {
    const match = this.hallDirectory.resolve(nameOrAlias);
    return match ? toPortHall(match) : undefined;
  }

  // Return lobby channel ID where unverified users can chat
  lobbyChannelId(): string | undefined {
    return this.policy.lobbyChannelId;
  }

  // Return unverified role ID assigned to new members
  unverifiedRoleId(): string | undefined {
    return this.policy.unverifiedRoleId;
  }

  // Reload configuration from disk without restarting the application
  // On a read or validation error this throws and the previous configuration stays in effect
  async reload(): Promise<void> {
    const newPolicy = readPolicyFile(this.configPath);

    this.policy = newPolicy;
    this.hallDirectory.rebuild(newPolicy.halls);

    // Notify all listeners about the configuration change
    for (const listener of this.listeners) {
      listener(newPolicy);
    }
  }

  // Reload automatically when the policy file changes. Watches the directory rather than the file
  // because editors often save by replacing the file, which ends a watch on the old inode.
  // Returns a function that stops watching
  watch(handlers: { onReloaded: () => void; onError: (error: Error) => void }, debounceMs = 500): () => void {
    const fileName = path.basename(this.configPath);
    let timer: NodeJS.Timeout | null = null;

    const watcher = fs.watch(path.dirname(this.configPath), (_event, changed) => {
      if (changed && changed.toString() !== fileName) {
        return;
      }
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        this.reload().then(handlers.onReloaded, handlers.onError);
      }, debounceMs);
    });

    return () => {
      if (timer) {
        clearTimeout(timer);
      }
      watcher.close();
    };
  }
}
