export function healthCheck(): void {
  console.log('Bot is alive 🚀');
}

if (require.main === module) {
  healthCheck();
}

