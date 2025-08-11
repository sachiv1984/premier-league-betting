import puppeteer from 'puppeteer';

async function fetchCurrentGameweekFixtures() {
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'], // Crucial for GitHub Actions & similar
  });
  const page = await browser.newPage();

  try {
    console.log('Navigating to Premier League matches page...');
    await page.goto('https://www.premierleague.com/matches', { waitUntil: 'networkidle2' });

    // Wait for the matchweek dropdown or active matchweek element
    await page.waitForSelector('.matchWeekDropdown');

    // Extract current matchweek number from the dropdown or active selection
    const currentMatchweek = await page.evaluate(() => {
      // The active matchweek is highlighted in the dropdown menu
      const activeOption = document.querySelector('.matchWeekDropdown option[selected]');
      if (activeOption) {
        return parseInt(activeOption.textContent.trim().replace('Matchweek ', ''), 10);
      }
      // Fallback: try to get from URL or another element if needed
      return null;
    });

    if (!currentMatchweek) {
      throw new Error('Could not determine current matchweek');
    }
    console.log('Current matchweek:', currentMatchweek);

    // Now navigate specifically to the current matchweek URL (filtered by matchweek)
    const matchweekUrl = `https://www.premierleague.com/en/matches?matchweek=${currentMatchweek}`;
    await page.goto(matchweekUrl, { waitUntil: 'networkidle2' });

    // Wait for matches to load
    await page.waitForSelector('.matchFixtureContainer');

    // Extract fixture data for this matchweek
    const fixtures = await page.evaluate(() => {
      const matches = Array.from(document.querySelectorAll('.matchFixtureContainer'));
      return matches.map(match => {
        const homeTeam = match.querySelector('.team.home .teamName').textContent.trim();
        const awayTeam = match.querySelector('.team.away .teamName').textContent.trim();

        // Date/time as text
        const dateTime = match.querySelector('.fixtureDate')?.textContent.trim() || '';

        // Get match status: "Postponed", "FT", "LIVE", or empty
        const status = match.querySelector('.fixtureStatus')?.textContent.trim() || '';

        // Get score if available (else null)
        const scoreHome = match.querySelector('.score.fullTime .home')?.textContent.trim() || null;
        const scoreAway = match.querySelector('.score.fullTime .away')?.textContent.trim() || null;

        // Return fixture info with score if available
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

async function main() {
  try {
    const { currentMatchweek, fixtures } = await fetchCurrentGameweekFixtures();
    console.log(`Fixtures for matchweek ${currentMatchweek}:`);
    fixtures.forEach(fixture => {
      const scoreDisplay = fixture.score ? `Score: ${fixture.score}` : 'Score: N/A';
      const statusDisplay = fixture.status ? `Status: ${fixture.status}` : '';
      console.log(`${fixture.homeTeam} vs ${fixture.awayTeam} | ${fixture.dateTime} | ${scoreDisplay} ${statusDisplay}`);
    });
  } catch (error) {
    console.error('Error during update:', error);
  }
}

main();
