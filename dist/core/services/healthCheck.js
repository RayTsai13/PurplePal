"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.healthCheck = healthCheck;
function healthCheck() {
    console.log('Bot is alive 🚀');
}
if (require.main === module) {
    healthCheck();
}
