import fs from 'fs/promises';
import https from 'https';
import { parse } from 'csv-parse/sync';

const CSV_URL = 'https://www.football-data.co.uk/mmz4281/2526/E0.csv';

async function downloadCSV(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed to get CSV, status ${res.statusCode}`));
      }
      let data = '';
      res.on('data', (chunk) => (data += chunk));
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
    await fs.mkdir('./public', { recursive: true });
    await fs.writeFile('./public/fixtures-latest.json', JSON.stringify(records, null, 2));

    // Save CSV locally for further analysis
    await fs.mkdir('./data', { recursive: true });
    await fs.writeFile('./data/fixtures.csv', csvData);

    console.log('CSV and JSON files saved successfully.');
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

main();
