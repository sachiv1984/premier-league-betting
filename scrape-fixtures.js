import puppeteer from 'puppeteer';
import fs from 'fs';

async function scrapeFixtures() {
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'], // for CI/CD environments
  });
  const page = await browser.newPage();

  // Go to BBC Premier League fixtures page
  await page.goto('https://www.bbc.com/sport/football/premier-league/scores-fixtures', { waitUntil: 'networkidle2' });

  // Wait for fixtures container
  await page.waitForSelector('.qa-match-block');

  // Extract fixture data
  const fixtures = await page.evaluate(() => {
    const weeks = [];
    const blocks = document.querySelectorAll('.qa-match-block');

    blocks.forEach(block => {
      const matchweekDate = block.querySelector('h3').innerText.trim(); // e.g. "Saturday 12 August 2023"
      const matches = [];
      block.querySelectorAll('.gs-o-list-ui__item').forEach(matchEl => {
        const teams = matchEl.querySelectorAll('.gs-o-list-ui__item .gs-u-display-none.gs-u-display-block@m.qa-full-team-name');
        const homeTeam = teams[0]?.innerText.trim();
        const awayTeam = teams[1]?.innerText.trim();
        const scoreEl = matchEl.querySelector('.sp-c-fixture__number--ft');
        const score = scoreEl ? scoreEl.innerText.trim() : null;
        const kickoffEl = matchEl.querySelector('.sp-c-fixture__number--time');
        const kickoff = kickoffEl ? kickoffEl.innerText.trim() : null;

        matches.push({
          homeTeam,
          awayTeam,
          score,
          kickoff,
        });
      });
      weeks.push({ date: matchweekDate, matches });
    });

    return weeks;
  });

  await browser.close();

  // Save the data to JSON
  fs.writeFileSync('./public/fixtures.json', JSON.stringify(fixtures, null, 2));
  console.log('Fixtures saved to public/fixtures.json');
}

scrapeFixtures().catch(console.error);
