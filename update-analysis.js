import fs from 'fs/promises';
import path from 'path';
import csvParse from 'csv-parse/lib/sync';

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

    // Example: convert fixtures to simplified JSON format and save
    const jsonOutputPath = path.resolve(`./public/fixtures-matchweek-${matchweek}.json`);
    await fs.writeFile(jsonOutputPath, JSON.stringify(fixtures, null, 2), 'utf-8');
    console.log(`Saved fixtures JSON to ${jsonOutputPath}`);

    // Example usage: print fixtures summary
    fixtures.forEach(fixture => {
      console.log(`${fixture.homeTeam} vs ${fixture.awayTeam} — Status: ${fixture.status || '-'} — Score: ${fixture.scoreHome || '-'} : ${fixture.scoreAway || '-'}`);
    });

    // TODO: Add your betting analysis logic here using fixtures array

  } catch (err) {
    console.error('Error during analysis:', err);
    process.exit(1);
  }
}

main();
