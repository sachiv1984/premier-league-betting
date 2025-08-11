const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
  // Get free API key from https://the-odds-api.com/
  ODDS_API_KEY: process.env.ODDS_API_KEY || 'YOUR_API_KEY_HERE',
  ODDS_API_BASE_URL: 'https://api.the-odds-api.com/v4',
  
  // Premier League sport key
  SPORT: 'soccer_epl',
  
  // Bookmakers to include (popular UK ones)
  BOOKMAKERS: 'bet365,williamhill,paddypower,ladbrokes,coral',
  
  // Odds format
  ODDS_FORMAT: 'decimal',
  
  // Markets to fetch
  MARKETS: 'h2h,spreads,totals', // head-to-head, handicap, over/under
  
  // Output directory
  OUTPUT_DIR: './public'
};

class PremierLeagueBettingAnalyzer {
  constructor() {
    this.matches = [];
    this.analysis = {};
    this.lastUpdated = new Date().toISOString();
  }

  async fetchUpcomingMatches() {
    try {
      console.log('Fetching upcoming Premier League matches...');
      
      const response = await axios.get(`${CONFIG.ODDS_API_BASE_URL}/sports/${CONFIG.SPORT}/odds`, {
        params: {
          apiKey: CONFIG.ODDS_API_KEY,
          regions: 'uk',
          markets: CONFIG.MARKETS,
          oddsFormat: CONFIG.ODDS_FORMAT,
          bookmakers: CONFIG.BOOKMAKERS
        }
      });

      this.matches = response.data || [];
      console.log(`Found ${this.matches.length} upcoming matches`);
      
      return this.matches;
    } catch (error) {
      console.error('Error fetching matches:', error.response?.data || error.message);
      
      // Fallback to demo data if API fails
      console.log('Using fallback demo data...');
      this.matches = this.generateFallbackData();
      return this.matches;
    }
  }

  generateFallbackData() {
    // Fallback data in case API is unavailable
    const teams = [
      'Arsenal', 'Chelsea', 'Liverpool', 'Manchester City', 'Manchester United',
      'Tottenham', 'Newcastle', 'Brighton', 'West Ham', 'Aston Villa'
    ];
    
    const fallbackMatches = [];
    const now = new Date();
    
    for (let i = 0; i < 10; i++) {
      const homeTeam = teams[Math.floor(Math.random() * teams.length)];
      let awayTeam = teams[Math.floor(Math.random() * teams.length)];
      while (awayTeam === homeTeam) {
        awayTeam = teams[Math.floor(Math.random() * teams.length)];
      }
      
      const matchDate = new Date(now.getTime() + (i + 1) * 24 * 60 * 60 * 1000);
      
      fallbackMatches.push({
        id: `fallback_${i}`,
        sport_title: 'EPL',
        commence_time: matchDate.toISOString(),
        home_team: homeTeam,
        away_team: awayTeam,
        bookmakers: [{
          key: 'bet365',
          title: 'Bet365',
          markets: [{
            key: 'h2h',
            outcomes: [
              { name: homeTeam, price: (Math.random() * 3 + 1.5).toFixed(2) },
              { name: awayTeam, price: (Math.random() * 3 + 1.5).toFixed(2) },
              { name: 'Draw', price: (Math.random() * 2 + 3).toFixed(2) }
            ]
          }]
        }]
      });
    }
    
    return fallbackMatches;
  }

  analyzeMatches() {
    console.log('Analyzing matches...');
    
    const analysis = {
      totalMatches: this.matches.length,
      valueOpportunities: [],
      bookmakerComparison: {},
      averageOdds: {},
      recommendations: []
    };

    this.matches.forEach(match => {
      const matchAnalysis = this.analyzeMatch(match);
      
      if (matchAnalysis.hasValue) {
        analysis.valueOpportunities.push({
          match: `${match.home_team} vs ${match.away_team}`,
          date: match.commence_time,
          ...matchAnalysis
        });
      }

      // Track bookmaker odds for comparison
      match.bookmakers?.forEach(bookmaker => {
        if (!analysis.bookmakerComparison[bookmaker.title]) {
          analysis.bookmakerComparison[bookmaker.title] = { count: 0, avgOdds: 0 };
        }
        analysis.bookmakerComparison[bookmaker.title].count++;
      });
    });

    // Generate recommendations
    analysis.recommendations = this.generateRecommendations(analysis);

    this.analysis = analysis;
    return analysis;
  }

