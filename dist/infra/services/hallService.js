"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HallServiceImpl = void 0;
class HallServiceImpl {
    constructor(directory) {
        this.directory = directory;
    }
    async validate(hall) {
        const match = this.directory.resolve(hall);
        if (!match) {
            return { valid: false };
        }
        return {
            valid: true,
            normalizedHall: match.name,
            raRoleId: match.raRoleId,
            queueChannelId: match.queueChannelId,
            hallRoleId: match.hallRoleId,
        };
    }
}
exports.HallServiceImpl = HallServiceImpl;
