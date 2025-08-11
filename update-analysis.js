import puppeteer from 'puppeteer';
import fs from 'fs/promises';
import path from 'path';

async function fetchCurrentGameweekFixtures() {
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();

  try {
    console.log('Navigating to Premier League matches page...');
    await page.goto('https://www.premierleague.com/matches', { waitUntil: 'networkidle2' });

    await page.waitForSelector('.matchWeekDropdown');

    const currentMatchweek = await page.evaluate(() => {
      const activeOption = document.querySelector('.matchWeekDropdown option[selected]');
      if (activeOption) {
        return parseInt(activeOption.textContent.trim().replace('Matchweek ', ''), 10);
      }
      return null;
    });

    if (!currentMatchweek) {
      throw new Error('Could not determine current matchweek');
    }
    console.log('Current matchweek:', currentMatchweek);

    const matchweekUrl = `https://www.premierleague.com/en/matches?matchweek=${currentMatchweek}`;
    await page.goto(matchweekUrl, { waitUntil: 'networkidle2' });

    await page.waitForSelector('.matchFixtureContainer');

    const fixtures = await page.evaluate(() => {
      const matches = Array.from(document.querySelectorAll('.matchFixtureContainer'));
      return matches.map(match => {
        const homeTeam = match.querySelector('.team.home .teamName')?.textContent.trim() || '';
        const awayTeam = match.querySelector('.team.away .teamName')?.textContent.trim() || '';
        const dateTime = match.querySelector('.fixtureDate')?.textContent.trim() || '';
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

    await browser.close();
    return { currentMatchweek, fixtures };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

function generateHTML(currentMatchweek, fixtures) {
  // Basic styling + formatting similar to your previous requests
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
    const { currentMatchweek, fixtures } = await fetchCurrentGameweekFixtures();

    // Generate HTML content
    const htmlContent = generateHTML(currentMatchweek, fixtures);

    // Ensure ./public directory exists or create it
    const publicDir = path.resolve('./public');
    await fs.mkdir(publicDir, { recursive: true });

    // Write to index.html inside public folder
    const filePath = path.join(publicDir, 'index.html');
    await fs.writeFile(filePath, htmlContent, 'utf-8');

    console.log(`index.html created with fixtures for matchweek ${currentMatchweek}`);
  } catch (error) {
    console.error('Error during update:', error);
  }
}

main();

