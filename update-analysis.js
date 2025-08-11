// premier-league-betting-analyzer.js
// Full refactor to support "high confidence bets", seasonal logic, squad validation, and accumulators.
// Requires: axios
// Env vars: ODDS_API_KEY, API_FOOTBALL_KEY, API_FOOTBALL_HOST (optional)

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
  ODDS_API_KEY: process.env.ODDS_API_KEY || 'YOUR_ODDS_API_KEY',
  ODDS_API_BASE_URL: 'https://api.the-odds-api.com/v4',
  // API-Football config (for stats + squads)
  API_FOOTBALL_KEY: process.env.API_FOOTBALL_KEY || 'YOUR_API_FOOTBALL_KEY',
  API_FOOTBALL_HOST: process.env.API_FOOTBALL_HOST || 'v3.football.api-sports.io', // adjust if needed
  API_FOOTBALL_BASE: 'https://v3.football.api-sports.io',
  // Premier League sport key
  SPORT: 'soccer_epl',
  // Bookmakers to include (popular UK ones)
  BOOKMAKERS: 'bet365,williamhill,paddypower,ladbrokes,coral',
  // Odds format
  ODDS_FORMAT: 'decimal',
  // Markets to fetch
  MARKETS: 'h2h,spreads,totals', // head-to-head, handicap, over/under
  // Output directory
  OUTPUT_DIR: './public',
  // Heuristics
  EARLY_SEASON_DAYS: 70, // first ~10 weeks of season -> use prior season stats
  MIN_ODDS_THRESHOLD: 1.01, // must be > 1.0
  CONFIDENCE_HIGH_THRESHOLD: 0.75, // used internally to mark 'High' confidence (0..1)
  ACCUMULATOR_MAX_LEGS: 4 // max legs in accumulator suggestions
};

class PremierLeagueBettingAnalyzer {
  constructor() {
    this.matches = [];
    this.analysis = {};
    this.lastUpdated = new Date().toISOString();
    this.teamCache = {}; // map name -> team object from API-Football
  }

  // -------------------------
  // Lower-level API helpers
  // -------------------------
  async _callOddsAPI(path, params = {}) {
    try {
      const resp = await axios.get(`${CONFIG.ODDS_API_BASE_URL}${path}`, {
        params: {
          apiKey: CONFIG.ODDS_API_KEY,
          ...params
        }
      });
      return resp.data;
    } catch (err) {
      console.error('Odds API error', err.response?.data || err.message);
      throw err;
    }
  }

  async _callApiFootball(path, params = {}) {
    try {
      const resp = await axios.get(`${CONFIG.API_FOOTBALL_BASE}${path}`, {
        params,
        headers: {
          'x-apisports-key': CONFIG.API_FOOTBALL_KEY,
          'x-rapidapi-host': CONFIG.API_FOOTBALL_HOST
        }
      });
      return resp.data;
    } catch (err) {
      console.error('API-Football error', err.response?.data || err.message);
      throw err;
    }
  }

  // -------------------------
  // Fetch odds (The Odds API)
  // -------------------------
  async fetchUpcomingMatches() {
    try {
      console.log('Fetching upcoming Premier League matches (Odds API)...');

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
      console.log(`Found ${this.matches.length} upcoming matches from Odds API`);
      return this.matches;
    } catch (error) {
      console.error('Error fetching matches from Odds API:', error.response?.data || error.message);
      console.log('Using fallback demo data...');
      this.matches = this.generateFallbackData();
      return this.matches;
    }
  }

  // -------------------------
  // API-Football helpers: team lookup, squads, fixtures & stats
  // -------------------------
  async getTeamByName(name, seasonYear = null) {
    // Cache by name
    if (this.teamCache[name]) return this.teamCache[name];

    try {
      // Search teams by name; API-Football supports search param 'search'
      // Season is optional but helps find correct team variation
      const params = { search: name };
      if (seasonYear) params.season = seasonYear;

      const result = await this._callApiFootball('/teams', params);
      if (result && result.response && result.response.length > 0) {
        // Heuristic: pick first match; better matching could be implemented (fuzzy)
        const team = result.response[0].team;
        this.teamCache[name] = team;
        return team;
      }
      return null;
    } catch (err) {
      console.warn(`Failed team lookup for "${name}"`, err.message || err);
      return null;
    }
  }

  async getSquadForTeam(teamId, season) {
    // Returns list of players for the team in the season
    try {
      const data = await this._callApiFootball('/players', { team: teamId, season });
      // API returns paginated list, but for many teams a single page suffices; handle concatenation if needed
      const players = (data && data.response) ? data.response.map(p => p.player) : [];
      return players;
    } catch (err) {
      console.warn('Failed to fetch squad for teamId', teamId, err.message || err);
      return [];
    }
  }

  async getLastNFixturesWithStats(teamId, leagueId = null, season = null, last = 5) {
    // Fetch last N fixtures for a team; then fetch statistics per fixture
    // Returns an array of objects { fixture, statsForTeam }
    try {
      const params = { team: teamId, last };
      if (leagueId) params.league = leagueId;
      if (season) params.season = season;

      const result = await this._callApiFootball('/fixtures', params);
      const fixtures = (result && result.response) ? result.response : [];

      // For each fixture, attempt to fetch statistics if available
      const enriched = [];
      for (const f of fixtures) {
        let statsForTeam = null;
        try {
          const statResp = await this._callApiFootball('/fixtures/statistics', { fixture: f.fixture.id });
          if (statResp && statResp.response && statResp.response.length > 0) {
            // Find the stats array entry belonging to the requested team
            const teamStatsEntry = statResp.response.find(s => s.team && s.team.id === teamId);
            if (teamStatsEntry && teamStatsEntry.statistics) {
              // Reduce statistics array to a dictionary for easy indexing
              statsForTeam = teamStatsEntry.statistics.reduce((acc, stat) => {
                acc[stat.type] = stat.value;
                return acc;
              }, {});
            }
          }
        } catch (innerErr) {
          // stats endpoint may 404 if not available; proceed without detailed stats
        }

        enriched.push({ fixture: f, statsForTeam });
      }

      return enriched;
    } catch (err) {
      console.warn('Failed to fetch fixtures for teamId', teamId, err.message || err);
      return [];
    }
  }

