import fs from 'fs/promises';
import path from 'path';
import { parse as csvParse } from 'csv-parse/sync'; // Corrected import

async function main() {
  try {
    const matchweek = process.argv[2] ? Number(process.argv[2]) : 1;
    const csvPath = path.resolve('./data/fixtures.csv');
    const csvData = await fs.readFile(csvPath, 'utf-8');

    // Parse CSV
    const records = csvParse(csvData, {
      columns: true,
      skip_empty_lines: true,
    });

    // Filter records for this matchweek (assuming a 'matchweek' column)
    const fixtures = records.filter(f => Number(f.matchweek) === matchweek);

    if (!fixtures.length) {
      console.warn(`No fixtures found for matchweek ${matchweek}`);
    } else {
      console.log(`Loaded ${fixtures.length} fixtures for Matchweek ${matchweek}`);
    }

    // Save fixtures for the current matchweek
    const jsonOutputPath = path.resolve(`./public/fixtures-matchweek-${matchweek}.json`);
    await fs.writeFile(jsonOutputPath, JSON.stringify(fixtures, null, 2), 'utf-8');
    console.log(`Saved fixtures JSON to ${jsonOutputPath}`);

    // Example usage: print fixtures summary
    fixtures.forEach(fixture => {
      console.log(`${fixture.homeTeam} vs ${fixture.awayTeam} — Status: ${fixture.status || '-'} — Score: ${fixture.scoreHome || '-'} : ${fixture.scoreAway || '-'}`);
    });

    // Generate index file
    console.log('Generating index file...');
    const matchweeks = [...new Set(records.map(f => Number(f.matchweek)))].sort((a, b) => a - b);
    const index = matchweeks.map(week => ({
      matchweek: week,
      fixtureCount: records.filter(f => Number(f.matchweek) === week).length,
    }));

    const indexOutputPath = path.resolve('./public/fixtures-index.json');
    await fs.writeFile(indexOutputPath, JSON.stringify(index, null, 2), 'utf-8');
    console.log(`Saved index JSON to ${indexOutputPath}`);

    // TODO: Add your betting analysis logic here using fixtures array

  } catch (err) {
    console.error('Error during analysis:', err);
    process.exit(1);
  }
}

main();
