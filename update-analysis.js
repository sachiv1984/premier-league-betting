import fs from 'fs/promises';

async function main() {
  try {
    // Load the scraped fixtures JSON instead of scraping again
    const matchweek = 1; // Adjust dynamically if needed
    const data = await fs.readFile(`./public/fixtures-matchweek-${matchweek}.json`, 'utf-8');
    const fixtures = JSON.parse(data);

    console.log('Loaded fixtures from JSON:', fixtures);

    // Now use fixtures data for your betting analysis logic...

    // Example: just print all fixtures
    fixtures.forEach(fixture => {
      console.log(`${fixture.homeTeam} vs ${fixture.awayTeam} — Status: ${fixture.status} — Score: ${fixture.scoreHome || '-'} : ${fixture.scoreAway || '-'}`);
    });

    // Your betting analysis code continues here...
    // e.g., fetch odds, calculate stats, generate report, save files etc.

  } catch (err) {
    console.error('Error during analysis:', err);
  }
}

main();
