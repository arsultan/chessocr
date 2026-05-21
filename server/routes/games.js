const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// GET /api/games — list all games (paginated)
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const search = req.query.search || '';
    const fide_id = req.query.fide_id || '';
    const tournament = req.query.tournament || '';

    let query = supabase
      .from('games')
      .select('id, white_name, white_fide_id, black_name, black_fide_id, tournament, round, game_date, result, location, has_errors, source, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (fide_id) {
      query = query.or(`white_fide_id.eq.${fide_id},black_fide_id.eq.${fide_id}`);
    }
    if (tournament) {
      query = query.ilike('tournament', `%${tournament}%`);
    }
    if (search) {
      query = query.or(`white_name.ilike.%${search}%,black_name.ilike.%${search}%`);
    }

    const { data, error, count } = await query;

    if (error) throw error;

    res.json({
      games: data,
      pagination: {
        total: count,
        page,
        limit,
        pages: Math.ceil(count / limit)
      }
    });
  } catch (err) {
    console.error('GET /api/games error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/games/:id — get single game with full PGN
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('games')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return res.status(404).json({ error: 'Game not found' });
      throw error;
    }

    res.json(data);
  } catch (err) {
    console.error('GET /api/games/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/games — save a new game
router.post('/', async (req, res) => {
  try {
    const {
      white_name, white_fide_id,
      black_name, black_fide_id,
      tournament, round, board_number, location, game_date,
      result, pgn, raw_moves,
      ocr_confidence, has_errors, scan_url
    } = req.body;

    // Validate required fields
    if (!white_fide_id || !white_fide_id.trim()) {
      return res.status(400).json({ error: 'white_fide_id is required' });
    }
    if (!black_fide_id || !black_fide_id.trim()) {
      return res.status(400).json({ error: 'black_fide_id is required' });
    }
    if (!pgn || !pgn.trim()) {
      return res.status(400).json({ error: 'pgn is required' });
    }

    const gameRecord = {
      white_name: white_name || '',
      white_fide_id: white_fide_id.trim(),
      black_name: black_name || '',
      black_fide_id: black_fide_id.trim(),
      tournament: tournament || '',
      round: round || '',
      board_number: board_number || '',
      location: location || '',
      game_date: game_date || null,
      result: result || '*',
      pgn: pgn.trim(),
      raw_moves: raw_moves || null,
      ocr_confidence: ocr_confidence || null,
      has_errors: has_errors || false,
      scan_url: scan_url || null
    };

    const { data, error } = await supabase
      .from('games')
      .insert(gameRecord)
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ success: true, game: data });
  } catch (err) {
    console.error('POST /api/games error:', err);
    if (err.code === '23514') {
      return res.status(400).json({ error: 'Constraint violation: check FIDE IDs and PGN are not empty' });
    }
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/games/:id — update a game
router.patch('/:id', async (req, res) => {
  try {
    const allowed = ['white_name', 'white_fide_id', 'black_name', 'black_fide_id',
      'tournament', 'round', 'board_number', 'location', 'game_date', 'result', 'pgn', 'raw_moves', 'has_errors'];
    
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('games')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, game: data });
  } catch (err) {
    console.error('PATCH /api/games/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/games/:id
router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('games')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/games/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
