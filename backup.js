const fs = require('fs');
const path = require('path');

const source = process.argv[2];
if (!source) {
  console.error('Usage: node backup.js "<chemin du fichier.json>"');
  process.exit(1);
}

try {
  const data = fs.readFileSync(source, 'utf8');
  JSON.parse(data); // vérifie que le JSON est valide
  const date = new Date().toISOString().slice(0, 10);
  const dest = path.join(path.dirname(source), `backup_stars_${date}.json`);
  fs.writeFileSync(dest, data);
  console.log('Sauvegarde réussie :', dest);
} catch (err) {
  console.error('Erreur lors de la sauvegarde :', err.message);
  process.exitCode = 1;
}
