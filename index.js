require('dotenv').config();

const bot = require('./bot');
const { createServer } = require('./server');

async function main() {
  const server = createServer();
  const port = process.env.PORT || 3000;
  server.listen(port, () => console.log(`Dashboard web dispo sur http://localhost:${port}`));

  await bot.start();
}

main().catch((err) => {
  console.error('Erreur au demarrage:', err);
  process.exit(1);
});
