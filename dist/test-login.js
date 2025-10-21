"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const discord_js_1 = require("discord.js");
console.log('🚀 Starting Discord login test...');
const token = process.env.DISCORD_TOKEN;
if (!token) {
    console.error('❌ No DISCORD_TOKEN found in .env');
    process.exit(1);
}
const client = new discord_js_1.Client({
    intents: [discord_js_1.GatewayIntentBits.Guilds],
});
client.once('ready', () => {
    console.log(`🤖 Logged in as ${client.user?.tag}`);
});
client.on('error', (err) => {
    console.error('❌ Discord client error:', err);
});
client.login(token).catch((err) => {
    console.error('❌ Login failed:', err);
});
