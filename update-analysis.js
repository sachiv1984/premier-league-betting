import fs from 'fs/promises';

async function main() {
  try {
    const matchweek = process.argv[2] ? Number(process.argv[2]) : 1;
    const data = await fs.readFile(`./public/fixtures-matchweek-${matchweek}.json`, 'utf-8');
    const fixtures = JSON.parse(data);

    console.log(`Loaded ${fixtures.length} fixtures from JSON for Matchweek ${matchweek}`);

    // Example usage: print fixtures
    fixtures.forEach(fixture => {
      console.log(`${fixture.homeTeam} vs ${fixture.awayTeam} — Status: ${fixture.status} — Score: ${fixture.scoreHome || '-'} : ${fixture.scoreAway || '-'}`);
    });

    // Your betting analysis and report generation logic goes here...

  } catch (err) {
    console.error('Error during analysis:', err);
    process.exit(1);
  }
}

main();