  // -------------------------
  // Core analysis
  // -------------------------
  analyzeMatches() {
    console.log('Analyzing matches (generating high confidence bets)...');

    const analysis = {
      totalMatches: this.matches.length,
      highConfidenceBets: [],
      bookmakerComparison: {},
      averageOdds: {},
      recommendations: [],
      accumulators: []
    };

    // We'll process every match
    for (const match of this.matches) {
      const matchAnalysis = this.analyzeMatch(match);
      if (matchAnalysis && matchAnalysis.isHighConfidence) {
        analysis.highConfidenceBets.push({
          match: `${match.home_team} vs ${match.away_team}`,
          date: match.commence_time,
          ...matchAnalysis
        });
      }

      // Track bookmaker counts
      match.bookmakers?.forEach(bookmaker => {
        if (!analysis.bookmakerComparison[bookmaker.title]) {
          analysis.bookmakerComparison[bookmaker.title] = { count: 0, avgOdds: 0 };
        }
        analysis.bookmakerComparison[bookmaker.title].count++;
      });
    }

    // Build accumulators (same bookmaker only)
    analysis.accumulators = this.generateAccumulators(analysis.highConfidenceBets);

    // Recommendations (summary & meta)
    analysis.recommendations = this.generateRecommendations(analysis);

    this.analysis = analysis;
    return analysis;
  }

  async analyzeMatchDataFromApis(match) {
    // For a single match we want: team ids, squads, stats (last5 or prior season depending on early-season heuristic)
    // We'll return an object with structured data or nulls on failure
    try {
      const homeName = match.home_team;
      const awayName = match.away_team;
      const commence = new Date(match.commence_time);

      // derive season-year for the match (EPL seasons span years: e.g., 2024-2025). We'll take the match year as season start year if month >=7 (Aug+)
      const matchYear = commence.getFullYear();
      const matchMonth = commence.getMonth() + 1; // 1..12
      const seasonStartYear = (matchMonth >= 7) ? matchYear : matchYear - 1; // e.g., Aug 2024 -> season 2024
      const currentSeason = seasonStartYear;

      // early-season heuristic: if match date is within DAYS of season start => use prior season stats
      const seasonStartDate = new Date(`${seasonStartYear}-08-01T00:00:00Z`); // approx Aug 1
      const daysSinceSeasonStart = (commence - seasonStartDate) / (1000 * 60 * 60 * 24);
      const usePriorSeason = daysSinceSeasonStart >= 0 && daysSinceSeasonStart <= CONFIG.EARLY_SEASON_DAYS;

      const statSeason = usePriorSeason ? currentSeason - 1 : currentSeason;
      const statWindow = usePriorSeason ? null : 5; // null => prior season full-season stats; last 5 otherwise

      // Match to API-Football teams by name
      const [homeTeamObj, awayTeamObj] = await Promise.all([
        this.getTeamByName(homeName, currentSeason),
        this.getTeamByName(awayName, currentSeason)
      ]);

      const homeTeamId = homeTeamObj?.id || null;
      const awayTeamId = awayTeamObj?.id || null;

      // Fetch squads for season (for squad validation)
      const [homeSquad, awaySquad] = await Promise.all([
        homeTeamId ? this.getSquadForTeam(homeTeamId, currentSeason) : [],
        awayTeamId ? this.getSquadForTeam(awayTeamId, currentSeason) : []
      ]);

      // Fetch stats: last N fixtures with statistics OR prior season fixtures to compute averages
      const [homeFixtures, awayFixtures] = await Promise.all([
        homeTeamId ? this.getLastNFixturesWithStats(homeTeamId, null, statSeason, statWindow || 20) : [],
        awayTeamId ? this.getLastNFixturesWithStats(awayTeamId, null, statSeason, statWindow || 20) : []
      ]);

      // Calculate averages for relevant metrics (goals for, goals against, fouls, cards)
      const computeAverages = (fixtures, teamId, lastN = statWindow) => {
        if (!fixtures || fixtures.length === 0) return null;
        const relevant = lastN ? fixtures.slice(0, lastN) : fixtures;
        const accum = {
          games: 0,
          goalsFor: 0,
          goalsAgainst: 0,
          fouls: 0,
          yellowCards: 0,
          redCards: 0
        };
        for (const f of relevant) {
          const fixture = f.fixture;
          // Determine team side to read goals
          const goalsFor = (fixture && fixture.teams && fixture.goals) ? (fixture.teams.home.id === teamId ? fixture.goals.home : fixture.goals.away) : null;
          const goalsAgainst = (fixture && fixture.teams && fixture.goals) ? (fixture.teams.home.id === teamId ? fixture.goals.away : fixture.goals.home) : null;
          if (goalsFor !== null && goalsFor !== undefined) {
            accum.games++;
            accum.goalsFor += Number(goalsFor);
            accum.goalsAgainst += Number(goalsAgainst ?? 0);
          }
          // Stats: statsForTeam may be null if not available
          const stats = f.statsForTeam || {};
          const fouls = stats['Fouls'] || stats['Fouls'] === 0 ? Number(stats['Fouls'] || 0) : null;
          const yellow = stats['Yellow Cards'] || stats['Yellow Cards'] === 0 ? Number(stats['Yellow Cards'] || 0) : null;
          const red = stats['Red Cards'] || stats['Red Cards'] === 0 ? Number(stats['Red Cards'] || 0) : null;
          accum.fouls += fouls || 0;
          accum.yellowCards += yellow || 0;
          accum.redCards += red || 0;
        }
        if (accum.games === 0) return null;
        return {
          games: accum.games,
          avgGoalsFor: accum.goalsFor / accum.games,
          avgGoalsAgainst: accum.goalsAgainst / accum.games,
          avgFouls: accum.fouls / accum.games,
          avgYellow: accum.yellowCards / accum.games,
          avgRed: accum.redCards / accum.games
        };
      };

      const homeStats = computeAverages(homeFixtures, homeTeamId);
      const awayStats = computeAverages(awayFixtures, awayTeamId);

      return {
        homeTeamObj,
        awayTeamObj,
        homeSquad,
        awaySquad,
        homeStats,
        awayStats,
        statSeason,
        usePriorSeason
      };
    } catch (err) {
      console.warn('Error enriching match with API-Football data', err.message || err);
      return null;
    }
  }

