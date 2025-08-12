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

// Function to determine gameweek based on Premier League scheduling
function calculateGameweek(matchDate, seasonStartDate) {
  if (!matchDate || !seasonStartDate) return 1;
  
  const timeDiff = matchDate - seasonStartDate;
  const daysDiff = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
  
  // Premier League typically has matches every 7-10 days
  // We'll use 7-day intervals as base, with some flexibility
  let gameweek = Math.floor(daysDiff / 7) + 1;
  
  // Ensure gameweek is between 1 and 38 (Premier League has 38 gameweeks)
  return Math.max(1, Math.min(38, gameweek));
}

// Function to determine if a match is completed, ongoing, or upcoming
function getMatchStatus(matchDate, homeGoals, awayGoals) {
  const now = new Date();
  const matchTime = new Date(matchDate);
  
  // If we have scores, the match is completed
  if (homeGoals !== '' && awayGoals !== '' && !isNaN(homeGoals) && !isNaN(awayGoals)) {
    return 'completed';
  }
  
  // If match was scheduled to start more than 2 hours ago but no score, might be ongoing
  const twoHoursAgo = new Date(now.getTime() - (2 * 60 * 60 * 1000));
  if (matchTime < twoHoursAgo && matchTime > new Date(now.getTime() - (24 * 60 * 60 * 1000))) {
    return 'ongoing';
  }
  
  // If match is in the past but no score, treat as postponed/cancelled
  if (matchTime < now) {
    return 'postponed';
  }
  
  return 'upcoming';
}

