import fs from 'fs/promises';
import https from 'https';
import { parse } from 'csv-parse/sync';

const CSV_URL = 'https://www.football-data.co.uk/mmz4281/2526/E0.csv';

async function downloadCSV(url, retries = 5, delay = 10000) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'PremierLeagueBettingBot/1.0 (https://github.com/sachiv1984)',
      },
    };

    https.get(url, options, (res) => {
      console.log(`Response Status: ${res.statusCode}`);
      console.log(`Response Headers:`, res.headers);

      if (res.statusCode >= 300 && res.statusCode < 400) {
        const location = res.headers.location;
        if (!location) {
          return reject(
            new Error(
              `Redirection status ${res.statusCode} received but no Location header provided. Full headers: ${JSON.stringify(
                res.headers,
                null,
                2
              )}`
            )
          );
        }

        console.warn(`Redirected to: ${location}`);
        const redirectUrl = new URL(location, url).href;
        console.warn(`Resolved redirect URL: ${redirectUrl}`);
        resolve(downloadCSV(redirectUrl, retries, delay));
        return;
      }

      if (res.statusCode === 429 && retries > 0) {
        console.warn(`Rate limited. Retrying in ${delay / 1000} seconds...`);
        setTimeout(() => {
          resolve(downloadCSV(url, retries - 1, delay));
        }, delay);
        return;
      }

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

