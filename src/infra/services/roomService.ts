import type { RoomService } from '../../core/application/ports';
import type { HallConfig, RoomConfig } from '../config/policySchema';
import { HallDirectory } from './hallDirectory';

interface NormalizeOptions extends NonNullable<RoomConfig['normalize']> {}

export class RoomServiceImpl implements RoomService {
  constructor(private readonly directory: HallDirectory) {}

  async normalize(hall: string, roomRaw: string) {
    const hallConfig = this.directory.getByName(hall) ?? this.directory.resolve(hall);
    if (!hallConfig) {
      return { valid: false, errors: [`Unknown hall "${hall}"`] };
    }

    if (!hallConfig.room) {
      return { valid: false, errors: [`Room configuration missing for hall "${hallConfig.name}"`] };
    }

    const normalized = applyNormalization(roomRaw, hallConfig);

    const pattern = compilePattern(hallConfig.room.pattern);
    if (!pattern.test(normalized)) {
      return {
        valid: false,
        errors: [`Room must match format ${hallConfig.room.example}`],
      };
    }

    return { valid: true, room: normalized };
  }
}

const compilePattern = (pattern: string): RegExp => {
  try {
    return new RegExp(pattern);
  } catch (error) {
    throw new Error(`Invalid room pattern "${pattern}": ${(error as Error).message}`);
  }
};

const applyNormalization = (roomRaw: string, hallConfig: HallConfig): string => {
  const rules: NormalizeOptions = hallConfig.room?.normalize ?? {};
  let current = roomRaw;

  if (rules.trimSpaces) {
    current = current.trim();
  }

  if (rules.uppercase) {
    current = current.toUpperCase();
  }

  if (rules.collapseDelimiters) {
    current = current.replace(/[\s_]+/g, '-');
  }

  if (rules.fixHyphens) {
    current = current.replace(/-+/g, '-');
  }

  if (rules.allowMissingHyphens && !current.includes('-')) {
    const compact = current.replace(/[^A-Z0-9]/gi, '');
    const match = compact.match(/^([A-Z])(\d{3})([A-Z])$/i);
    if (match) {
      current = `${match[1]}-${match[2]}-${match[3]}`;
    }
  }

  if (rules.uppercase) {
    current = current.toUpperCase();
  }

  return current;
};
