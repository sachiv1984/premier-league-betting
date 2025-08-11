import puppeteer from 'puppeteer';
import fs from 'fs/promises';

async function fetchFixturesForMatchweek(matchweek) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();

  // Set a realistic user agent and viewport to avoid blocks
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
  );
  await page.setViewport({ width: 1280, height: 800 });

  // Go to fixtures page
  await page.goto('https://www.premierleague.com/fixtures', {
    waitUntil: 'networkidle2',
    timeout: 60000,
  });
  console.log('Page loaded');

  // Handle cookie consent popup if present
  try {
    const acceptButtonSelector = 'button[data-testid="accept-cookie-banner"]';
    await page.waitForSelector(acceptButtonSelector, { timeout: 5000 });
    await page.click(acceptButtonSelector);
    console.log('Accepted cookies');
    await page.waitForTimeout(1000);
  } catch {
    // No cookie popup found, continue
  }

  // Wait for fixtures container to appear (updated selector)
  await page.waitForSelector('div.fixtureListContainer, div.matchList', { timeout: 60000 });

  // Click the desired matchweek button
  await page.evaluate((mw) => {
    // Buttons with matchweek text
    const buttons = Array.from(document.querySelectorAll('ul.matchWeeks li a, .matchWeeksList a'));
    const target = buttons.find((btn) => btn.textContent.trim().includes(`Matchweek ${mw}`));
    if (target) {
      target.click();
    }
  }, matchweek);

  // Wait for fixtures to update after clicking matchweek
  await page.waitForTimeout(5000);

  // Wait for fixture elements to load after click
  await page.waitForSelector('div.fixture, div.matchFixtureContainer', { timeout: 60000 });

  // Extract match data
  const fixtures = await page.evaluate(() => {
    const matches = [];
    const fixtureElements = document.querySelectorAll('div.fixture, div.matchFixtureContainer');
    fixtureElements.forEach((fixture) => {
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
    const matchweek = process.argv[2] ? Number(process.argv[2]) : 1;
    console.log(`Scraping fixtures for matchweek ${matchweek}...`);
    const fixtures = await fetchFixturesForMatchweek(matchweek);
    console.log('Fixtures fetched:', fixtures.length);

    // Save to JSON file
    await fs.writeFile(`./public/fixtures-matchweek-${matchweek}.json`, JSON.stringify(fixtures, null, 2));
    console.log('Fixtures saved.');
  } catch (err) {
    console.error('Error scraping fixtures:', err);
    process.exit(1);
  }
}

main();