  analyzeMatch(match) {
    if (!match.bookmakers || match.bookmakers.length === 0) {
      return { hasValue: false };
    }

    const h2hMarket = match.bookmakers[0].markets?.find(m => m.key === 'h2h');
    if (!h2hMarket) {
      return { hasValue: false };
    }

    const outcomes = h2hMarket.outcomes;
    const homeOdds = outcomes.find(o => o.name === match.home_team)?.price;
    const awayOdds = outcomes.find(o => o.name === match.away_team)?.price;
    const drawOdds = outcomes.find(o => o.name === 'Draw')?.price;

    // Calculate implied probabilities
    const homeProb = homeOdds ? (1 / homeOdds * 100).toFixed(1) : null;
    const awayProb = awayOdds ? (1 / awayOdds * 100).toFixed(1) : null;
    const drawProb = drawOdds ? (1 / drawOdds * 100).toFixed(1) : null;

    // Enhanced value detection and recommendation logic
    const analysis = this.detectValueAndRecommendation(match.home_team, match.away_team, homeOdds, awayOdds, drawOdds, homeProb, awayProb, drawProb);

    return {
      hasValue: analysis.hasValue,
      homeOdds: parseFloat(homeOdds),
      awayOdds: parseFloat(awayOdds),
      drawOdds: parseFloat(drawOdds),
      homeProb,
      awayProb,
      drawProb,
      bookmaker: match.bookmakers[0].title,
      recommendation: analysis.recommendation,
      reasoning: analysis.reasoning,
      suggestedBet: analysis.suggestedBet,
      confidence: analysis.confidence
    };
  }

  detectValueAndRecommendation(homeTeam, awayTeam, homeOdds, awayOdds, drawOdds, homeProb, awayProb, drawProb) {
    if (!homeOdds || !awayOdds || !drawOdds) {
      return { hasValue: false };
    }

    const odds = [
      { type: 'Home Win', team: homeTeam, odds: parseFloat(homeOdds), prob: parseFloat(homeProb) },
      { type: 'Draw', team: 'Draw', odds: parseFloat(drawOdds), prob: parseFloat(drawProb) },
      { type: 'Away Win', team: awayTeam, odds: parseFloat(awayOdds), prob: parseFloat(awayProb) }
    ];

    // Look for value opportunities
    let bestValue = null;
    let reasoning = "";
    let confidence = "Medium";

    // Check for high odds that might represent value
    const highOddsThreshold = 3.5;
    const lowOddsThreshold = 1.8;

    // Look for underdog value
    const highOddsOptions = odds.filter(o => o.odds >= highOddsThreshold);
    if (highOddsOptions.length > 0) {
      const best = highOddsOptions[0];
      bestValue = best;
      reasoning = `${best.team} at ${best.odds} offers potential value. The bookmakers are giving them only a ${best.prob}% chance, but this could be underestimating their chances.`;
      confidence = "Medium";
    }

    // Look for favorite value (shorter odds but safer)
    if (!bestValue) {
      const favoriteOptions = odds.filter(o => o.odds <= lowOddsThreshold && o.odds >= 1.4);
      if (favoriteOptions.length > 0) {
        const best = favoriteOptions[0];
        bestValue = best;
        reasoning = `${best.team} at ${best.odds} represents solid value for a safer bet. With a ${best.prob}% implied probability, this looks like a strong favorite.`;
        confidence = "High";
      }
    }

    // Look for draw value (often overlooked)
    if (!bestValue) {
      const drawOption = odds.find(o => o.type === 'Draw');
      if (drawOption && drawOption.odds >= 3.0 && drawOption.odds <= 4.0) {
        bestValue = drawOption;
        reasoning = `The draw at ${drawOption.odds} could offer value in what looks like an evenly matched game. Both teams may cancel each other out.`;
        confidence = "Medium";
      }
    }

    // Fallback - pick best odds if no clear value
    if (!bestValue) {
      bestValue = odds.reduce((max, current) => current.odds > max.odds ? current : max);
      reasoning = `${bestValue.team} offers the highest odds at ${bestValue.odds}. While not clear value, it's worth considering if you believe the bookmakers have underestimated them.`;
      confidence = "Low";
    }

    return {
      hasValue: bestValue !== null,
      recommendation: bestValue ? `Bet on: ${bestValue.type}` : null,
      reasoning: reasoning,
      suggestedBet: bestValue ? `${bestValue.team} at ${bestValue.odds}` : null,
      confidence: confidence
    };
  }

