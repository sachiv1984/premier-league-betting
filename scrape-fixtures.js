import puppeteer from 'puppeteer';
import fs from 'fs/promises';

async function fetchFixturesForMatchweek(matchweek) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();

  // Set user agent to avoid bot detection
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/115.0 Safari/537.36'
  );

  try {
    await page.goto('https://www.premierleague.com/fixtures', {
      waitUntil: 'networkidle2',
      timeout: 60000,
    });
    console.log('Page loaded');

    // Wait extra time for JS to render
    await page.waitForTimeout(5000);

    // Wait for the fixtures container
    await page.waitForSelector('.fixtures', { timeout: 60000 });

    // Select the matchweek button and click it
    await page.evaluate((mw) => {
      const buttons = Array.from(document.querySelectorAll('.matchWeekDropdown button, .matchWeek button'));
      const target = buttons.find(btn => btn.textContent.trim() === `Matchweek ${mw}`);
      if (target) target.click();
    }, matchweek);

    // Wait for fixtures to update after clicking matchweek
    await page.waitForTimeout(3000);

    // Wait again for the updated fixtures to appear
    await page.waitForSelector('.fixture, .matchFixtureContainer', { timeout: 60000 });

    // Extract matches info
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

  } catch (error) {
    await browser.close();
    throw new Error('Error scraping fixtures: ' + error.message);
  }
}

async function main() {
  try {
    const matchweek = process.argv[2] || 1; // Pass matchweek as CLI argument, default 1
    console.log(`Scraping fixtures for matchweek ${matchweek}...`);

    const fixtures = await fetchFixturesForMatchweek(matchweek);
    console.log('Fixtures:', fixtures);

    await fs.writeFile(`./public/fixtures-matchweek-${matchweek}.json`, JSON.stringify(fixtures, null, 2));
    console.log('Fixtures saved.');
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main();
