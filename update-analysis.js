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

    // Generate index file
    console.log('Generating index file...');
    const matchweeks = [...new Set(records.map(f => Number(f.matchweek)))].sort((a, b) => a - b);
    const index = matchweeks.map(week => ({
      matchweek: week,
      fixtureCount: records.filter(f => Number(f.matchweek) === week).length,
    }));

    // Generate HTML content
    const htmlContent = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Fixtures Index</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            margin: 20px;
            padding: 0;
          }
          h1 {
            color: #461E96;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
          }
          th, td {
            border: 1px solid #ddd;
            padding: 8px;
            text-align: left;
          }
          th {
            background-color: #00B4E6;
            color: white;
          }
          tr:nth-child(even) {
            background-color: #f2f2f2;
          }
          a {
            color: #461E96;
            text-decoration: none;
          }
          a:hover {
            text-decoration: underline;
          }
        </style>
      </head>
      <body>
        <h1>Fixtures Index</h1>
        <p>Below is a summary of all matchweeks and their corresponding fixture counts. Click on a matchweek to view its fixtures.</p>
        <table>
          <thead>
            <tr>
              <th>Matchweek</th>
              <th>Fixture Count</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            ${index
              .map(
                ({ matchweek, fixtureCount }) => `
              <tr>
                <td>${matchweek}</td>
                <td>${fixtureCount}</td>
                <td><a href="./fixtures-matchweek-${matchweek}.json" target="_blank">View Fixtures</a></td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </body>
      </html>
    `;

    const htmlOutputPath = path.resolve('./public/index.html');
    await fs.writeFile(htmlOutputPath, htmlContent, 'utf-8');
    console.log(`Saved HTML index to ${htmlOutputPath}`);

    // TODO: Add your betting analysis logic here using fixtures array

  } catch (err) {
    console.error('Error during analysis:', err);
    process.exit(1);
  }
}

main();