// Function to format match display
function formatMatch(fixture) {
  const status = getMatchStatus(fixture.Date, fixture.FTHG, fixture.FTAG);
  const matchDate = parseDate(fixture.Date);
  const timeStr = fixture.Time || 'TBD';
  
  let scoreDisplay = '';
  if (status === 'completed') {
    scoreDisplay = `${fixture.FTHG} - ${fixture.FTAG}`;
  } else if (status === 'ongoing') {
    scoreDisplay = `${fixture.FTHG || 0} - ${fixture.FTAG || 0} (LIVE)`;
  } else if (status === 'postponed') {
    scoreDisplay = 'POSTPONED';
  } else {
    scoreDisplay = `${timeStr}`;
  }
  
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

// Function to check if a gameweek is complete
function isGameweekComplete(fixtures) {
  return fixtures.every(fixture => {
    const status = getMatchStatus(fixture.Date, fixture.FTHG, fixture.FTAG);
    return status === 'completed' || status === 'postponed';
  });
}

// Function to get current gameweek (first incomplete gameweek)
function getCurrentGameweek(fixturesByGameweek) {
  for (let gw = 1; gw <= 38; gw++) {
    const fixtures = fixturesByGameweek[gw] || [];
    if (fixtures.length > 0 && !isGameweekComplete(fixtures)) {
      return gw;
    }
  }
  return 1; // Fallback to gameweek 1
}

async function main() {
  try {
    // Allow manual gameweek selection or auto-detect current gameweek
    const requestedGameweek = process.argv[2] ? Number(process.argv[2]) : null;
    const csvPath = path.resolve('./data/fixtures.csv');
    const csvData = await fs.readFile(csvPath, 'utf-8');
    
    console.log('Parsing CSV...');
    const records = csvParse(csvData, {
      columns: true,
      skip_empty_lines: true,
    });
    
    console.log(`Loaded ${records.length} total records`);
    console.log(`Found ${validRecords.length} Premier League fixtures`);
    
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
    
    if (validRecords.length === 0) {
      console.error('No valid fixture records found');
      return;
    }
    
    // Determine season start (first match date)
    const seasonStart = validRecords[0].parsedDate;
    console.log(`Season start detected: ${seasonStart.toLocaleDateString('en-GB')}`);
    
    // Calculate gameweeks for all fixtures
    const fixturesWithGameweeks = validRecords.map(record => ({
      ...record,
      gameweek: calculateGameweek(record.parsedDate, seasonStart)
    }));
    
    // Group fixtures by gameweek
    const fixturesByGameweek = {};
    fixturesWithGameweeks.forEach(fixture => {
      const gw = fixture.gameweek;
      if (!fixturesByGameweek[gw]) {
        fixturesByGameweek[gw] = [];
      }
      fixturesByGameweek[gw].push(fixture);
    });
    
    // Determine which gameweek to display
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
    
    // Display fixtures
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
    
    // Save JSON output for web display
    const jsonOutput = {
      gameweek: targetGameweek,
      isComplete: isComplete,
      fixtures: formattedFixtures,
      lastUpdated: new Date().toISOString()
    };
    
    await fs.mkdir('./public', { recursive: true });
    const jsonOutputPath = path.resolve(`./public/gameweek-${targetGameweek}.json`);
    await fs.writeFile(jsonOutputPath, JSON.stringify(jsonOutput, null, 2));
    console.log(`\nSaved gameweek data to ${jsonOutputPath}`);
    
    // Generate HTML display
    const htmlContent = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Premier League Gameweek ${targetGameweek}</title>
        <style>
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            margin: 0;
            padding: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
          }
          .container {
            max-width: 800px;
            margin: 0 auto;
            background: white;
            border-radius: 15px;
            padding: 30px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.3);
          }
          h1 {
            color: #38003c;
            text-align: center;
            margin-bottom: 10px;
            font-size: 2.5em;
          }
          .status {
            text-align: center;
            font-size: 1.2em;
            margin-bottom: 30px;
            padding: 10px;
            border-radius: 8px;
            font-weight: bold;
          }
          .status.complete {
            background: #e8f5e8;
            color: #2d5a2d;
          }
          .status.in-progress {
            background: #fff3cd;
            color: #856404;
          }
          .fixture {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 20px;
            margin: 10px 0;
            border-radius: 10px;
            background: #f8f9fa;
            border-left: 5px solid #38003c;
            transition: transform 0.2s;
          }
          .fixture:hover {
            transform: translateX(5px);
            box-shadow: 0 5px 15px rgba(0,0,0,0.1);
          }
          .teams {
            flex: 1;
            font-size: 1.1em;
            font-weight: 600;
          }
          .score {
            flex: 0 0 auto;
            font-size: 1.3em;
            font-weight: bold;
            color: #38003c;
            text-align: center;
            min-width: 120px;
          }
          .score.live {
            color: #dc3545;
            animation: pulse 2s infinite;
          }
          .date-time {
            flex: 0 0 auto;
            color: #6c757d;
            font-size: 0.9em;
            text-align: right;
            min-width: 100px;
          }
          .status-indicator {
            font-size: 1.2em;
            margin-right: 10px;
          }
          @keyframes pulse {
            0% { opacity: 1; }
            50% { opacity: 0.6; }
            100% { opacity: 1; }
          }
          .last-updated {
            text-align: center;
            color: #6c757d;
            font-size: 0.9em;
            margin-top: 30px;
            font-style: italic;
          }
          .navigation {
            text-align: center;
            margin-bottom: 20px;
          }
          .nav-btn {
            background: #38003c;
            color: white;
            border: none;
            padding: 10px 20px;
            margin: 0 5px;
            border-radius: 5px;
            cursor: pointer;
            text-decoration: none;
            display: inline-block;
          }
          .nav-btn:hover {
            background: #2c0029;
          }
        </style>
        <script>
          // Auto-refresh every 5 minutes for live matches
          setTimeout(() => location.reload(), 5 * 60 * 1000);
        </script>
      </head>
      <body>
        <div class="container">
          <h1>Premier League Gameweek ${targetGameweek}</h1>
          
          <div class="navigation">
            ${targetGameweek > 1 ? `<a href="./gameweek-${targetGameweek - 1}.html" class="nav-btn">← GW ${targetGameweek - 1}</a>` : ''}
            <a href="./index.html" class="nav-btn">All Gameweeks</a>
            ${targetGameweek < 38 ? `<a href="./gameweek-${targetGameweek + 1}.html" class="nav-btn">GW ${targetGameweek + 1} →</a>` : ''}
          </div>
          
          <div class="status ${isComplete ? 'complete' : 'in-progress'}">
            ${isComplete ? '✓ Gameweek Complete' : '⏳ Gameweek In Progress'}
          </div>
          
          ${formattedFixtures.map(match => `
            <div class="fixture">
              <div class="status-indicator">
                ${match.status === 'completed' ? '✓' : 
                  match.status === 'ongoing' ? '🔴' : 
                  match.status === 'postponed' ? '⚠️' : '⏰'}
              </div>
              <div class="teams">
                ${match.homeTeam} vs ${match.awayTeam}
              </div>
              <div class="score ${match.status === 'ongoing' ? 'live' : ''}">
                ${match.score}
              </div>
              <div class="date-time">
                ${match.date}
              </div>
            </div>
          `).join('')}
          
          <div class="last-updated">
            Last updated: ${new Date().toLocaleString('en-GB')}
          </div>
        </div>
      </body>
      </html>
    `;
    
    const htmlOutputPath = path.resolve(`./public/gameweek-${targetGameweek}.html`);
    await fs.writeFile(htmlOutputPath, htmlContent);
    console.log(`Saved HTML display to ${htmlOutputPath}`);
    
    // Generate HTML files for all gameweeks (to fix navigation)
    await generateAllGameweekPages(fixturesByGameweek);
    
    // Generate or update main index
    await generateMainIndex(fixturesByGameweek);
    
  } catch (err) {
    console.error('Error during analysis:', err);
    process.exit(1);
  }
}

async function generateMainIndex(fixturesByGameweek) {
  const gameweeks = Object.keys(fixturesByGameweek)
    .map(Number)
    .sort((a, b) => a - b);
  
  const currentGW = getCurrentGameweek(fixturesByGameweek);
  
  const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Premier League Fixtures</title>
      <style>
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          margin: 0;
          padding: 20px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
        }
        .container {
          max-width: 1000px;
          margin: 0 auto;
          background: white;
          border-radius: 15px;
          padding: 30px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.3);
        }
        h1 {
          color: #38003c;
          text-align: center;
          margin-bottom: 30px;
          font-size: 2.5em;
        }
        .gameweeks {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: 15px;
          margin-top: 20px;
        }
        .gameweek-card {
          background: #f8f9fa;
          border-radius: 10px;
          padding: 20px;
          text-align: center;
          text-decoration: none;
          color: #333;
          transition: all 0.3s;
          border: 3px solid transparent;
        }
        .gameweek-card:hover {
          transform: translateY(-5px);
          box-shadow: 0 5px 15px rgba(0,0,0,0.2);
        }
        .gameweek-card.current {
          border-color: #38003c;
          background: linear-gradient(135deg, #38003c, #2c0029);
          color: white;
        }
        .gameweek-card.complete {
          background: #e8f5e8;
        }
        .gameweek-number {
          font-size: 1.5em;
          font-weight: bold;
          margin-bottom: 10px;
        }
        .gameweek-status {
          font-size: 0.9em;
          opacity: 0.8;
        }
        .current-indicator {
          background: #dc3545;
          color: white;
          padding: 5px 10px;
          border-radius: 15px;
          font-size: 0.8em;
          margin-top: 10px;
          display: inline-block;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Premier League 2025/26 Season</h1>
        <p style="text-align: center; color: #6c757d; font-size: 1.1em;">
          Click on any gameweek to view fixtures and results
        </p>
        
        <div class="gameweeks">
          ${gameweeks.map(gw => {
            const fixtures = fixturesByGameweek[gw] || [];
            const isComplete = isGameweekComplete(fixtures);
            const isCurrent = gw === currentGW;
            
            return `
              <a href="./gameweek-${gw}.html" class="gameweek-card ${isCurrent ? 'current' : ''} ${isComplete ? 'complete' : ''}">
                <div class="gameweek-number">Gameweek ${gw}</div>
                <div class="gameweek-status">
                  ${fixtures.length} fixtures
                  ${isComplete ? '✓' : isCurrent ? '⏳' : '⏰'}
                </div>
                ${isCurrent ? '<div class="current-indicator">CURRENT</div>' : ''}
              </a>
            `;
          }).join('')}
        </div>
        
        <div style="text-align: center; margin-top: 30px; color: #6c757d; font-style: italic;">
          Last updated: ${new Date().toLocaleString('en-GB')}
        </div>
      </div>
    </body>
    </html>
  `;
  
  const htmlOutputPath = path.resolve('./public/index.html');
  await fs.writeFile(htmlOutputPath, htmlContent);
  console.log('Generated main index at ./public/index.html');
}