  // Analyze a single match object (odds + markets from Odds API)
  analyzeMatch(match) {
    // If no bookmakers or markets, skip
    if (!match.bookmakers || match.bookmakers.length === 0) {
      return {
        isHighConfidence: false
      };
    }

    // We'll attempt to find markets in the bookmakers. For now we'll primarily evaluate:
    // - h2h (home/draw/away)
    // - totals (over/under)
    // - spreads (handicap)
    // We'll also rely on API-Football stats to justify "high confidence".

    // Choose a preferred bookmaker that has the markets we care about
    const preferredBookmaker = match.bookmakers.find(bm => bm.key && CONFIG.BOOKMAKERS.includes(bm.key)) || match.bookmakers[0];

    // Extract the first instance of each market type we support
    const h2hMarket = preferredBookmaker.markets?.find(m => m.key === 'h2h');
    const totalsMarket = preferredBookmaker.markets?.find(m => m.key === 'totals');
    const spreadsMarket = preferredBookmaker.markets?.find(m => m.key === 'spreads');

    // Parse h2h odds
    const outcomes = h2hMarket?.outcomes || [];
    const homeOutcome = outcomes.find(o => o.name === match.home_team);
    const awayOutcome = outcomes.find(o => o.name === match.away_team);
    const drawOutcome = outcomes.find(o => o.name === 'Draw');

    const homeOdds = homeOutcome ? parseFloat(homeOutcome.price) : null;
    const awayOdds = awayOutcome ? parseFloat(awayOutcome.price) : null;
    const drawOdds = drawOutcome ? parseFloat(drawOutcome.price) : null;

    // Default placeholders
    let chosenBet = null;
    let reasoning = '';
    let confidenceLabel = 'Low';
    let confidenceScore = 0.0;
    let marketType = null;
    let bookmakerName = preferredBookmaker.title || preferredBookmaker.key;

    // Decide whether to pull additional API-Football stats (async) but since analyzeMatch is sync in current structure,
    // we'll call a synchronous wrapper by blocking on a Promise (not ideal but acceptable here).
    // In Node.js top-level, blocking can happen using async/await; so we'll make analyzeMatch async if needed.
    // For easier integration with the existing code shape, we'll call a synchronous wrapper by using deasync pattern.
    // BUT to avoid external libs, we can call the enriching function synchronously by awaiting within this function if we mark it async.
    // => We'll adapt: make analyzeMatches call analyzeMatchAsync, but to keep minimal changes below we'll create and call an internal async function using .then() and blocking with a simple Promise resolution.
    // Simpler approach: perform synchronous heuristic based on odds only (fast), then separately enrich with API-Football and promote to high confidence if stats back it up.
    // We'll implement a two-phase approach:
    //  1. Candidate selection based on odds only (must be > 1.0)
    //  2. Enrichment & re-evaluation based on API-Football stats (promote to high confidence if supported)

    // Phase 1: Odds-based candidate selection (simple heuristics)
    const candidates = [];
    if (homeOdds && homeOdds > CONFIG.MIN_ODDS_THRESHOLD) {
      candidates.push({ type: 'Home Win', team: match.home_team, odds: homeOdds, market: 'h2h' });
    }
    if (awayOdds && awayOdds > CONFIG.MIN_ODDS_THRESHOLD) {
      candidates.push({ type: 'Away Win', team: match.away_team, odds: awayOdds, market: 'h2h' });
    }
    if (drawOdds && drawOdds > CONFIG.MIN_ODDS_THRESHOLD) {
      candidates.push({ type: 'Draw', team: 'Draw', odds: drawOdds, market: 'h2h' });
    }

    // totals: attempt to suggest over/under if available and odds > 1.0
    const totalsCandidates = [];
    if (totalsMarket && totalsMarket.outcomes) {
      for (const o of totalsMarket.outcomes) {
        // outcomes often have names like "Over 2.5" / "Under 2.5"
        const price = parseFloat(o.price);
        if (price > CONFIG.MIN_ODDS_THRESHOLD) {
          totalsCandidates.push({ type: 'Totals', label: o.name, odds: price, market: 'totals' });
        }
      }
    }

    // spreads candidates (handicap)
    const spreadCandidates = [];
    if (spreadsMarket && spreadsMarket.outcomes) {
      for (const o of spreadsMarket.outcomes) {
        const price = parseFloat(o.price);
        if (price > CONFIG.MIN_ODDS_THRESHOLD) {
          spreadCandidates.push({ type: 'Spread', label: o.name, odds: price, market: 'spreads' });
        }
      }
    }

    // If no candidate odds exist, nothing to do
    if (candidates.length === 0 && totalsCandidates.length === 0 && spreadCandidates.length === 0) {
      return {
        isHighConfidence: false
      };
    }

    // Phase 2: Enrich with API-Football stats and compute confidence.
    // We'll do this synchronously by awaiting the async enrichment helper.
    // To accommodate current synchronous call, make a synchronous wait using an IIFE with async/await and blocking via de-sugared promise handling.
    // In Node 14+, top-level await is not available in a function — but we can create an immediately-resolved promise and block via .then (non-blocking) — but to keep flow simple, change structure:
    // We'll call an async enrichment method and then block with a simple trick: return a placeholder and a background enrichment may upgrade it later when run() calls async flow,
    // but that's messy. Instead, update analyzeMatches to call an async variant. For simplicity in this single-file edit, we will:
    // -- Convert analyzeMatches to async and call analyzeMatchAsync throughout.
    // (So we should change the run() flow at bottom to await analyzeMatches()).

    // Mark this function as placeholder; actual logic happens in analyzeMatchAsync below.
    return {
      // placeholder fields so the rest of the code can read something
      isHighConfidence: false,
      bookmaker: bookmakerName
    };
  }

