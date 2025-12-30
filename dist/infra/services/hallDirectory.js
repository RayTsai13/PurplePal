"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HallDirectory = void 0;
const normalizeKey = (value) => value.trim().toLowerCase();
class HallDirectory {
    constructor(halls) {
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
    resolve(input) {
        const key = normalizeKey(input);
        return this.aliasLookup.get(key);
    }
    getByName(name) {
        return this.canonicalByKey.get(normalizeKey(name));
    }
    list() {
        return [...this.canonicalByKey.values()];
    }
}
exports.HallDirectory = HallDirectory;