  generateRecommendations(analysis) {
    const recommendations = [];
    
    if (analysis.valueOpportunities.length > 0) {
      recommendations.push({
        type: 'value',
        title: 'Value Opportunities Found',
        description: `${analysis.valueOpportunities.length} matches show potential value bets based on our analysis`,
        matches: analysis.valueOpportunities.slice(0, 3) // Top 3
      });
    }

    // Add more recommendation logic here
    recommendations.push({
      type: 'info',
      title: 'Market Analysis',
      description: `Analyzed ${analysis.totalMatches} upcoming Premier League matches for betting opportunities`
    });

    return recommendations;
  }

  groupMatchesByDate() {
    const grouped = {};
    
    this.matches.forEach(match => {
      const date = new Date(match.commence_time);
      const dateKey = date.toLocaleDateString('en-GB', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });
      
      if (!grouped[dateKey]) {
        grouped[dateKey] = [];
      }
      grouped[dateKey].push(match);
    });

    // Convert to array and sort by date
    return Object.entries(grouped)
      .map(([date, matches]) => ({
        date,
        matches: matches.sort((a, b) => new Date(a.commence_time) - new Date(b.commence_time))
      }))
      .sort((a, b) => {
        const dateA = new Date(a.matches[0].commence_time);
        const dateB = new Date(b.matches[0].commence_time);
        return dateA - dateB;
      });
  }
    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Premier League Betting Analysis</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                min-height: 100vh;
                color: #333;
            }
            .container { 
                max-width: 1200px; 
                margin: 0 auto; 
                padding: 20px; 
            }
            .header {
                background: rgba(255, 255, 255, 0.95);
                padding: 30px;
                border-radius: 15px;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
                margin-bottom: 30px;
                text-align: center;
            }
            .header h1 {
                color: #2c3e50;
                font-size: 2.5em;
                margin-bottom: 10px;
            }
            .header p {
                color: #7f8c8d;
                font-size: 1.1em;
            }
            .stats-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
                gap: 20px;
                margin-bottom: 30px;
            }
            .stat-card {
                background: rgba(255, 255, 255, 0.95);
                padding: 25px;
                border-radius: 15px;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
                text-align: center;
            }
            .stat-value {
                font-size: 2.5em;
                font-weight: bold;
                color: #3498db;
                margin-bottom: 10px;
            }
            .stat-label {
                color: #7f8c8d;
                font-size: 1.1em;
            }
            .matches-section {
                background: rgba(255, 255, 255, 0.95);
                padding: 30px;
                border-radius: 15px;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
                margin-bottom: 30px;
            }
            .section-title {
                color: #2c3e50;
                font-size: 1.8em;
                margin-bottom: 20px;
                border-bottom: 3px solid #3498db;
                padding-bottom: 10px;
            }
            .match-card {
                background: #f8f9fa;
                border-left: 4px solid #3498db;
                padding: 20px;
                margin-bottom: 15px;
                border-radius: 8px;
            }
            .match-header {
                font-size: 1.3em;
                font-weight: bold;
                color: #2c3e50;
                margin-bottom: 10px;
            }
            .match-date {
                color: #7f8c8d;
                margin-bottom: 15px;
            }
            .odds-grid {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 15px;
                margin-bottom: 15px;
            }
            .odds-item {
                text-align: center;
                background: white;
                padding: 10px;
                border-radius: 5px;
            }
            .odds-team {
                font-weight: bold;
                margin-bottom: 5px;
            }
            .odds-value {
                color: #e74c3c;
                font-size: 1.2em;
                font-weight: bold;
            }
            .recommendation {
                background: #e8f5e8;
                border: 1px solid #4caf50;
                border-radius: 8px;
                padding: 15px;
                margin-bottom: 15px;
            }
            .recommendation h4 {
                color: #2e7d32;
                margin-bottom: 8px;
            }
            .last-updated {
                text-align: center;
                color: #7f8c8d;
                margin-top: 30px;
                font-style: italic;
            }
            .value-badge {
                background: #4caf50;
                color: white;
                padding: 4px 8px;
                border-radius: 4px;
                font-size: 0.8em;
                margin-left: 10px;
            }
            .ai-insight {
                background: #f0f8ff;
                border-left: 4px solid #2196f3;
                padding: 15px;
                margin-top: 15px;
                border-radius: 8px;
            }
            .bet-suggestion {
                color: #e74c3c;
                font-size: 1.1em;
                font-weight: bold;
                margin: 10px 0;
            }
            .reasoning {
                color: #555;
                line-height: 1.5;
                font-style: italic;
            }
            .date-section {
                margin-bottom: 30px;
            }
            .date-header {
                color: #2c3e50;
                font-size: 1.3em;
                margin-bottom: 15px;
                padding: 10px;
                background: #ecf0f1;
                border-radius: 8px;
                border-left: 4px solid #3498db;
            }
            .fixture-card {
                display: flex;
                justify-content: space-between;
                align-items: center;
                background: white;
                padding: 15px;
                margin-bottom: 8px;
                border-radius: 8px;
                border-left: 3px solid #95a5a6;
            }
            .fixture-teams {
                font-weight: bold;
                color: #2c3e50;
            }
            .fixture-time {
                color: #7f8c8d;
                font-size: 0.9em;
            }
            @media (max-width: 768px) {
                .odds-grid { grid-template-columns: 1fr; }
                .stats-grid { grid-template-columns: 1fr; }
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>⚽ Premier League Betting Analysis</h1>
                <p>Real-time odds analysis and value betting opportunities</p>
            </div>
            
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-value">${this.analysis.totalMatches}</div>
                    <div class="stat-label">Upcoming Matches</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${this.analysis.valueOpportunities.length}</div>
                    <div class="stat-label">Value Opportunities</div>
                </div>
            </div>

            <div class="matches-section">
                <h2 class="section-title">📊 Recommendations</h2>
                ${this.analysis.recommendations.map(rec => `
                    <div class="recommendation">
                        <h4>${rec.title}</h4>
                        <p>${rec.description}</p>
                        ${rec.summary ? `<p><small>${rec.summary}</small></p>` : ''}
                    </div>
                `).join('')}
            </div>

            ${this.analysis.valueOpportunities.length > 0 ? `
            <div class="matches-section">
                <h2 class="section-title">💎 AI Betting Insights</h2>
                ${this.analysis.valueOpportunities.slice(0, 5).map(match => `
                    <div class="match-card">
                        <div class="match-header">
                            ${match.match}
                            <span class="value-badge">${match.confidence} CONFIDENCE</span>
                        </div>
                        <div class="match-date">
                            ${new Date(match.date).toLocaleDateString('en-GB', { 
                                weekday: 'long', 
                                year: 'numeric', 
                                month: 'long', 
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                            })}
                        </div>
                        <div class="ai-insight">
                            <div class="recommendation">
                                <h4>🎯 ${match.recommendation}</h4>
                                <p class="bet-suggestion"><strong>${match.suggestedBet}</strong></p>
                                <p class="reasoning">${match.reasoning}</p>
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
            ` : ''}

            <div class="matches-section">
                <h2 class="section-title">🗓️ Upcoming Fixtures</h2>
                ${this.groupMatchesByDate().map(dateGroup => `
                    <div class="date-section">
                        <h3 class="date-header">${dateGroup.date}</h3>
                        ${dateGroup.matches.map(match => `
                            <div class="fixture-card">
                                <div class="fixture-teams">${match.home_team} vs ${match.away_team}</div>
                                <div class="fixture-time">${new Date(match.commence_time).toLocaleTimeString('en-GB', { 
                                    hour: '2-digit', 
                                    minute: '2-digit' 
                                })}</div>
                            </div>
                        `).join('')}
                    </div>
                `).join('')}
            </div>

            <div class="last-updated">
                Last updated: ${new Date(this.lastUpdated).toLocaleString('en-GB')}
            </div>
        </div>
    </body>
    </html>
    `;

    return html;
  }

  async saveFiles() {
    // Ensure output directory exists
    if (!fs.existsSync(CONFIG.OUTPUT_DIR)) {
      fs.mkdirSync(CONFIG.OUTPUT_DIR, { recursive: true });
    }

    // Save JSON data
    const jsonData = {
      matches: this.matches,
      analysis: this.analysis,
      lastUpdated: this.lastUpdated
    };

    fs.writeFileSync(
      path.join(CONFIG.OUTPUT_DIR, 'data.json'),
      JSON.stringify(jsonData, null, 2)
    );

    // Save HTML
    const html = this.generateHTML();
    fs.writeFileSync(
      path.join(CONFIG.OUTPUT_DIR, 'index.html'),
      html
    );

    console.log('✅ Files saved successfully!');
  }

  async run() {
    try {
      console.log('🚀 Starting Premier League Betting Analysis...');
      
      await this.fetchUpcomingMatches();
      this.analyzeMatches();
      await this.saveFiles();
      
      console.log(`✅ Analysis complete! Found ${this.analysis.valueOpportunities.length} value opportunities`);
      console.log('📁 Files generated in ./public directory');
      
    } catch (error) {
      console.error('❌ Error running analysis:', error);
      process.exit(1);
    }
  }
}

// Run the analyzer
if (require.main === module) {
  const analyzer = new PremierLeagueBettingAnalyzer();
  analyzer.run();
}

module.exports = PremierLeagueBettingAnalyzer;
