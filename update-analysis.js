import fs from 'fs/promises';
import path from 'path';
import { parse as csvParse } from 'csv-parse/sync';

// Function to parse date from DD/MM/YY format
function parseDate(dateStr) {
  if (!dateStr) return null;
  const [day, month, year] = dateStr.split('/');
  const fullYear = parseInt(year) < 50 ? 2000 + parseInt(year) : 1900 + parseInt(year);
  return new Date(fullYear, parseInt(month) - 1, parseInt(day));
}

// Premier League teams for 2024/25 season
const PREMIER_LEAGUE_TEAMS = [
  'Arsenal', 'Aston Villa', 'Bournemouth', 'Brentford', 'Brighton',
  'Burnley', 'Chelsea', 'Crystal Palace', 'Everton', 'Fulham',
  'Liverpool', 'Luton', 'Man City', 'Man United', 'Newcastle',
  'Norwich', 'Sheffield United', 'Tottenham', 'West Ham', 'Wolves'
];

// Function to check if a match involves Premier League teams
function isPremierLeagueMatch(homeTeam, awayTeam) {
  return PREMIER_LEAGUE_TEAMS.includes(homeTeam) && PREMIER_LEAGUE_TEAMS.includes(awayTeam);
}

async function main() {
  try {
    const csvPath = path.resolve('./data/fixtures.csv');
    const csvData = await fs.readFile(csvPath, 'utf-8');
    
    console.log('Parsing CSV...');
    const records = csvParse(csvData, {
      columns: true,
      skip_empty_lines: true,
    });

    console.log(`Loaded ${records.length} total records`);

    // Filter out records without proper dates, only Premier League teams, and sort by date
    const validRecords = records
      .filter(record => 
        record.Date && 
        record.HomeTeam && 
        record.AwayTeam &&
        isPremierLeagueMatch(record.HomeTeam, record.AwayTeam)
      )
      .map(record => ({
        ...record,
        parsedDate: parseDate(record.Date)
      }))
      .filter(record => record.parsedDate)
      .sort((a, b) => a.parsedDate - b.parsedDate);

    console.log(`Found ${validRecords.length} Premier League fixtures`);

    if (validRecords.length === 0) {
      console.error('No valid fixture records found');
      return;
    }

    // Further processing logic goes here...

  } catch (err) {
    console.error('Error during analysis:', err);
    process.exit(1);
  }
}

main();
