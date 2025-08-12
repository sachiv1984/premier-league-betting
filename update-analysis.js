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

// Function to detect Premier League teams dynamically from the data
function detectPremierLeagueTeams(records) {
  const teamMatchCounts = {};
  records.forEach(record => {
    if (record.HomeTeam && record.AwayTeam && record.Date) {
      teamMatchCounts[record.HomeTeam] = (teamMatchCounts[record.HomeTeam] || 0) + 1;
      teamMatchCounts[record.AwayTeam] = (teamMatchCounts[record.AwayTeam] || 0) + 1;
    }
  });
  return Object.keys(teamMatchCounts)
    .filter(team => {
      const matchCount = teamMatchCounts[team];
      return matchCount >= 30 && matchCount <= 40;
    })
    .sort();
}

function isPremierLeagueMatch(homeTeam, awayTeam, premierLeagueTeams) {
  return premierLeagueTeams.includes(homeTeam) && premierLeagueTeams.includes(awayTeam);
}

function calculateGameweek(matchDate, seasonStartDate) {
  if (!matchDate || !seasonStartDate) return 1;
  const timeDiff = matchDate - seasonStartDate;
  const daysDiff = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
  return Math.max(1, Math.min(38, Math.floor(daysDiff / 7) + 1));
}

function getMatchStatus(matchDate, homeGoals, awayGoals) {
  const now = new Date();
  const matchTime = new Date(matchDate);
  if (homeGoals !== '' && awayGoals !== '' && !isNaN(homeGoals) && !isNaN(awayGoals)) {
    return 'completed';
  }
  const twoHoursAgo = new Date(now.getTime() - (2 * 60 * 60 * 1000));
  if (matchTime < twoHoursAgo && matchTime > new Date(now.getTime() - (24 * 60 * 60 * 1000))) {
    return 'ongoing';
  }
  if (matchTime < now) {
    return 'postponed';
  }
  return 'upcoming';
}

function formatMatch(fixture) {
  const status = getMatchStatus(fixture.Date, fixture.FTHG, fixture.FTAG);
  const matchDate = parseDate(fixture.Date);
  const timeStr = fixture.Time || 'TBD';
  let scoreDisplay = '';
  if (status === 'completed') scoreDisplay = `${fixture.FTHG} - ${fixture.FTAG}`;
  else if (status === 'ongoing') scoreDisplay = `${fixture.FTHG || 0} - ${fixture.FTAG || 0} (LIVE)`;
  else if (status === 'postponed') scoreDisplay = 'POSTPONED';
  else scoreDisplay = `${timeStr}`;
  return {
    homeTeam: fixture.HomeTeam,
    awayTeam: fixture.AwayTeam,
    score: scoreDisplay,
    date: matchDate ? matchDate.toLocaleDateString('en-GB') : fixture.Date,
    time: timeStr,
    status: status,
    gameweek: fixture.gameweek
  };
}

function isGameweekComplete(fixtures) {
  return fixtures.every(fixture => {
    const status = getMatchStatus(fixture.Date, fixture.FTHG, fixture.FTAG);
    return status === 'completed' || status === 'postponed';
  });
}

function getCurrentGameweek(fixturesByGameweek) {
  for (let gw = 1; gw <= 38; gw++) {
    const fixtures = fixturesByGameweek[gw] || [];
    if (fixtures.length > 0 && !isGameweekComplete(fixtures)) {
      return gw;
    }
  }
  return 1;
}

