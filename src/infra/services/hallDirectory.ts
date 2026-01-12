import type { HallConfig } from '../config/policySchema';

// Normalize hall names/aliases for case-insensitive matching
const normalizeKey = (value: string): string => value.trim().toLowerCase();

// In-memory hall lookup service
// Builds two Maps at startup: one for canonical names, one for alias resolution
// Allows case-insensitive hall resolution via aliases
// Supports hot reload via rebuild() method
export class HallDirectory {
  // Map: normalized hall name => HallConfig
  private canonicalByKey: Map<string, HallConfig>;
  // Map: normalized alias => HallConfig (includes canonical names + all aliases)
  private aliasLookup: Map<string, HallConfig>;

  // Constructor builds lookup tables from hall configuration
  constructor(halls: HallConfig[]) {
    this.canonicalByKey = new Map();
    this.aliasLookup = new Map();
    this.buildLookupTables(halls);
  }

  // Rebuild lookup tables with new hall configuration
  // Called when config is hot-reloaded to update the directory
  rebuild(halls: HallConfig[]): void {
    this.canonicalByKey.clear();
    this.aliasLookup.clear();
    this.buildLookupTables(halls);
  }

  // Build the lookup tables from hall configuration
  private buildLookupTables(halls: HallConfig[]): void {
    // forEach iterates over array, .set() adds to Map
    halls.forEach((hall) => {
      const canonicalKey = normalizeKey(hall.name);
      this.canonicalByKey.set(canonicalKey, hall);

      // Spread operator ... unpacks array elements
      // new Set prevents duplicate entries for canonical name
      const aliases = new Set([hall.name, ...(hall.aliases ?? [])]);
      aliases.forEach((alias) => {
        this.aliasLookup.set(normalizeKey(alias), hall);
      });
    });
  }

  // Resolve a hall by input string (matches aliases and canonical names)
  // Returns undefined if not found
  resolve(input: string): HallConfig | undefined {
    const key = normalizeKey(input);
    return this.aliasLookup.get(key);
  }

  // Get hall by exact canonical name (no aliases)
  getByName(name: string): HallConfig | undefined {
    return this.canonicalByKey.get(normalizeKey(name));
  }

  // Return all halls
  // [...Map.values()] converts Map values iterator to array
  list(): HallConfig[] {
    return [...this.canonicalByKey.values()];
  }
}
