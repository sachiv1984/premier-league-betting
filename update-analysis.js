import fs from 'fs';
import fetch from 'node-fetch';

// Env variables
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
const SEASON = 2023; // Update as needed

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
  // Example odds API URL - adjust if needed for your odds provider
  const url = `https://api.the-odds-api.com/v4/sports/soccer_epl/odds/?regions=uk&markets=h2h,spreads,totals&apiKey=${ODDS_API_KEY}`;
  
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Odds API fetch error: ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  return json;
}

async function main() {
  try {
    console.log("Fetching upcoming Premier League fixtures...");
    const fixtures = await fetchFixtures();
    console.log(`Fetched ${fixtures.length} fixtures`);

    console.log("Fetching odds...");
    const odds = await fetchOdds();
    console.log(`Fetched odds for ${odds.length} matches`);

    // Ensure ./public directory exists
    if (!fs.existsSync('./public')) {
      fs.mkdirSync('./public');
      console.log("Created ./public directory");
    }

    // Save JSON files to public folder for frontend
    fs.writeFileSync('./public/upcoming-fixtures.json', JSON.stringify(fixtures, null, 2));
    fs.writeFileSync('./public/odds.json', JSON.stringify(odds, null, 2));

    console.log("Saved upcoming-fixtures.json and odds.json in ./public");
  } catch (err) {
    console.error("Error during analysis update:", err);
    process.exit(1);
  }
}

main();
