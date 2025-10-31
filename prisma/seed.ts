// prisma/seed.ts
import fs from 'fs';
import path from 'path';

const hallsPath = path.join(__dirname, '../config/halls.json');
const hallsRaw = fs.readFileSync(hallsPath, 'utf-8');
const halls = JSON.parse(hallsRaw);

async function main() {
  console.log('Loaded halls configuration:');
  for (const [name, config] of Object.entries(halls)) {
    console.log(`• ${name} → ${JSON.stringify(config)}`);
  }
}

main()
  .then(() => console.log('✅ Seed complete'))
  .catch((err) => console.error('❌ Error during seed:', err));