async function main() {
  try {
    const requestedGameweek = process.argv[2] ? Number(process.argv[2]) : null;
    const csvPath = path.resolve('./data/fixtures.csv');
    const csvData = await fs.readFile(csvPath, 'utf-8');

    console.log('Parsing CSV...');
    const records = csvParse(csvData, {
      columns: true,
      skip_empty_lines: true,
    });

    console.log(`Loaded ${records.length} total records`);

    // Detect Premier League teams first
    const premierLeagueTeams = detectPremierLeagueTeams(records);
    console.log(`Detected ${premierLeagueTeams.length} Premier League teams`);
    console.log(premierLeagueTeams.join(', '));

    // Filter valid Premier League fixtures
    const validRecords = records
      .filter(record =>
        record.Date &&
        record.HomeTeam &&
        record.AwayTeam &&
        isPremierLeagueMatch(record.HomeTeam, record.AwayTeam, premierLeagueTeams)
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

    const seasonStart = validRecords[0].parsedDate;
    console.log(`Season start detected: ${seasonStart.toLocaleDateString('en-GB')}`);

    const fixturesWithGameweeks = validRecords.map(record => ({
      ...record,
      gameweek: calculateGameweek(record.parsedDate, seasonStart)
    }));

    const fixturesByGameweek = {};
    fixturesWithGameweeks.forEach(fixture => {
      if (!fixturesByGameweek[fixture.gameweek]) {
        fixturesByGameweek[fixture.gameweek] = [];
      }
      fixturesByGameweek[fixture.gameweek].push(fixture);
    });

    const targetGameweek = requestedGameweek || getCurrentGameweek(fixturesByGameweek);
    const fixtures = fixturesByGameweek[targetGameweek] || [];

    if (!fixtures.length) {
      console.warn(`No fixtures found for gameweek ${targetGameweek}`);
      return;
    }

    console.log(`\n=== PREMIER LEAGUE GAMEWEEK ${targetGameweek} ===`);
    console.log(`Found ${fixtures.length} fixtures\n`);

    const formattedFixtures = fixtures.map(formatMatch);
    const isComplete = isGameweekComplete(fixtures);

    console.log(`Status: ${isComplete ? 'COMPLETE' : 'IN PROGRESS'}`);
    console.log('─'.repeat(60));

    formattedFixtures.forEach(match => {
      const statusEmoji = {
        'completed': '✓',
        'ongoing': '🔴',
        'upcoming': '⏰',
        'postponed': '⚠️'
      }[match.status] || '';
      console.log(`${statusEmoji} ${match.homeTeam} vs ${match.awayTeam}`);
      console.log(`   ${match.score} | ${match.date}`);
      console.log('');
    });

    // JSON Output
    const jsonOutput = {
      gameweek: targetGameweek,
      isComplete: isComplete,
      fixtures: formattedFixtures,
      lastUpdated: new Date().toISOString()
    };

    await fs.mkdir('./public', { recursive: true });
    const jsonOutputPath = path.resolve(`./public/gameweek-${targetGameweek}.json`);
    await fs.writeFile(jsonOutputPath, JSON.stringify(jsonOutput, null, 2));
    console.log(`Saved gameweek data to ${jsonOutputPath}`);

    // Generate HTML and indexes
    await generateAllGameweekPages(fixturesByGameweek);
    await generateMainIndex(fixturesByGameweek);

  } catch (err) {
    console.error('Error during analysis:', err);
    process.exit(1);
  }
}

async function generateMainIndex(fixturesByGameweek) {
  const gameweeks = Object.keys(fixturesByGameweek).map(Number).sort((a, b) => a - b);
  const currentGW = getCurrentGameweek(fixturesByGameweek);
  const htmlOutputPath = path.resolve('./public/index.html');
  const htmlContent = `<html><body><h1>Premier League Fixtures</h1></body></html>`; // simplified for brevity
  await fs.writeFile(htmlOutputPath, htmlContent);
  console.log('Generated main index at ./public/index.html');
}

async function generateAllGameweekPages(fixturesByGameweek) {
  const gameweeks = Object.keys(fixturesByGameweek).map(Number).sort((a, b) => a - b);
  for (const gw of gameweeks) {
    const fixtures = fixturesByGameweek[gw] || [];
    if (fixtures.length === 0) continue;
    const htmlOutputPath = path.resolve(`./public/gameweek-${gw}.html`);
    const htmlContent = `<html><body><h1>Gameweek ${gw}</h1></body></html>`; // simplified for brevity
    await fs.writeFile(htmlOutputPath, htmlContent);
  }
  console.log(`Generated HTML files for ${gameweeks.length} gameweeks`);
}

main();

