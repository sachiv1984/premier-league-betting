import puppeteer from 'puppeteer';
import fs from 'fs/promises';

async function fetchFixturesForMatchweek(matchweek) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();

  // Go to fixtures page
  await page.goto('https://www.premierleague.com/fixtures', {
    waitUntil: 'networkidle2',
    timeout: 60000,
  });
  console.log('Page loaded');

  // Wait longer for dropdown to appear
  await page.waitForSelector('.matchListContainer', { timeout: 60000 });

  // Select the matchweek from dropdown
  // The matchweek dropdown might be a select or custom dropdown; adjust selector accordingly
  // Premier League site uses buttons for matchweeks:
  await page.evaluate((mw) => {
    const buttons = Array.from(document.querySelectorAll('.matchWeekDropdown button, .matchWeek button'));
    const target = buttons.find(btn => btn.textContent.trim() === `Matchweek ${mw}`);
    if (target) target.click();
  }, matchweek);

  // Wait for fixtures to update after clicking matchweek
  await page.waitForTimeout(3000);

  // Wait for fixture container again
  await page.waitForSelector('.fixture, .matchFixtureContainer', { timeout: 60000 });

  // Extract match data
  const fixtures = await page.evaluate(() => {
    const matches = [];
    const fixtureElements = document.querySelectorAll('.fixture, .matchFixtureContainer');
    fixtureElements.forEach(fixture => {
      const home = fixture.querySelector('.team.home .teamName, .home .teamName');
      const away = fixture.querySelector('.team.away .teamName, .away .teamName');
      const status = fixture.querySelector('.status, .matchStatus');
      const scoreHome = fixture.querySelector('.score .home, .scoreHome');
      const scoreAway = fixture.querySelector('.score .away, .scoreAway');
      matches.push({
        homeTeam: home?.textContent.trim() ?? null,
        awayTeam: away?.textContent.trim() ?? null,
        status: status?.textContent.trim() ?? null,
        scoreHome: scoreHome?.textContent.trim() ?? null,
        scoreAway: scoreAway?.textContent.trim() ?? null,
      });
    });
    return matches;
  });

  await browser.close();
  return fixtures;
}

async function main() {
  try {
    const matchweek = 1; // set your desired matchweek here
    const fixtures = await fetchFixturesForMatchweek(matchweek);
    console.log('Fixtures:', fixtures);

    // Save to JSON file
    await fs.writeFile(`./public/fixtures-matchweek-${matchweek}.json`, JSON.stringify(fixtures, null, 2));
    console.log('Fixtures saved.');
  } catch (err) {
    console.error('Error during fetching fixtures:', err);
  }
}

main();
