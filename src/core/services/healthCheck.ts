// Simple health check function. void means it returns nothing
export function healthCheck(): void {
  console.log('Bot is alive');
}

// require.main === module checks if this file was run directly (not imported)
// Allows this file to be both imported and executed as a script
if (require.main === module) {
  healthCheck();
}

