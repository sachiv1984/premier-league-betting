import fs from 'fs';
import fetch from 'node-fetch';

// Environment variables - make sure these are set in your GitHub secrets or local env
const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY;
const ODDS_API_KEY = process.env.ODDS_API_KEY;

if (!API_FOOTBALL_KEY) {
  console.error("Missing API_FOOTBALL_KEY");
  process.exit(1);
}
if (!ODDS_API_KEY) {
  console.error("Missing ODDS_API_KEY");
  process.exit(1);
}

const PREMIER_LEAGUE_ID = 39;
const SEASON = 2023; // Update to current season as needed

async function fetchFixtures() {
  const today = new Date().toISOString().split('T')[0];
  const url = `https://v3.football.api-sports.io/fixtures?league=${PREMIER_LEAGUE_ID}&season=${SEASON}&from=${today}`;

  const res = await fetch(url, {
    headers: { 'x-apisports-key': API_FOOTBALL_KEY },
  });
  if (!res.ok) {
    throw new Error(`API-Football fetch error: ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  return json.response || [];
}

async function fetchOdds() {
  const url = `https://api.the-odds-api.com/v4/sports/soccer_epl/odds/?regions=uk&markets=h2h,spreads,totals&apiKey=${ODDS_API_KEY}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Odds API fetch error: ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  return json;
}

function generateHTML(fixtures, odds) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Premier League Betting Analysis</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 2rem; background: #f9f9f9; color: #333; }
    h1 { color: #2c3e50; }
    h2 { margin-top: 2rem; }
    pre { background: #fff; padding: 1rem; border-radius: 5px; overflow-x: auto; box-shadow: 0 0 5px rgba(0,0,0,0.1); }
    a { color: #2980b9; }
  </style>
</head>
<body>
  <h1>Premier League Betting Analysis</h1>
  <p>Data updated: ${new Date().toLocaleString()}</p>

  <h2>Upcoming Fixtures (${fixtures.length})</h2>
  <pre>${JSON.stringify(fixtures, null, 2)}</pre>

  <h2>Odds Data (${odds.length})</h2>
  <pre>${JSON.stringify(odds, null, 2)}</pre>

  <footer>
    <p>Data sources: <a href="https://www.api-football.com/">API-Football</a> &amp; <a href="https://the-odds-api.com/">The Odds API</a></p>
  </footer>
</body>
</html>`;
}

async function main() {
  try {
    console.log("Fetching upcoming Premier League fixtures...");
    const fixtures = await fetchFixtures();
    console.log(`Fetched ${fixtures.length} fixtures`);

    console.log("Fetching odds...");
    const odds = await fetchOdds();
    console.log(`Fetched odds for ${odds.length} matches`);

    // Make sure ./public directory exists
    if (!fs.existsSync('./public')) {
      fs.mkdirSync('./public');
    }

    // Save JSON files
    fs.writeFileSync('./public/upcoming-fixtures.json', JSON.stringify(fixtures, null, 2));
    fs.writeFileSync('./public/odds.json', JSON.stringify(odds, null, 2));

    // Generate and save the index.html file
    const html = generateHTML(fixtures, odds);
    fs.writeFileSync('./public/index.html', html);

    console.log("Saved upcoming-fixtures.json, odds.json, and index.html in ./public");
  } catch (error) {
    console.error("Error during analysis update:", error);
    process.exit(1);
  }
}

main();
