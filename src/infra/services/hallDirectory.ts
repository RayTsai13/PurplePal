import type { HallConfig } from '../config/policySchema';

const normalizeKey = (value: string): string => value.trim().toLowerCase();

export class HallDirectory {
  private readonly canonicalByKey: Map<string, HallConfig>;
  private readonly aliasLookup: Map<string, HallConfig>;

  constructor(halls: HallConfig[]) {
    this.canonicalByKey = new Map();
    this.aliasLookup = new Map();

    halls.forEach((hall) => {
      const canonicalKey = normalizeKey(hall.name);
      this.canonicalByKey.set(canonicalKey, hall);

      const aliases = new Set([hall.name, ...(hall.aliases ?? [])]);
      aliases.forEach((alias) => {
        this.aliasLookup.set(normalizeKey(alias), hall);
      });
    });
  }

  resolve(input: string): HallConfig | undefined {
    const key = normalizeKey(input);
    return this.aliasLookup.get(key);
  }

  getByName(name: string): HallConfig | undefined {
    return this.canonicalByKey.get(normalizeKey(name));
  }

  list(): HallConfig[] {
    return [...this.canonicalByKey.values()];
  }
}
