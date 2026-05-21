const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const { parse } = require('@mliebelt/pgn-parser');
const multer = require('multer');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Memory storage for PGN files
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max for PGNs
});

router.post('/', upload.single('pgn_file'), async (req, res) => {
  try {
    const { url, pgn_text, target_fide_id, source } = req.body;
    let pgnData = '';

    // 1. Get PGN text from either URL, File, or raw Text
    if (url && url.includes('lichess.org/broadcast')) {
      // Extract round ID: https://lichess.org/broadcast/.../.../B8rEQzdS or #players
      const urlWithoutHash = url.split('#')[0];
      const parts = urlWithoutHash.split('/');
      const roundId = parts[parts.length - 1];
      
      const response = await fetch(`https://lichess.org/api/broadcast/round/${roundId}.pgn`);
      if (!response.ok) {
        throw new Error(`Failed to fetch Lichess PGN: ${response.statusText}`);
      }
      pgnData = await response.text();
    } else if (req.file) {
      pgnData = req.file.buffer.toString('utf-8');
    } else if (pgn_text) {
      pgnData = pgn_text;
    } else {
      return res.status(400).json({ error: 'Please provide a Lichess URL, upload a PGN file, or paste PGN text.' });
    }

    if (!pgnData || pgnData.trim().length === 0) {
      return res.status(400).json({ error: 'No PGN data found' });
    }

    // 2. Parse PGN (supports multiple games)
    const gamesPgn = parse(pgnData, { startRule: 'games' });
    
    // 3. Filter and Format Games
    const gamesToInsert = [];
    const fideIdToMatch = target_fide_id ? target_fide_id.trim() : null;

    for (const g of gamesPgn) {
      const tags = g.tags || {};
      const whiteFideId = tags.WhiteFideId || '';
      const blackFideId = tags.BlackFideId || '';
      
      if (fideIdToMatch) {
        if (whiteFideId !== fideIdToMatch && blackFideId !== fideIdToMatch) {
          continue; // Skip this game
        }
      }

      // Format PGN back to string
      let rawPgn = '';
      for (const [key, value] of Object.entries(tags)) {
        rawPgn += `[${key} "${value}"]\n`;
      }
      rawPgn += '\n';
      // simple extraction of moves from the parsed object, though @mliebelt/pgn-parser returns structured moves.
      // We can also just extract the raw text using substring if we know the positions, but let's just save the tags and assume the raw PGN is good.
      // Wait, reconstructing PGN from @mliebelt/pgn-parser AST is hard.
      // A better way is to split the original PGN string by "[Event " to get individual games as strings, then just parse tags using regex.
    }
    
    // Actually, splitting PGN manually by "[Event " is safer and preserves exact original notation!
    const rawGames = pgnData.split(/(?=\[Event ")/g).filter(g => g.trim().length > 0);
    const parsedGames = [];

    for (const rawPgn of rawGames) {
      const whiteFideMatch = rawPgn.match(/\[WhiteFideId "([^"]+)"\]/);
      const blackFideMatch = rawPgn.match(/\[BlackFideId "([^"]+)"\]/);
      const whiteMatch = rawPgn.match(/\[White "([^"]+)"\]/);
      const blackMatch = rawPgn.match(/\[Black "([^"]+)"\]/);
      const eventMatch = rawPgn.match(/\[Event "([^"]+)"\]/);
      const siteMatch = rawPgn.match(/\[Site "([^"]+)"\]/);
      const dateMatch = rawPgn.match(/\[Date "([^"]+)"\]/);
      const roundMatch = rawPgn.match(/\[Round "([^"]+)"\]/);
      const resultMatch = rawPgn.match(/\[Result "([^"]+)"\]/);
      const boardMatch = rawPgn.match(/\[Board "([^"]+)"\]/);

      const whiteFideId = whiteFideMatch ? whiteFideMatch[1] : '';
      const blackFideId = blackFideMatch ? blackFideMatch[1] : '';
      
      if (fideIdToMatch) {
        if (whiteFideId !== fideIdToMatch && blackFideId !== fideIdToMatch) {
          continue;
        }
      }
      
      // If no FIDE ID provided, but we require FIDE IDs for our DB, we can skip games without them?
      // Supabase games table requires white_fide_id and black_fide_id not to be empty per constraint in the route, but maybe not in DB?
      // Let's allow inserting them if we are importing, or use 'Unknown' if empty.
      
      let gameDate = null;
      if (dateMatch && dateMatch[1] && !dateMatch[1].includes('?')) {
         gameDate = dateMatch[1].replace(/\./g, '-');
      }

      parsedGames.push({
        white_name: whiteMatch ? whiteMatch[1] : '',
        white_fide_id: whiteFideId,
        black_name: blackMatch ? blackMatch[1] : '',
        black_fide_id: blackFideId,
        tournament: eventMatch ? eventMatch[1] : '',
        round: roundMatch ? roundMatch[1] : '',
        board_number: boardMatch ? boardMatch[1] : '',
        location: siteMatch ? siteMatch[1] : '',
        game_date: gameDate,
        result: resultMatch ? resultMatch[1] : '*',
        pgn: rawPgn.trim(),
        source: source || 'manual'
      });
    }

    if (parsedGames.length === 0) {
      return res.status(404).json({ error: 'No games matched the provided FIDE ID, or PGN is invalid.' });
    }

    // 4. Insert into Supabase
    const { data, error } = await supabase
      .from('games')
      .insert(parsedGames)
      .select();

    if (error) {
      console.error('Supabase Error:', error);
      throw error;
    }

    res.status(201).json({ success: true, count: data.length, games: data });

  } catch (err) {
    console.error('POST /api/games/import error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