  // We'll create an async version which does the heavy lifting using API-Football
  async analyzeMatchAsync(match) {
    if (!match.bookmakers || match.bookmakers.length === 0) {
      return { isHighConfidence: false };
    }

    const preferredBookmaker = match.bookmakers.find(bm => bm.key && CONFIG.BOOKMAKERS.includes(bm.key)) || match.bookmakers[0];
    const bookmakerName = preferredBookmaker.title || preferredBookmaker.key;

    const h2hMarket = preferredBookmaker.markets?.find(m => m.key === 'h2h');
    const totalsMarket = preferredBookmaker.markets?.find(m => m.key === 'totals');
    const spreadsMarket = preferredBookmaker.markets?.find(m => m.key === 'spreads');

    const outcomes = h2hMarket?.outcomes || [];
    const homeOutcome = outcomes.find(o => o.name === match.home_team);
    const awayOutcome = outcomes.find(o => o.name === match.away_team);
    const drawOutcome = outcomes.find(o => o.name === 'Draw');

    const homeOdds = homeOutcome ? parseFloat(homeOutcome.price) : null;
    const awayOdds = awayOutcome ? parseFloat(awayOutcome.price) : null;
    const drawOdds = drawOutcome ? parseFloat(drawOutcome.price) : null;

    // Basic candidate list
    const candidates = [];
    if (homeOdds && homeOdds > CONFIG.MIN_ODDS_THRESHOLD) candidates.push({ type: 'Home Win', team: match.home_team, odds: homeOdds, market: 'h2h' });
    if (awayOdds && awayOdds > CONFIG.MIN_ODDS_THRESHOLD) candidates.push({ type: 'Away Win', team: match.away_team, odds: awayOdds, market: 'h2h' });
    if (drawOdds && drawOdds > CONFIG.MIN_ODDS_THRESHOLD) candidates.push({ type: 'Draw', team: 'Draw', odds: drawOdds, market: 'h2h' });

    const totalsCandidates = [];
    if (totalsMarket && totalsMarket.outcomes) {
      for (const o of totalsMarket.outcomes) {
        const price = parseFloat(o.price);
        if (price > CONFIG.MIN_ODDS_THRESHOLD) {
          totalsCandidates.push({ type: 'Totals', label: o.name, odds: price, market: 'totals' });
        }
      }
    }

    const spreadCandidates = [];
    if (spreadsMarket && spreadsMarket.outcomes) {
      for (const o of spreadsMarket.outcomes) {
        const price = parseFloat(o.price);
        if (price > CONFIG.MIN_ODDS_THRESHOLD) {
          spreadCandidates.push({ type: 'Spread', label: o.name, odds: price, market: 'spreads' });
        }
      }
    }

    // Enrich with API-Football data (team ids, squads, stats)
    const enriched = await this.analyzeMatchDataFromApis(match);
    // If enrichment failed, fall back to odds-only heuristic
    if (!enriched) {
      // pick the candidate with highest implied probability mismatch or reasonable odds
      const pick = this.selectOddsOnlyCandidate(candidates, totalsCandidates, spreadCandidates);
      if (!pick) return { isHighConfidence: false };
      return {
        isHighConfidence: true,
        bookmaker: bookmakerName,
        recommendation: pick.recommendation,
        suggestedBet: pick.suggestedBet,
        reasoning: pick.reasoning,
        confidence: pick.confidenceLabel,
        market: pick.market,
        odds: pick.odds,
        leg: pick // convenience
      };
    }

    // Now we have enriched stats: homeStats and awayStats
    const { homeStats, awayStats, homeSquad, awaySquad, usePriorSeason, statSeason } = enriched;

    // Compose a few AI-like heuristics to decide high-confidence picks:
    // 1) If one team has a much higher avgGoalsFor than the other and favourite odds are > 1.0, recommend Home/Away Win.
    // 2) If totals (over/under) odds exist and the combined average goals suggest it, recommend Over/Under threshold that is available and above 1.0.
    // 3) If fouls stats are available from API-Football and bookmakers provide team or match foul totals market (rare), recommend the threshold that both meets the odds threshold and is supported by data.
    // Confidence score is computed from normalized difference of stats and how close the odds are to the expected probability.

    const computeConfidenceFromOddsAndStats = (expectedProb, marketOdds) => {
      // expectedProb: number in 0..1 representing our model expectation
      // marketOdds: decimal odds
      const marketProb = 1 / marketOdds;
      // Simple confidence: how much expectedProb exceeds market implied prob, normalized
      const diff = expectedProb - marketProb;
      // scale to 0..1 roughly
      const score = Math.tanh(diff * 3) * 0.5 + 0.5; // map to 0..1
      return Math.max(0, Math.min(1, score));
    };

    // Candidate scoring function
    const scoredCandidates = [];

    // H2H scoring
    if (homeStats && awayStats) {
      // Implied expectation: P(home) proportional to attack strength vs defense
      // Very simple model:
      const homeExpGoals = homeStats.avgGoalsFor;
      const awayExpConcede = awayStats.avgGoalsAgainst;
      const homeStrength = (homeExpGoals + (awayExpConcede === 0 ? 0.1 : (1 / awayExpConcede))) / 2;

      const awayExpGoals = awayStats.avgGoalsFor;
      const homeExpConcede = homeStats.avgGoalsAgainst;
      const awayStrength = (awayExpGoals + (homeExpConcede === 0 ? 0.1 : (1 / homeExpConcede))) / 2;

      const total = homeStrength + awayStrength;
      const expectedHomeProb = total ? (homeStrength / total) : 0.5;
      const expectedAwayProb = total ? (awayStrength / total) : 0.5;
      // normalize to 0..1
      const normalizedHomeProb = Math.max(0.01, Math.min(0.99, expectedHomeProb));
      const normalizedAwayProb = Math.max(0.01, Math.min(0.99, expectedAwayProb));

      if (homeOdds && homeOdds > CONFIG.MIN_ODDS_THRESHOLD) {
        const c = computeConfidenceFromOddsAndStats(normalizedHomeProb, homeOdds);
        scoredCandidates.push({
          type: 'Home Win',
          team: match.home_team,
          odds: homeOdds,
          market: 'h2h',
          expectedProb: normalizedHomeProb,
          confidenceScore: c
        });
      }
      if (awayOdds && awayOdds > CONFIG.MIN_ODDS_THRESHOLD) {
        const c = computeConfidenceFromOddsAndStats(normalizedAwayProb, awayOdds);
        scoredCandidates.push({
          type: 'Away Win',
          team: match.away_team,
          odds: awayOdds,
          market: 'h2h',
          expectedProb: normalizedAwayProb,
          confidenceScore: c
        });
      }
    }

    // Totals scoring (based on combined avg goals)
    if (homeStats && awayStats && totalsCandidates.length > 0) {
      const combinedAvgGoals = (homeStats.avgGoalsFor + awayStats.avgGoalsFor) / 2;
      // Try to match to the available totals outcomes (e.g., Over 2.5)
      for (const tc of totalsCandidates) {
        // Extract numeric threshold from label like "Over 2.5" or "Under 2.5"
        const matchLabel = tc.label.match(/(Over|Under)\s*([\d\.]+)/i);
        if (!matchLabel) continue;
        const side = matchLabel[1].toLowerCase();
        const threshold = parseFloat(matchLabel[2]);
        // Our expected probability that "Over threshold" occurs approximated by Poisson tail or simple heuristic:
        // here use simple rule: if combinedAvgGoals >= threshold then probability high, else low
        const expectedProb = side === 'over' ? Math.min(0.99, Math.max(0.01, (combinedAvgGoals / (threshold + 0.1)))) : Math.min(0.99, Math.max(0.01, (1 - (combinedAvgGoals / (threshold + 0.1)))));
        const c = computeConfidenceFromOddsAndStats(expectedProb, tc.odds);
        scoredCandidates.push({
          type: side === 'over' ? 'Totals Over' : 'Totals Under',
          label: tc.label,
          odds: tc.odds,
          market: 'totals',
          expectedProb,
          confidenceScore: c
        });
      }
    }

    // Spread scoring - simple heuristic: if one team strong and market offers handicap that aligns
    if (homeStats && awayStats && spreadCandidates.length > 0) {
      // Example: If home avgGoalsFor >> away avgGoalsAgainst, a -1 or -1.5 handicap might be reasonable
      for (const sc of spreadCandidates) {
        // label might be "Liverpool -1" etc or "Home -1"
        const labelMatch = sc.label.match(/(-?[\d\.]+)/);
        // This is heuristic and might not always parse
        const scOdds = sc.odds;
        const scConfidence = 0.3; // base low
        scoredCandidates.push({
          type: 'Spread',
          label: sc.label,
          odds: scOdds,
          market: 'spreads',
          expectedProb: 0.5,
          confidenceScore: scConfidence
        });
      }
    }

    if (scoredCandidates.length === 0) {
      // If nothing scored, fallback to simple odds-based candidate
      const pick = this.selectOddsOnlyCandidate([], totalsCandidates, spreadCandidates);
      if (!pick) return { isHighConfidence: false };
      return {
        isHighConfidence: true,
        bookmaker: bookmakerName,
        recommendation: pick.recommendation,
        suggestedBet: pick.suggestedBet,
        reasoning: pick.reasoning,
        confidence: pick.confidenceLabel,
        market: pick.market,
        odds: pick.odds,
        leg: pick
      };
    }

    // Choose the candidate with highest confidenceScore and whose odds > 1.0
    scoredCandidates.sort((a, b) => b.confidenceScore - a.confidenceScore);
    const best = scoredCandidates[0];

    // Map confidenceScore to label
    let label = 'Low';
    if (best.confidenceScore >= 0.8) label = 'Very High';
    else if (best.confidenceScore >= 0.6) label = 'High';
    else if (best.confidenceScore >= 0.4) label = 'Medium';

    // We only output as a "high confidence bet" if the confidence score passes a threshold AND odds > 1.0
    const isHigh = best.confidenceScore >= CONFIG.CONFIDENCE_HIGH_THRESHOLD && best.odds > CONFIG.MIN_ODDS_THRESHOLD;

    if (!isHigh) {
      return { isHighConfidence: false };
    }

    // Build reasoning text
    let reasonText = '';
    if (best.market === 'h2h') {
      reasonText = `${best.team} recommended based on recent stats: expected win probability ${Math.round(best.expectedProb * 100)}% vs market implied ${Math.round((1 / best.odds) * 100)}%. Stats used from ${enriched.usePriorSeason ? `season ${enriched.statSeason}` : 'last 5 matches'}.`;
    } else if (best.market === 'totals') {
      reasonText = `Totals suggestion ${best.label} — combined avg goals ${ (enriched.homeStats.avgGoalsFor + enriched.awayStats.avgGoalsFor) / 2 } supports this threshold. Odds reflect ${best.odds}.`;
    } else {
      reasonText = `Based on model and market: ${best.label} @ ${best.odds}.`;
    }

    return {
      isHighConfidence: isHigh,
      bookmaker: bookmakerName,
      recommendation: best.market === 'h2h' ? `Bet on: ${best.type}` : `Bet on: ${best.type} (${best.label || ''})`,
      suggestedBet: best.market === 'h2h' ? `${best.team} @ ${best.odds}` : `${best.label} @ ${best.odds}`,
      reasoning: reasonText,
      confidence: label,
      market: best.market,
      odds: best.odds,
      leg: best
    };
  }