// Function to generate HTML files for all gameweeks
async function generateAllGameweekPages(fixturesByGameweek) {
  const gameweeks = Object.keys(fixturesByGameweek).map(Number).sort((a, b) => a - b);
  
  for (const gw of gameweeks) {
    const fixtures = fixturesByGameweek[gw] || [];
    if (fixtures.length === 0) continue;
    
    const formattedFixtures = fixtures.map(formatMatch);
    const isComplete = isGameweekComplete(fixtures);
    
    const htmlContent = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Premier League Gameweek ${gw}</title>
        <style>
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            margin: 0;
            padding: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
          }
          .container {
            max-width: 800px;
            margin: 0 auto;
            background: white;
            border-radius: 15px;
            padding: 30px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.3);
          }
          h1 {
            color: #38003c;
            text-align: center;
            margin-bottom: 10px;
            font-size: 2.5em;
          }
          .status {
            text-align: center;
            font-size: 1.2em;
            margin-bottom: 30px;
            padding: 10px;
            border-radius: 8px;
            font-weight: bold;
          }
          .status.complete {
            background: #e8f5e8;
            color: #2d5a2d;
          }
          .status.in-progress {
            background: #fff3cd;
            color: #856404;
          }
          .fixture {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 20px;
            margin: 10px 0;
            border-radius: 10px;
            background: #f8f9fa;
            border-left: 5px solid #38003c;
            transition: transform 0.2s;
          }
          .fixture:hover {
            transform: translateX(5px);
            box-shadow: 0 5px 15px rgba(0,0,0,0.1);
          }
          .teams {
            flex: 1;
            font-size: 1.1em;
            font-weight: 600;
          }
          .score {
            flex: 0 0 auto;
            font-size: 1.3em;
            font-weight: bold;
            color: #38003c;
            text-align: center;
            min-width: 120px;
          }
          .score.live {
            color: #dc3545;
            animation: pulse 2s infinite;
          }
          .date-time {
            flex: 0 0 auto;
            color: #6c757d;
            font-size: 0.9em;
            text-align: right;
            min-width: 100px;
          }
          .status-indicator {
            font-size: 1.2em;
            margin-right: 10px;
          }
          @keyframes pulse {
            0% { opacity: 1; }
            50% { opacity: 0.6; }
            100% { opacity: 1; }
          }
          .last-updated {
            text-align: center;
            color: #6c757d;
            font-size: 0.9em;
            margin-top: 30px;
            font-style: italic;
          }
          .navigation {
            text-align: center;
            margin-bottom: 20px;
          }
          .nav-btn {
            background: #38003c;
            color: white;
            border: none;
            padding: 10px 20px;
            margin: 0 5px;
            border-radius: 5px;
            cursor: pointer;
            text-decoration: none;
            display: inline-block;
          }
          .nav-btn:hover {
            background: #2c0029;
          }
          .nav-btn:disabled {
            background: #ccc;
            cursor: not-allowed;
          }
        </style>
        <script>
          // Auto-refresh every 5 minutes for live matches
          setTimeout(() => location.reload(), 5 * 60 * 1000);
        </script>
      </head>
      <body>
        <div class="container">
          <h1>Premier League Gameweek ${gw}</h1>
          
          <div class="navigation">
            ${gw > 1 ? `<a href="./gameweek-${gw - 1}.html" class="nav-btn">← GW ${gw - 1}</a>` : '<span class="nav-btn" style="background: #ccc;">← GW ${gw - 1}</span>'}
            <a href="./index.html" class="nav-btn">All Gameweeks</a>
            ${gw < 38 ? `<a href="./gameweek-${gw + 1}.html" class="nav-btn">GW ${gw + 1} →</a>` : '<span class="nav-btn" style="background: #ccc;">GW ${gw + 1} →</span>'}
          </div>
          
          <div class="status ${isComplete ? 'complete' : 'in-progress'}">
            ${isComplete ? '✓ Gameweek Complete' : '⏳ Gameweek In Progress'}
          </div>
          
          ${formattedFixtures.map(match => `
            <div class="fixture">
              <div class="status-indicator">
                ${match.status === 'completed' ? '✓' : 
                  match.status === 'ongoing' ? '🔴' : 
                  match.status === 'postponed' ? '⚠️' : '⏰'}
              </div>
              <div class="teams">
                ${match.homeTeam} vs ${match.awayTeam}
              </div>
              <div class="score ${match.status === 'ongoing' ? 'live' : ''}">
                ${match.score}
              </div>
              <div class="date-time">
                ${match.date}
              </div>
            </div>
          `).join('')}
          
          <div class="last-updated">
            Last updated: ${new Date().toLocaleString('en-GB')}
          </div>
        </div>
      </body>
      </html>
    `;
    
    const htmlOutputPath = path.resolve(`./public/gameweek-${gw}.html`);
    await fs.writeFile(htmlOutputPath, htmlContent);
  }
  
  console.log(`Generated HTML files for ${gameweeks.length} gameweeks`);
}

main();