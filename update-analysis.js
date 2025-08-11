import puppeteer from 'puppeteer';
import fs from 'fs/promises';
import path from 'path';

async function fetchFixtures() {
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();

  try {
    console.log('Navigating to Premier League matches page...');
    await page.goto('https://www.premierleague.com/matches', { waitUntil: 'networkidle2' });

    // Wait for match containers - increase timeout if needed
    await page.waitForSelector('.matchFixtureContainer', { timeout: 60000 });

    // Get fixtures
    const fixtures = await page.evaluate(() => {
      const matches = Array.from(document.querySelectorAll('.matchFixtureContainer'));
      // Sometimes date/time is in .fixtureDate or .fixtureDateTime or .matchDate
      return matches.map(match => {
        const homeTeam = match.querySelector('.team.home .teamName')?.textContent.trim() || '';
        const awayTeam = match.querySelector('.team.away .teamName')?.textContent.trim() || '';
        const dateTime = match.querySelector('.fixtureDate')?.textContent.trim()
          || match.querySelector('.kickoff__time')?.textContent.trim()
          || '';
        const status = match.querySelector('.fixtureStatus')?.textContent.trim() || '';
        const scoreHome = match.querySelector('.score.fullTime .home')?.textContent.trim() || null;
        const scoreAway = match.querySelector('.score.fullTime .away')?.textContent.trim() || null;

        return {
          homeTeam,
          awayTeam,
          dateTime,
          status,
          score: (scoreHome !== null && scoreAway !== null) ? `${scoreHome} - ${scoreAway}` : null,
        };
      });
    });

    // Try to guess the matchweek from page title or URL if possible, fallback to 'Unknown'
    let currentMatchweek = 'Unknown';

    // The page title might contain matchweek info, example: "Premier League fixtures and results - Matchweek 1"
    const title = await page.title();
    const mwMatch = title.match(/Matchweek\s+(\d+)/i);
    if (mwMatch) {
      currentMatchweek = mwMatch[1];
    }

    await browser.close();
    return { currentMatchweek, fixtures };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

function generateHTML(currentMatchweek, fixtures) {
  const rows = fixtures.map(f => {
    const scoreDisplay = f.score ? f.score : 'TBD';
    const statusDisplay = f.status ? `(${f.status})` : '';
    return `
      <tr>
        <td>${f.homeTeam}</td>
        <td>vs</td>
        <td>${f.awayTeam}</td>
        <td>${scoreDisplay} ${statusDisplay}</td>
        <td>${f.dateTime}</td>
      </tr>
    `;
  }).join('\n');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Premier League Fixtures - Matchweek ${currentMatchweek}</title>
<style>
  body { font-family: Arial, sans-serif; margin: 20px; background: #f8f9fa; }
  h1 { color: #2a3d66; }
  table { border-collapse: collapse; width: 100%; max-width: 700px; margin-top: 20px; }
  th, td { border: 1px solid #ddd; padding: 10px; text-align: center; }
  th { background-color: #2a3d66; color: white; }
  tr:nth-child(even) { background-color: #f2f2f2; }
</style>
</head>
<body>
  <h1>Premier League Fixtures - Matchweek ${currentMatchweek}</h1>
  <table>
    <thead>
      <tr>
        <th>Home Team</th>
        <th></th>
        <th>Away Team</th>
        <th>Score & Status</th>
        <th>Date/Time</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
</body>
</html>
  `;
}

async function main() {
  try {
    const { currentMatchweek, fixtures } = await fetchFixtures();

    const htmlContent = generateHTML(currentMatchweek, fixtures);

    const publicDir = path.resolve('./public');
    await fs.mkdir(publicDir, { recursive: true });

    const filePath = path.join(publicDir, 'index.html');
    await fs.writeFile(filePath, htmlContent, 'utf-8');

    console.log(`index.html created with fixtures for matchweek ${currentMatchweek}`);
  } catch (error) {
    console.error('Error during update:', error);
  }
}

main();

