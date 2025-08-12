import fs from 'fs/promises';
import https from 'https';
import { parse } from 'csv-parse/sync';

const BASE_URL = 'https://www.football-data.co.uk';
const CSV_URL = `${BASE_URL}/mmz4281/2526/E0.csv`;

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
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => {
            console.error(
              `Redirection status ${res.statusCode} received but no Location header provided. Full headers: ${JSON.stringify(
                res.headers,
                null,
                2
              )}. Response body: ${body}`
            );

            // Extract suggested URLs from the response body
            const matches = [...body.matchAll(/<a href="([^"]+)">/g)];
            const suggestions = matches.map((match) => match[1]);

            if (suggestions.length > 0) {
              console.warn(`Suggested files: ${suggestions.join(', ')}`);
              resolve(suggestions.map((path) => `${BASE_URL}${path}`)); // Return full URLs
            } else {
              reject(
                new Error(
                  `Redirection status ${res.statusCode} received but no Location header or suggestions provided.`
                )
              );
            }
          });
          return;
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
    let csvData = await downloadCSV(CSV_URL);

    // If the result is an array of suggested URLs, try them one by one
    if (Array.isArray(csvData)) {
      for (const url of csvData) {
        try {
          console.log(`Trying suggested URL: ${url}`);
          csvData = await downloadCSV(url);
          break; // Exit the loop if successful
        } catch (err) {
          console.warn(`Failed to download from suggested URL: ${url}`);
        }
      }

      if (Array.isArray(csvData)) {
        throw new Error('Failed to download CSV from all suggested URLs.');
      }
    }

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
