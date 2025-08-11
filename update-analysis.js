import fs from 'fs';
import puppeteer from 'puppeteer';

async function fetchCurrentGameweekFixtures() {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  console.log("Navigating to Premier League matches page...");
  await page.goto('https://www.premierleague.com/matches', { waitUntil: 'networkidle0' });

  // Get the current matchweek number
  const currentWeek = await page.evaluate(() => {
    const activeWeek = document.querySelector('.matchList .dropdownList li.selected');
    if (activeWeek) {
      const text = activeWeek.innerText.match(/Week\s+(\d+)/i);
      return text ? parseInt(text[1], 10) : null;
    }
    return null;
  });

  if (!currentWeek) {
    await browser.close();
    throw new Error('Could not determine current matchweek');
  }

  console.log(`Current matchweek: ${currentWeek}`);

  // Navigate to the current matchweek's page
  const url = `https://www.premierleague.com/en/matches?competition=8&season=2025&matchweek=${currentWeek}`;
  console.log(`Navigating to ${url}`);
  await page.goto(url, { waitUntil: 'networkidle0' });

  // Scrape the fixtures
  const fixtures = await page.evaluate(() => {
    const matches = [];
    document.querySelectorAll('.fixtures__matches-list .matchFixtureContainer').forEach(match => {
      const homeTeam = match.querySelector('.team.home .long')?.innerText.trim();
      const awayTeam = match.querySelector('.team.away .long')?.innerText.trim();
      const date = match.querySelector('.matchInfo .matchDate.renderMatchDateContainer')?.innerText.trim();
      const time = match.querySelector('.kickoff')?.innerText.trim();
      if (homeTeam && awayTeam) {
        matches.push({
          date,
          time,
          homeTeam,
          awayTeam
        });
      }
    });
    return matches;
  });

  await browser.close();
  return fixtures;
}

async function main() {
  try {
    console.log("Fetching fixtures...");
    const fixtures = await fetchCurrentGameweekFixtures();

    console.log(`Found ${fixtures.length} fixtures`);
    fs.writeFileSync('./public/upcoming-fixtures.json', JSON.stringify(fixtures, null, 2));
    console.log("Fixtures saved to public/upcoming-fixtures.json");

    // TODO: Add your betting analysis generation here
    // e.g., runOddsAnalysis(fixtures);

  } catch (err) {
    console.error("Error during update:", err);
    process.exit(1);
  }
}

main();
