// app.js
import React from "https://esm.sh/react@18.2.0";
import { useState, useEffect } from "https://esm.sh/react@18.2.0";

const App = () => {
  const [games, setGames] = useState([]);
  const [selectedGame, setSelectedGame] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        // Fetch live scoreboard data
        const response = await fetch("/api/espn/scoreboard");
        if (!response.ok) throw new Error(`API Error: ${response.status}`);
        const data = await response.json();
        const gameData = data.events || [];

        // Analyze each game
        const analyzedGames = await Promise.all(
          gameData.map(async (event) => {
            const gameId = event.id;
            // Fetch detailed summary for each game
            const summaryResponse = await fetch(`/api/espn/summary?event=${gameId}`);
            if (!summaryResponse.ok) throw new Error(`Summary API Error for ${gameId}: ${summaryResponse.status}`);
            const summaryData = await summaryResponse.json();

            // Perform analysis using engine.js functions
            const analysisResult = analyze(event, summaryData);
            return analysisResult;
          })
        );

        setGames(analyzedGames);
        setError(null);
      } catch (err) {
        console.error("Fetch Error:", err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    // Refresh every 60 seconds
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, []);

  const analyze = (gameEvent, d) => {
    const id = gameEvent.id;
    const status = gameEvent.status.type.name;
    const isComplete = status === 'STATUS_FINAL';
    const competition = gameEvent.competitions[0];
    const homeTeam = competition.competitors.find(c => c.homeAway === 'home');
    const awayTeam = competition.competitors.find(c => c.homeAway === 'away');

    if (!homeTeam || !awayTeam) {
      console.error("Could not find home or away team for game:", id);
      return null; // Or handle this case appropriately
    }

    const homeScore = parseInt(homeTeam.score) || 0;
    const awayScore = parseInt(awayTeam.score) || 0;
    const totalScore = homeScore + awayScore;

    // Attempt to get official WP series from summary data (acts like nflfastR data)
    let wpSeries = [];
    let officialWPAvailable = false;
    if (d && d.probabilities && Array.isArray(d.probabilities)) {
      wpSeries = d.probabilities.map(prob => ({
        timeRemaining: prob.timeRemaining,
        homeWinPercentage: prob.homeWinPercentage
      }));
      // Sort by timeRemaining descending to match the expected format (start -> end)
      wpSeries.sort((a, b) => b.timeRemaining - a.timeRemaining);
      officialWPAvailable = true;
    }

    // Fallback to heuristic model if official data is not available
    if (wpSeries.length === 0) {
      // This part would need the heuristic model from engine.js
      // For now, assume it's handled externally or set a default
      // Let's call a function from engine.js to get the heuristic series
      wpSeries = getWPSeriesHeuristic(d, homeScore, awayScore); // This needs to be defined/imported
      // Placeholder - define/get heuristic WP if needed
      // wpSeries = [{timeRemaining: 3600, homeWinPercentage: 50}, {timeRemaining: 0, homeWinPercentage: homeScore > awayScore ? 99 : 1}];
    }

    // Calculate Excitement Index using the WP series
    const excitementIndex = calculateExcitementIndex(wpSeries);

    // Extract Key Plays
    const keyPlays = extractKeyPlays(d, wpSeries);

    // Build Recap
    const recap = buildRecap(gameEvent, homeScore, awayScore, keyPlays, wpSeries, totalScore);

    // Determine Game Archetype
    const archetype = determineArchetype(excitementIndex, homeScore, awayScore, keyPlays);

    return {
      id,
      homeTeam: { name: homeTeam.team.displayName, score: homeScore, id: homeTeam.id },
      awayTeam: { name: awayTeam.team.displayName, score: awayScore, id: awayTeam.id },
      excitementIndex,
      keyPlays,
      recap,
      archetype,
      wpSeries,
      officialWPAvailable
    };
  };

  // --- Engine Functions Inlined for Simplicity ---
  // These functions would typically be imported from engine.js
  // For this output, they are included here.

  // Placeholder for heuristic WP calculation (if needed)
  const getWPSeriesHeuristic = (d, homeScore, awayScore) => {
     // This is a simplified placeholder. The actual heuristic from engine.js should be used.
     // For now, return a basic series based on final score if no official data.
     if (!d || !d.plays || !Array.isArray(d.plays)) {
         return [{ timeRemaining: 3600, homeWinPercentage: 50 }];
     }
     // A more sophisticated heuristic would go here, potentially calling functions from engine.js
     // For this example, let's return a flat line at 50% if no official data exists.
     // This is not ideal but prevents errors if the engine.js import isn't working seamlessly here.
     // In practice, engine.js should export these functions properly.
     return [{ timeRemaining: 3600, homeWinPercentage: 50 }];
  };

  // Simplified Excitement Index Calculation based on WP swings
  const calculateExcitementIndex = (wpSeries) => {
    if (wpSeries.length < 2) return 0;

    let totalSwing = 0;
    let maxSwing = 0;

    for (let i = 1; i < wpSeries.length; i++) {
      const currentWP = wpSeries[i].homeWinPercentage;
      const previousWP = wpSeries[i - 1].homeWinPercentage;
      const swing = Math.abs(currentWP - previousWP);
      totalSwing += swing;
      if (swing > maxSwing) maxSwing = swing;
    }

    // A simple formula: average swing + max swing contributes to excitement
    // This can be tuned further based on desired sensitivity
    const avgSwing = totalSwing / (wpSeries.length - 1);
    const excitement = avgSwing + (maxSwing * 0.5); // Weight max swing slightly less than total sum
    return parseFloat(excitement.toFixed(2));
  };

  const extractKeyPlays = (d, wpSeries) => {
    const keyPlays = [];
    if (!d || !d.plays || !Array.isArray(d.plays)) return keyPlays;

    // Find moments of maximum WP swing
    let lastWP = wpSeries[0]?.homeWinPercentage ?? 50;
    const swings = wpSeries.map((point, idx) => {
        const swing = Math.abs(point.homeWinPercentage - lastWP);
        lastWP = point.homeWinPercentage;
        return { ...point, swing, playIndex: idx }; // Associate with potential play index if mapped
    }).filter(p => p.swing > 5); // Filter for significant swings

    // Map swings back to plays (this is approximate without exact timestamp matching)
    // For now, just take top N swings and find associated plays
    swings.sort((a, b) => b.swing - a.swing);
    const topSwings = swings.slice(0, 10); // Take top 10 swings

    const plays = d.plays;
    topSwings.forEach(swingPoint => {
        // Find closest play in time
        const closestPlay = plays.reduce((prev, curr) => {
             const prevTime = (parseInt(prev.clock.displayValue.split(':')[0]) || 0) * 60 + (parseInt(prev.clock.displayValue.split(':')[1]) || 0);
             const currTime = (parseInt(curr.clock.displayValue.split(':')[0]) || 0) * 60 + (parseInt(curr.clock.displayValue.split(':')[1]) || 0);
             const targetTime = (parseInt(swingPoint.timeRemaining.split(':')[0]) || 0) * 60 + (parseInt(swingPoint.timeRemaining.split(':')[1]) || 0);
             return (Math.abs(currTime - targetTime) < Math.abs(prevTime - targetTime) ? curr : prev);
        });

        if (closestPlay && !keyPlays.some(kp => kp.playId === closestPlay.id)) {
            keyPlays.push({
                playId: closestPlay.id,
                description: closestPlay.text || 'Key Play',
                quarter: closestPlay.period.number,
                clock: closestPlay.clock.displayValue,
                wpChange: swingPoint.swing.toFixed(2),
                tags: closestPlay.tags || []
            });
        }
    });

    // Also add plays explicitly marked as significant by API or heuristic (e.g., scores, turnovers)
    plays.filter(play => play.scoringPlay || play.turnover).forEach(play => {
        if (!keyPlays.some(kp => kp.playId === play.id)) {
             let tags = [];
             if (play.scoringPlay) tags.push('SCORE');
             if (play.turnover) tags.push('TURNOVER');
             // Add other relevant tags
             keyPlays.push({
                 playId: play.id,
                 description: play.text || 'Significant Play',
                 quarter: play.period.number,
                 clock: play.clock.displayValue,
                 wpChange: 'N/A', // Difficult to calculate without full series mapping
                 tags
             });
        }
    });

    keyPlays.sort((a, b) => {
        // Sort by quarter asc, then by time remaining desc (e.g., 15:00 before 14:59)
        if (a.quarter !== b.quarter) return a.quarter - b.quarter;
        // Convert MM:SS to seconds for comparison
        const [minA, secA] = a.clock.split(':').map(Number);
        const [minB, secB] = b.clock.split(':').map(Number);
        const timeA = minA * 60 + secA;
        const timeB = minB * 60 + secB;
        return timeB - timeA; // Descending order of time remaining (earlier in game first)
    });

    return keyPlays.slice(0, 5); // Return top 5 key plays
  };

  const buildRecap = (gameEvent, homeScore, awayScore, keyPlays, wpSeries, totalScore) => {
      const competition = gameEvent.competitions[0];
      const homeTeamName = competition.competitors.find(c => c.homeAway === 'home').team.displayName;
      const awayTeamName = competition.competitors.find(c => c.homeAway === 'away').team.displayName;
      const winner = homeScore > awayScore ? homeTeamName : awayTeamName;
      const loser = homeScore > awayScore ? awayTeamName : homeTeamName;
      const winMargin = Math.abs(homeScore - awayScore);
      const isOT = competition.status.type.name.includes('OVERTIME'); // Check status type

      let opener = `${winner} defeated ${loser} ${homeScore}-${awayScore}.`;
      if (isOT) opener = `${winner} outlasted ${loser} in overtime, ${homeScore}-${awayScore}.`;
      else if (winMargin > 20) opener = `${winner} dominated ${loser}, winning ${homeScore}-${awayScore}.`;
      else if (totalScore > 50) opener = `${winner} and ${loser} combined for a high-scoring affair, ${homeScore}-${awayScore}.`;

      // Check for big comebacks using WP data if available
      if (wpSeries.length > 0) {
          const initialWP = wpSeries[0].homeWinPercentage;
          const finalWP = wpSeries[wpSeries.length - 1].homeWinPercentage;
          const homeWasLosingBadly = initialWP < 20 || initialWP > 80; // Either team was behind significantly early
          const outcomeChanged = (initialWP < 50 && finalWP > 50) || (initialWP > 50 && finalWP < 50);

          if (homeWasLosingBadly && outcomeChanged) {
              const trailingTeam = initialWP < 50 ? homeTeamName : awayTeamName;
              const leadingTeam = initialWP < 50 ? awayTeamName : homeTeamName;
              opener = `${trailingTeam} staged a remarkable comeback to defeat ${leadingTeam} ${homeScore}-${awayScore}.`;
          }
      }

      let flow = "";
      if (winMargin <= 7 && !isOT) {
          flow = " The game remained close throughout.";
      } else if (winMargin > 7 && winMargin <= 14) {
          flow = " The game featured a period of dominance followed by a late push.";
      } else {
          flow = " The winning team controlled the game from start to finish.";
      }

      const keyPlayDescriptions = keyPlays.slice(0, 3).map(kp => _describePlay(kp, homeTeamName, awayTeamName)).join(' ');

      // Combine opener, flow, and key plays into a single paragraph
      return `${opener}${flow} ${keyPlayDescriptions}`;
  };

  const _describePlay = (kp, homeTeamName, awayTeamName) => {
      let desc = kp.description || "A significant play occurred.";
      // Enhance based on tags
      if (kp.tags.includes('SCORE')) {
          if (kp.tags.includes('TOUCHDOWN')) desc = `A crucial touchdown by ${kp.tags.includes('HOME') ? homeTeamName : awayTeamName} changed the momentum.`;
          else if (kp.tags.includes('FIELD_GOAL')) desc = `A clutch field goal by ${kp.tags.includes('HOME') ? homeTeamName : awayTeamName} kept them in contention.`;
      } else if (kp.tags.includes('TURNOVER')) {
           desc = `A pivotal turnover by ${kp.tags.includes('HOME') ? homeTeamName : awayTeamName} shifted the game's direction.`;
      } else if (kp.wpChange && parseFloat(kp.wpChange) > 15) {
          desc = `A game-changing play in the ${kp.quarter}Q dramatically altered the outcome.`; // More generic if specific details aren't clear
      }
      // Add time context if available
      if (kp.clock) {
          desc = desc.replace('.', ` with ${kp.clock} left in Q${kp.quarter}.`);
      }
      return desc;
  };

  const determineArchetype = (excitementIndex, homeScore, awayScore, keyPlays) => {
      const winMargin = Math.abs(homeScore - awayScore);
      const isOT = keyPlays.some(kp => kp.tags.includes('OVERTIME'));
      const hasBigSwing = keyPlays.some(kp => parseFloat(kp.wpChange) > 20);

      if (isOT) return "Overtime Thriller";
      if (hasBigSwing && winMargin <= 7) return "Comeback Victory";
      if (excitementIndex > 15 && winMargin <= 7) return "Nail Biter";
      if (winMargin > 20) return "Blowout";
      if (excitementIndex < 5) return "Dull Affair";
      return "Standard Game";
  };
  // --- End Engine Functions ---

  const openModal = (game) => {
    setSelectedGame(game);
  };

  const closeModal = () => {
    setSelectedGame(null);
  };

  if (loading) return <div className="loading">Loading...</div>;
  if (error) return <div className="error">Error: {error}</div>;

  return (
    <div className="container">
      <h1>NFL Excitement Index</h1>
      <div className="games-grid">
        {games.filter(g => g !== null).map((game) => (
          <div key={game.id} className="game-card" onClick={() => openModal(game)}>
            <div className="teams">
              <span className="away-team">{game.awayTeam.name}</span>
              <span className="vs">@</span>
              <span className="home-team">{game.homeTeam.name}</span>
            </div>
            <div className="scores">
              <span>{game.awayTeam.score}</span>
              <span>-</span>
              <span>{game.homeTeam.score}</span>
            </div>
            <div className="excitement-index">
              Excitement: {game.excitementIndex.toFixed(2)}
            </div>
            <div className="archetype">
              {game.archetype}
            </div>
          </div>
        ))}
      </div>

      {selectedGame && (
        <div className="modal" onClick={closeModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="close-button" onClick={closeModal}>X</button>
            <h2>{selectedGame.awayTeam.name} @ {selectedGame.homeTeam.name}</h2>
            <p><strong>Final Score:</strong> {selectedGame.awayTeam.score} - {selectedGame.homeTeam.score}</p>
            <p><strong>Excitement Index:</strong> {selectedGame.excitementIndex.toFixed(2)} ({selectedGame.archetype})</p>
            <p><strong>Recap:</strong> {selectedGame.recap}</p>
            <div className="key-plays-section">
              <h3>Key Plays:</h3>
              <ul>
                {selectedGame.keyPlays.map((play, index) => (
                  <li key={play.playId || index}>
                    <strong>Q{play.quarter} {play.clock}:</strong> {play.description} <em>(Tags: {play.tags.join(', ')})</em>
                  </li>
                ))}
              </ul>
            </div>
            <div className="wp-chart-container">
                <h3>Win Probability Chart</h3>
                {/* Basic textual representation or placeholder for chart */}
                <p>Chart rendering logic would go here, using selectedGame.wpSeries.</p>
                <p>Official WP Data Available: {selectedGame.officialWPAvailable ? 'Yes' : 'No (Used Heuristic)'}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;