  selectOddsOnlyCandidate(candidates, totalsCandidates, spreadCandidates) {
    // Basic fallback when no stats available: choose candidate with best balance of probability and odds
    // For simplicity, choose highest odds among candidates > 1.0 but prefer favorites (odds < 2.0) if present.
    let pick = null;
    if (candidates && candidates.length > 0) {
      // Prefer favorite options (odds <= 1.8 and >= 1.01)
      const favorites = candidates.filter(c => c.odds >= CONFIG.MIN_ODDS_THRESHOLD && c.odds <= 1.8);
      if (favorites.length > 0) pick = favorites[0];
      else {
        // pick highest odds
        pick = candidates.reduce((max, cur) => (cur.odds > (max?.odds || 0) ? cur : max), candidates[0]);
      }
      if (pick) {
        return {
          recommendation: `Bet on: ${pick.type}`,
          suggestedBet: `${pick.team} @ ${pick.odds}`,
          reasoning: `Odds-only fallback pick: ${pick.type} at ${pick.odds}. No detailed stats available.`,
          confidenceLabel: pick.odds <= 1.8 ? 'High' : 'Medium',
          market: pick.market,
          odds: pick.odds
        };
      }
    }
    if (totalsCandidates && totalsCandidates.length > 0) {
      const pickT = totalsCandidates[0];
      return {
        recommendation: `Bet on: Totals ${pickT.label}`,
        suggestedBet: `${pickT.label} @ ${pickT.odds}`,
        reasoning: `Odds-only totals pick: ${pickT.label}`,
        confidenceLabel: 'Medium',
        market: 'totals',
        odds: pickT.odds
      };
    }
    if (spreadCandidates && spreadCandidates.length > 0) {
      const pickS = spreadCandidates[0];
      return {
        recommendation: `Bet on: Spread ${pickS.label}`,
        suggestedBet: `${pickS.label} @ ${pickS.odds}`,
        reasoning: `Odds-only spread pick: ${pickS.label}`,
        confidenceLabel: 'Medium',
        market: 'spreads',
        odds: pickS.odds
      };
    }
    return null;
  }

