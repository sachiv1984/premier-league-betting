import fs from 'fs/promises';
import https from 'https';
import { parse } from 'csv-parse/sync';

// URL of the latest Premier League CSV on football-data.co.uk (adjust season as needed)
const CSV_URL = 'https://www.football-data.co.uk/mmz4281/2526/E0.csv'; // Example: 2025/26 season Premier League

async function downloadCSV(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed to get CSV, status ${res.statusCode}`));
      }
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function main() {
  try {
    console.log('Downloading CSV...');
    const csvData = await downloadCSV(CSV_URL);

    console.log('Parsing CSV...');
    const records = parse(csvData, {
      columns: true,
      skip_empty_lines: true,
    });

    console.log(`Parsed ${records.length} records`);

    // Save raw JSON locally (optional)
    await fs.writeFile('./public/fixtures-latest.json', JSON.stringify(records, null, 2));

    // Now you can run your existing analysis on 'records'
    // Example: print first 5 matches
    records.slice(0, 5).forEach(match => {
      console.log(`${match.HomeTeam} vs ${match.AwayTeam} on ${match.Date}`);
    });

    // TODO: Insert your betting analysis code here that consumes `records`

  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

main();
