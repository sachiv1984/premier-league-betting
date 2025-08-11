import fs from 'fs';
import fetch from 'node-fetch';
import puppeteer from 'puppeteer';

// Env variables for your API keys
const ODDS_API_KEY = process.env.ODDS_API_KEY;

if (!ODDS_API_KEY) {
  console.error("Missing ODDS_API_KEY");
  process.exit(1);
}

const PREMIER_LEAGUE_COMPETITION_ID = 8; // as per premierleague.com URL
const SEASON = 2025; // Update for current season

// Function to scrape current matchweek from Premier League site
async function fetchCurrentMatchweek() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(`https://www.premierleague.com/matchweek/current`, { waitUntil: 'networkidle2' });

  // The site shows current matchweek number in a span with data-matchweek attribute
  const matchweek = await page.evaluate(() => {
    const el = document.querySelector('[data-matchweek]');
    return el ? Number(el.getAttribute('data-matchweek')) : null;
  });

  await browser.close();

  if (!matchweek) throw new Error("Could not determine current matchweek");
  return matchweek;
}

// Scrape fixtures for a given matchweek, including scores if played
async function fetchFixturesForMatchweek(matchweek) {
  const url = `https://www.premierleague.com/en/matches?competition=${PREMIER_LEAGUE_COMPETITION_ID}&season=${SEASON}&matchweek=${matchweek}`;

  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(url, { waitUntil: 'networkidle2' });

  // Wait for fixtures container
  await page.waitForSelector('.fixtures__matches-list');

  // Extract fixture info
  const fixtures = await page.evaluate(() => {
    const matches = [];
    const matchElements = document.querySelectorAll('.fixtures__matches-list .matchFixtureContainer');

    matchElements.forEach(match => {
      // Check if postponed - class 'matchStatus--postponed' or status text contains 'Postponed'
      const statusTextEl = match.querySelector('.matchStatus');
      const statusText = statusTextEl ? statusTextEl.textContent.trim() : '';

      if (statusText.toLowerCase().includes('postponed')) {
        // Skip postponed matches entirely
        return;
      }

      // Teams
      const homeTeam = match.querySelector('.teamName.home')?.textContent.trim() || '';
      const awayTeam = match.querySelector('.teamName.away')?.textContent.trim() || '';

      // Kick-off time or date, e.g. "19:30" or "Aug 12"
      const kickOffTimeEl = match.querySelector('.kickOffDate time');
      const kickOffTime = kickOffTimeEl ? kickOffTimeEl.getAttribute('datetime') : null;

      // Scores if available
      const homeScoreEl = match.querySelector('.score.home');
      const awayScoreEl = match.querySelector('.score.away');

      // If scores exist, parse them as numbers, else null
      const homeScore = homeScoreEl ? parseInt(homeScoreEl.textContent.trim(), 10) : null;
      const awayScore = awayScoreEl ? parseInt(awayScoreEl.textContent.trim(), 10) : null;

      // Build match object
      matches.push({
        homeTeam,
        awayTeam,
        kickOffTime, // ISO string or null
        homeScore,
        awayScore,
        status: statusText || (homeScore !== null && awayScore !== null ? 'Finished' : 'Scheduled'),
      });
    });

    return matches;
  });

  await browser.close();

  return fixtures;
}

// Fetch odds from The Odds API
async function fetchOdds() {
  const url = `https://api.the-odds-api.com/v4/sports/soccer_epl/odds/?regions=uk&markets=h2h,spreads,totals&apiKey=${ODDS_API_KEY}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Odds API fetch error: ${res.status} ${res.statusText}`);
  }
  return await res.json();
}

// Generate simple HTML output
function generateHTML(fixtures, odds) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Premier League Betting Analysis</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 2rem; background: #f9f9f9; color: #333; }
    h1 { color: #2c3e50; }
    table { border-collapse: collapse; width: 100%; max-width: 900px; margin-bottom: 2rem; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background-color: #2980b9; color: white; }
    tr:nth-child(even) { background-color: #f2f2f2; }
    .score { font-weight: bold; }
    .status { font-style: italic; font-size: 0.9em; color: #666; }
  </style>
</head>
<body>
  <h1>Premier League Betting Analysis - Matchweek ${fixtures.length > 0 ? fixtures[0].matchweek || '' : ''}</h1>
  <p>Data updated: ${new Date().toLocaleString()}</p>

  <h2>Fixtures (${fixtures.length})</h2>
  <table>
    <thead>
      <tr>
        <th>Home Team</th>
        <th>Away Team</th>
        <th>Kick Off</th>
        <th>Score</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      ${fixtures.map(f => `
      <tr>
        <td>${f.homeTeam}</td>
        <td>${f.awayTeam}</td>
        <td>${f.kickOffTime ? new Date(f.kickOffTime).toLocaleString() : 'TBD'}</td>
        <td>${(f.homeScore !== null && f.awayScore !== null) ? `<span class="score">${f.homeScore} - ${f.awayScore}</span>` : 'N/A'}</td>
        <td class="status">${f.status}</td>
      </tr>
      `).join('')}
    </tbody>
  </table>

  <h2>Odds (${odds.length})</h2>
  <pre>${JSON.stringify(odds, null, 2)}</pre>

  <footer>
    <p>Data sources: <a href="https://www.premierleague.com/">Premier League</a>, <a href="https://the-odds-api.com/">The Odds API</a></p>
  </footer>
</body>
</html>`;
}

async function main() {
  try {
    console.log("Determining current matchweek...");
    const currentMatchweek = await fetchCurrentMatchweek();
    console.log(`Current matchweek is ${currentMatchweek}`);

    console.log("Fetching fixtures for current matchweek...");
    const fixtures = await fetchFixturesForMatchweek(currentMatchweek);
    console.log(`Fetched ${fixtures.length} fixtures`);

    console.log("Fetching odds...");
    const odds = await fetchOdds();
    console.log(`Fetched odds for ${odds.length} matches`);

    if (!fs.existsSync('./public')) {
      fs.mkdirSync('./public');
    }

    // Save JSON files
    fs.writeFileSync('./public/current-matchweek.json', JSON.stringify({ currentMatchweek }, null, 2));
    fs.writeFileSync('./public/fixtures.json', JSON.stringify(fixtures, null, 2));
    fs.writeFileSync('./public/odds.json', JSON.stringify(odds, null, 2));

    // Generate and save the index.html file
    const html = generateHTML(fixtures, odds);
    fs.writeFileSync('./public/index.html', html);

    console.log("Saved current-matchweek.json, fixtures.json, odds.json, and index.html in ./public");
  } catch (error) {
    console.error("Error during update:", error);
    process.exit(1);
  }
}

main();