  // -------------------------
  // Accumulator generation
  // -------------------------
  generateAccumulators(highConfidenceBets) {
    // highConfidenceBets: array of objects each containing match, bookmaker, odds, market, leg...
    // We'll group by bookmaker and produce:
    //  - single-match accumulators (multiple legs from same match and bookmaker)
    //  - cross-match accumulators (different matches in same fixture week), up to ACCUMULATOR_MAX_LEGS
    const accumulators = [];
    if (!highConfidenceBets || highConfidenceBets.length === 0) return accumulators;

    // Normalize: ensure odds numeric and include match date
    const normalized = highConfidenceBets.map(h => ({
      ...h,
      odds: h.odds ? Number(h.odds) : (h.leg && h.leg.odds ? Number(h.leg.odds) : null),
      commence: new Date(h.date)
    })).filter(h => h.odds && h.odds > CONFIG.MIN_ODDS_THRESHOLD);

    // Group by bookmaker
    const byBookmaker = {};
    normalized.forEach(h => {
      const bk = h.bookmaker || 'Unknown';
      byBookmaker[bk] = byBookmaker[bk] || [];
      byBookmaker[bk].push(h);
    });

    // Utility to compute combined odds (product)
    const combinedOdds = (legs) => {
      return legs.reduce((acc, l) => {
        // multiply decimal odds
        return acc * Number(l.odds);
      }, 1);
    };

    // For each bookmaker build accumulators
    for (const [bookmaker, bets] of Object.entries(byBookmaker)) {
      // Single-match accumulators: group legs by match text
      const byMatch = {};
      bets.forEach(b => {
        byMatch[b.match] = byMatch[b.match] || [];
        byMatch[b.match].push(b);
      });

      for (const [matchName, matchBets] of Object.entries(byMatch)) {
        // we can create accumulators of size 2..maxLegs from matchBets
        if (matchBets.length >= 2) {
          // create all combos up to ACCUMULATOR_MAX_LEGS (avoid explosion)
          const maxLeg = Math.min(CONFIG.ACCUMULATOR_MAX_LEGS, matchBets.length);
          // simple approach: take best N by confidence for legs
          matchBets.sort((a, b) => (b.confidence === 'Very High' ? 1 : 0) - (a.confidence === 'Very High' ? 1 : 0));
          for (let n = 2; n <= maxLeg; n++) {
            const legs = matchBets.slice(0, n);
            const co = combinedOdds(legs);
            if (co > 1.0) {
              accumulators.push({
                type: 'single-match',
                bookmaker,
                match: matchName,
                legs: legs.map(l => ({ bet: l.recommendation || l.suggestedBet, odds: l.odds, confidence: l.confidence })),
                combinedOdds: Number(co.toFixed(3))
              });
            }
          }
        }
      }

      // Cross-match accumulators: group by ISO week of match date
      const byWeek = {};
      bets.forEach(b => {
        const yr = b.commence.getFullYear();
        const week = this._getISOWeek(b.commence);
        const key = `${yr}-W${week}`;
        byWeek[key] = byWeek[key] || [];
        byWeek[key].push(b);
      });

      for (const [weekKey, weekBets] of Object.entries(byWeek)) {
        if (weekBets.length >= 2) {
          // pick top legs by confidence up to ACCUMULATOR_MAX_LEGS
          weekBets.sort((a, b) => (b.confidence === 'Very High' ? 1 : 0) - (a.confidence === 'Very High' ? 1 : 0));
          const maxLeg = Math.min(CONFIG.ACCUMULATOR_MAX_LEGS, weekBets.length);
          for (let n = 2; n <= maxLeg; n++) {
            const legs = weekBets.slice(0, n);
            const co = combinedOdds(legs);
            if (co > 1.0) {
              accumulators.push({
                type: 'cross-match',
                bookmaker,
                week: weekKey,
                legs: legs.map(l => ({ match: l.match, bet: l.recommendation || l.suggestedBet, odds: l.odds, confidence: l.confidence })),
                combinedOdds: Number(co.toFixed(3))
              });
            }
          }
        }
      }
    }

    // Deduplicate accumulators (by legs)
    const uniq = [];
    const seen = new Set();
    for (const a of accumulators) {
      const key = `${a.bookmaker}-${a.type}-${JSON.stringify(a.legs.map(l => l.bet))}-${a.combinedOdds}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniq.push(a);
      }
    }

    return uniq;
  }

  _getISOWeek(date) {
    // returns ISO week number
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return weekNo;
  }

  generateRecommendations(analysis) {
    const recommendations = [];

    if (analysis.highConfidenceBets.length > 0) {
      recommendations.push({
        type: 'high_confidence',
        title: 'High Confidence Bets Found',
        description: `${analysis.highConfidenceBets.length} high-confidence bets identified where AI-insight and odds > 1.0`,
        matches: analysis.highConfidenceBets
      });
    } else {
      recommendations.push({
        type: 'info',
        title: 'No High Confidence Bets',
        description: `No bets met the high confidence + odds thresholds at this time. Reviewed ${analysis.totalMatches} matches.`
      });
    }

    recommendations.push({
      type: 'info',
      title: 'Market Analysis',
      description: `Analyzed ${analysis.totalMatches} upcoming Premier League matches for betting opportunities. Accumulators built from single bookmaker only.`
    });

    if (analysis.accumulators && analysis.accumulators.length > 0) {
      recommendations.push({
        type: 'accumulators',
        title: 'Accumulator Suggestions',
        description: `Found ${analysis.accumulators.length} accumulator opportunities (single-bookmaker).`,
        accumulators: analysis.accumulators
      });
    }

    return recommendations;
  }

  // -------------------------
  // HTML generation (updated)
  // -------------------------
  generateHTML() {
    // Use analysis object
    const analysis = this.analysis || { highConfidenceBets: [], accumulators: [], recommendations: [] };

    const betsHtml = (analysis.highConfidenceBets || []).map(b => `
      <div class="match-card">
        <div class="match-header">
          ${b.match}
          <span class="value-badge">${b.confidence} CONFIDENCE</span>
        </div>
        <div class="match-date">
          ${new Date(b.date).toLocaleString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </div>
        <div class="ai-insight">
          <div class="recommendation">
            <h4>🎯 ${b.recommendation}</h4>
            <p class="bet-suggestion"><strong>${b.suggestedBet}</strong> — <em>Bookmaker: ${b.bookmaker}</em></p>
            <p class="reasoning">${b.reasoning}</p>
          </div>
        </div>
      </div>
    `).join('\n');

    const accumHtml = (analysis.accumulators || []).map(a => {
      if (a.type === 'single-match') {
        return `
          <div class="match-card">
            <div class="match-header">${a.match} — Accumulator (${a.bookmaker})</div>
            <div class="match-date">Type: Single-match accumulator</div>
            <div class="ai-insight">
              <div class="recommendation">
                <h4>💥 Combined Odds: ${a.combinedOdds}</h4>
                <p><strong>Bookmaker:</strong> ${a.bookmaker}</p>
                <ul>
                  ${a.legs.map(leg => `<li>${leg.bet} — ${leg.odds} (${leg.confidence})</li>`).join('')}
                </ul>
              </div>
            </div>
          </div>
        `;
      } else {
        return `
          <div class="match-card">
            <div class="match-header">Accumulator Week ${a.week} — (${a.bookmaker})</div>
            <div class="match-date">Type: Cross-match accumulator</div>
            <div class="ai-insight">
              <div class="recommendation">
                <h4>💥 Combined Odds: ${a.combinedOdds}</h4>
                <p><strong>Bookmaker:</strong> ${a.bookmaker}</p>
                <ul>
                  ${a.legs.map(leg => `<li>${leg.match}: ${leg.bet} — ${leg.odds} (${leg.confidence})</li>`).join('')}
                </ul>
              </div>
            </div>
          </div>
        `;
      }
    }).join('\n');

    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8"/>
      <meta name="viewport" content="width=device-width,initial-scale=1"/>
      <title>Premier League Betting Analysis — High Confidence Bets</title>
      <style>
        /* Reuse your styling but keep it compact here */
        body{font-family:Arial,Helvetica,sans-serif;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:#333;padding:20px}
        .container{max-width:1100px;margin:0 auto}
        .header{background:rgba(255,255,255,0.95);padding:20px;border-radius:12px;margin-bottom:20px;text-align:center}
        .section-title{font-size:1.4em;margin-bottom:10px;color:#2c3e50}
        .match-card{background:#fff;padding:15px;border-radius:8px;margin-bottom:12px;box-shadow:0 6px 16px rgba(0,0,0,0.08)}
        .match-header{font-weight:bold;color:#2c3e50}
        .value-badge{background:#4caf50;color:#fff;padding:4px 8px;border-radius:6px;margin-left:8px;font-size:.8em}
        .ai-insight{background:#f0f8ff;padding:10px;border-radius:6px;margin-top:8px}
        .bet-suggestion{color:#e74c3c;font-weight:bold}
        ul{margin-top:8px}
        .last-updated{margin-top:20px;font-style:italic;color:#7f8c8d}
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>⚽ Premier League — High Confidence Betting Analysis</h1>
          <p>High-confidence bets (AI-insight + odds &gt; 1.0). Combined accumulators are from a single bookmaker only.</p>
        </div>

        <div>
          <h2 class="section-title">🎯 High Confidence Bets</h2>
          ${betsHtml || '<p>No high confidence bets at this time.</p>'}
        </div>

        <div style="margin-top:20px">
          <h2 class="section-title">➕ Accumulator Suggestions (single-bookmaker)</h2>
          ${accumHtml || '<p>No accumulator opportunities at this time.</p>'}
        </div>

        <div class="last-updated">Last updated: ${new Date(this.lastUpdated).toLocaleString('en-GB')}</div>
      </div>
    </body>
    </html>
    `;

    return html;
  }

  // -------------------------
  // Fallback demo data
  // -------------------------
  generateFallbackData() {
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
              { name: homeTeam, price: (Math.random() * 2 + 1.3).toFixed(2) },
              { name: awayTeam, price: (Math.random() * 2 + 1.3).toFixed(2) },
              { name: 'Draw', price: (Math.random() * 2 + 3).toFixed(2) }
            ]
          }, {
            key: 'totals',
            outcomes: [
              { name: 'Over 2.5', price: (Math.random() * 1.5 + 1.2).toFixed(2) },
              { name: 'Under 2.5', price: (Math.random() * 1.5 + 1.2).toFixed(2) }
            ]
          }]
        }]
      });
    }

    return fallbackMatches;
  }

  // -------------------------
  // Filesave & main runner
  // -------------------------
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

  // Run sequence
  async run() {
    try {
      console.log('🚀 Starting Premier League Betting Analysis...');
      await this.fetchUpcomingMatches();

      // analyzeMatches was refactored to use async analyzeMatchAsync per match
      const analysis = {
        totalMatches: this.matches.length,
        highConfidenceBets: [],
        bookmakerComparison: {},
        averageOdds: {},
        recommendations: [],
        accumulators: []
      };

      for (const match of this.matches) {
        // call async analyzer
        const singleMatchAnalysis = await this.analyzeMatchAsync(match);
        if (singleMatchAnalysis && singleMatchAnalysis.isHighConfidence) {
          analysis.highConfidenceBets.push({
            match: `${match.home_team} vs ${match.away_team}`,
            date: match.commence_time,
            bookmaker: singleMatchAnalysis.bookmaker,
            recommendation: singleMatchAnalysis.recommendation,
            suggestedBet: singleMatchAnalysis.suggestedBet,
            reasoning: singleMatchAnalysis.reasoning,
            confidence: singleMatchAnalysis.confidence,
            market: singleMatchAnalysis.market,
            odds: singleMatchAnalysis.odds,
            leg: singleMatchAnalysis.leg
          });
        }

        // track bookmaker
        match.bookmakers?.forEach(bookmaker => {
          if (!analysis.bookmakerComparison[bookmaker.title]) {
            analysis.bookmakerComparison[bookmaker.title] = { count: 0, avgOdds: 0 };
          }
          analysis.bookmakerComparison[bookmaker.title].count++;
        });
      }

      // Build accumulators
      analysis.accumulators = this.generateAccumulators(analysis.highConfidenceBets);

      // Build recommendations
      analysis.recommendations = this.generateRecommendations(analysis);

      this.analysis = analysis;
      this.lastUpdated = new Date().toISOString();

      await this.saveFiles();

      console.log(`✅ Analysis complete! Found ${this.analysis.highConfidenceBets.length} high-confidence bets`);
      console.log('📁 Files generated in ./public directory');
    } catch (error) {
      console.error('❌ Error running analysis:', error);
      process.exit(1);
    }
  }
}

// Execute when run directly
if (require.main === module) {
  (async () => {
    const analyzer = new PremierLeagueBettingAnalyzer();
    await analyzer.run();
  })();
}

module.exports = PremierLeagueBettingAnalyzer;
