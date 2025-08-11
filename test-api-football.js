import fetch from 'node-fetch';

const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY;
const PREMIER_LEAGUE_ID = 39;
const SEASON = 2023; // Current season

if (!API_FOOTBALL_KEY) {
  console.error("❌ Missing API_FOOTBALL_KEY");
  process.exit(1);
}

async function main() {
  try {
    const url = `https://v3.football.api-sports.io/fixtures?league=${PREMIER_LEAGUE_ID}&season=${SEASON}&next=10`;
    
    console.log(`📡 Fetching fixtures from: ${url}`);

    const res = await fetch(url, {
      headers: { 'x-apisports-key': API_FOOTBALL_KEY },
    });

    if (!res.ok) {
      throw new Error(`API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    console.log("✅ Raw API Response:");
    console.log(JSON.stringify(data, null, 2));

    console.log(`📅 Found ${data.response?.length || 0} fixtures`);
    if (data.response?.length) {
      data.response.forEach(f => {
        console.log(`- ${f.teams.home.name} vs ${f.teams.away.name} on ${f.fixture.date}`);
      });
    }
  } catch (err) {
    console.error("❌ Error fetching fixtures:", err);
    process.exit(1);
  }
}

main();
