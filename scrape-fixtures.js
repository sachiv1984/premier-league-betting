import puppeteer from 'puppeteer';
import fs from 'fs/promises';

async function fetchFixturesForMatchweek(matchweek) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();

  await page.goto('https://www.premierleague.com/fixtures', {
    waitUntil: 'networkidle2',
    timeout: 60000,
  });
  console.log('Page loaded');

  await page.waitForSelector('.matchListContainer', { timeout: 60000 });

  await page.evaluate((mw) => {
    const buttons = Array.from(document.querySelectorAll('.matchWeekDropdown button, .matchWeek button'));
    const target = buttons.find(btn => btn.textContent.trim() === `Matchweek ${mw}`);
    if (target) target.click();
  }, matchweek);

  await page.waitForTimeout(3000);

  await page.waitForSelector('.fixture, .matchFixtureContainer', { timeout: 60000 });

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

// Parse CLI args to get matchweek (default to 1)
const matchweek = process.argv[2] ? Number(process.argv[2]) : 1;

async function main() {
  try {
    const fixtures = await fetchFixturesForMatchweek(matchweek);
    console.log('Fixtures fetched:', fixtures.length);

    await fs.writeFile(`./public/fixtures-matchweek-${matchweek}.json`, JSON.stringify(fixtures, null, 2));
    console.log(`Fixtures saved to ./public/fixtures-matchweek-${matchweek}.json`);
  } catch (err) {
    console.error('Error scraping fixtures:', err);
    process.exit(1);
  }
}

main();
