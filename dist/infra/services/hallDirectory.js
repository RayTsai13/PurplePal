"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HallDirectory = void 0;
// Normalize hall names/aliases for case-insensitive matching
const normalizeKey = (value) => value.trim().toLowerCase();
// In-memory hall lookup service
// Builds two Maps at startup: one for canonical names, one for alias resolution
// Allows case-insensitive hall resolution via aliases
class HallDirectory {
    // Constructor builds lookup tables from hall configuration
    constructor(halls) {
        this.canonicalByKey = new Map();
        this.aliasLookup = new Map();
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
    resolve(input) {
        const key = normalizeKey(input);
        return this.aliasLookup.get(key);
    }
    // Get hall by exact canonical name (no aliases)
    getByName(name) {
        return this.canonicalByKey.get(normalizeKey(name));
    }
    // Return all halls
    // [...Map.values()] converts Map values iterator to array
    list() {
        return [...this.canonicalByKey.values()];
    }
}
exports.HallDirectory = HallDirectory;
