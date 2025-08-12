import fs from 'fs/promises';
import path from 'path';
import { parse as csvParse } from 'csv-parse/sync';

function parseDate(dateStr) {
  if (!dateStr) return null;
  const [day, month, year] = dateStr.split('/');
  const fullYear = parseInt(year) < 50 ? 2000 + parseInt(year) : 1900 + parseInt(year);
  return new Date(fullYear, parseInt(month) - 1, parseInt(day));
}

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
  const daysDiff = Math.floor((matchDate - seasonStartDate) / (1000 * 60 * 60 * 24));
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
    await fs.mkdir('./public', { recursive: true }); // Always create public folder

    const requestedGameweek = process.argv[2] ? Number(process.argv[2]) : null;
    const csvPath = path.resolve('./data/fixtures.csv');
    const csvData = await fs.readFile(csvPath, 'utf-8');

    const records = csvParse(csvData, {
      columns: true,
      skip_empty_lines: true,
    });

    const premierLeagueTeams = detectPremierLeagueTeams(records);

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

    if (validRecords.length === 0) {
      console.error('No valid fixture records found');
    }

    const seasonStart = validRecords.length ? validRecords[0].parsedDate : new Date();
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
    const formattedFixtures = fixtures.map(formatMatch);
    const isComplete = fixtures.length ? isGameweekComplete(fixtures) : false;

    // Save JSON data for API use
    const jsonOutput = {
      gameweek: targetGameweek,
      isComplete: isComplete,
      fixtures: formattedFixtures,
      lastUpdated: new Date().toISOString()
    };
    const jsonOutputPath = path.resolve(`./public/gameweek-${targetGameweek}.json`);
    await fs.writeFile(jsonOutputPath, JSON.stringify(jsonOutput, null, 2));

    // Always generate HTML pages & index
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

  const gwLinks = gameweeks.map(gw => {
    return `<li><a href="gameweek-${gw}.html">Gameweek ${gw}</a></li>`;
  }).join('\n');

  const htmlContent = `
  <html>
  <head>
    <title>Premier League Fixtures</title>
    <style>
      body { font-family: Arial; margin: 20px; }
      h1 { color: #333; }
      ul { line-height: 1.8; }
    </style>
  </head>
  <body>
    <h1>Premier League Fixtures</h1>
    <h2>Current Gameweek: ${currentGW}</h2>
    <ul>
      ${gwLinks}
    </ul>
  </body>
  </html>
  `;

  await fs.writeFile('./public/index.html', htmlContent);
}

async function generateAllGameweekPages(fixturesByGameweek) {
  const gameweeks = Object.keys(fixturesByGameweek).map(Number).sort((a, b) => a - b);
  for (const gw of gameweeks) {
    const fixtures = fixturesByGameweek[gw] || [];
    const formattedFixtures = fixtures.map(formatMatch);

    const matchesHtml = formattedFixtures.map(match => {
      return `<li>${match.homeTeam} vs ${match.awayTeam} - ${match.score} (${match.status})</li>`;
    }).join('\n');

    const htmlContent = `
    <html>
    <head>
      <title>Gameweek ${gw} Fixtures</title>
      <style>
        body { font-family: Arial; margin: 20px; }
        h1 { color: #333; }
        ul { line-height: 1.8; }
      </style>
    </head>
    <body>
      <h1>Gameweek ${gw}</h1>
      <ul>
        ${matchesHtml || '<li>No fixtures found.</li>'}
      </ul>
      <p><a href="index.html">Back to Index</a></p>
    </body>
    </html>
    `;

    await fs.writeFile(`./public/gameweek-${gw}.html`, htmlContent);
  }
}

main();
