const OpenAI = require('openai');
const express = require('express');
const { Chess } = require('chess.js');
const { distance } = require('fastest-levenshtein');
const { createClient } = require('@supabase/supabase-js');
const router = express.Router();

// Initialize Supabase client
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const CHESS_OCR_PROMPT = `CONTEXT: You are an expert chess scoresheet OCR system. We are digitizing handwritten chess scoresheets (бланки шахматных партий) from real tournaments. 
Be aware that these often feature messy children's handwriting (детский почерк), slanted text, and inconsistent character shapes. The main table strictly contains chess moves.

Extract ALL information from the scoresheet and return it as valid JSON ONLY (no markdown, no explanation, no code blocks).

The scoresheet uses standard FIDE format. Key fields:
- "ак/white" or "белые" = White player name
- "қара/black" or "черные" = Black player name
- "нәтиже/result" = Result (1, 0, or ½)
- "тур/round" = Round number
- "үстел/table" or "доска" = Board/table number
- "күні/date" = Date
- The main table has columns: # (move number), White move, Black move

NOTATION CONVERSION RULES:
Convert Cyrillic piece notation to standard algebraic:
- К or Кк → N (Knight)
- Ф → Q (Queen)
- Л → R (Rook)
- С or Сл → B (Bishop)
- Кр or Кор → K (King)
- Pawn moves (no prefix) stay as-is (e4, d5, etc.)
- Captures: × or x → x (e.g., Лxe4 → Rxe4)
- Castling: 0-0 or О-О → O-O, 0-0-0 → O-O-O
- Check: + stays +, checkmate: # or ++ → #

Return this exact JSON structure:
{
  "white_name": "Player Name or empty string",
  "black_name": "Player Name or empty string",
  "white_result": "1" or "0" or "1/2" or "",
  "black_result": "1" or "0" or "1/2" or "",
  "result": "1-0" or "0-1" or "1/2-1/2" or "*",
  "tournament": "tournament name or empty string",
  "round": "round number or empty string",
  "board_number": "table/board number or empty string",
  "location": "city/location or empty string",
  "game_date": "YYYY-MM-DD or empty string",
  "moves": [
    {
      "number": 1,
      "white": "e4",
      "black": "c5",
      "white_confidence": 0.95,
      "black_confidence": 0.95
    }
  ],
  "ocr_notes": "any notes about difficult handwriting or uncertain moves"
}

IMPORTANT:
- Output exactly what you see on the paper. Do NOT guess or fix illegal moves. We have a chess engine that will fix errors later.
- Pay SPECIAL ATTENTION to distinguishing between the letters "g", "d", and "a" in square coordinates (e.g., g3 vs d3). Look closely at the tail and loops.
- For completely unreadable moves, use "?" as the move value and set confidence to 0.1.
- Include ALL moves you can see, even partial ones.
- Don't skip any move numbers - if you can't read a move, still include the entry with "?".
- Confidence is 0.0 to 1.0 (1.0 = very clear, 0.5 = uncertain, 0.1 = unreadable).
- For the date, convert formats like "22.09.25" → "2025-09-22".
- Return ONLY raw JSON, no markdown fences`;

router.post('/', async (req, res) => {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || apiKey === 'your_openai_api_key_here') {
      return res.status(503).json({
        error: 'OpenAI API key not configured. Please set OPENAI_API_KEY in .env file.'
      });
    }

    const files = req.files;
    if (!files || (!files.page1 && !files.page2)) {
      return res.status(400).json({ error: 'No image file uploaded. Use field name "page1" or "page2".' });
    }

    const openai = new OpenAI({ apiKey });

    // Build messages for GPT-4o
    const userContent = [
      { type: 'text', text: CHESS_OCR_PROMPT }
    ];

    if (files.page1) {
      const f = files.page1[0];
      userContent.push({
        type: 'image_url',
        image_url: {
          url: `data:${f.mimetype};base64,${f.buffer.toString('base64')}`,
          detail: 'high'  // high detail for handwritten text
        }
      });
      if (files.page2) {
        userContent.push({ type: 'text', text: 'Above is PAGE 1. Below is PAGE 2 (moves 31-60):' });
      }
    }

    if (files.page2) {
      const f = files.page2[0];
      userContent.push({
        type: 'image_url',
        image_url: {
          url: `data:${f.mimetype};base64,${f.buffer.toString('base64')}`,
          detail: 'high'
        }
      });
    }

    console.log(`[OCR] Processing with GPT-4o, pages: ${files.page1 ? 1 : 0}+${files.page2 ? 1 : 0}`);

    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      messages: [{ role: 'user', content: userContent }],
      max_tokens: 4096,
      temperature: 0.1,  // low temp for consistent structured output
      response_format: { type: 'json_object' }
    });

    const responseText = response.choices[0].message.content?.trim() || '';
    console.log(`[OCR] Tokens used: ${response.usage?.total_tokens || '?'}`);

    // Parse JSON
    let parsed;
    try {
      parsed = JSON.parse(responseText);
    } catch (parseErr) {
      console.error('[OCR] Failed to parse response as JSON:', responseText.substring(0, 500));
      return res.status(422).json({
        error: 'Could not parse OCR result as valid JSON',
        raw_response: responseText.substring(0, 2000)
      });
    }

    // Calculate overall confidence
    const moves = parsed.moves || [];

    // --- MOVE CORRECTION ENGINE ---
    const chess = new Chess();
    let unrecoverableError = false;
    let correctedCount = 0;

    const findClosestLegalMove = (ocrMove, legalMoves) => {
      if (!ocrMove || ocrMove === '?') return null;
      let bestMove = null;
      let minDistance = Infinity;
      
      // Basic handwriting heuristics before distance calculation
      // E.g., N and H look similar, K and R look similar
      let normalizedOcr = ocrMove.replace(/H/g, 'N').replace(/h/g, 'n');
      
      for (const moveObj of legalMoves) {
        const san = moveObj.san;
        const dist = distance(normalizedOcr, san);
        if (dist < minDistance) {
          minDistance = dist;
          bestMove = san;
        }
      }
      return bestMove;
    };

    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      
      // Process White
      if (m.white && m.white !== '?' && !unrecoverableError) {
        try {
          chess.move(m.white);
        } catch (e) {
          const legalMoves = chess.moves({ verbose: true });
          const bestMatch = findClosestLegalMove(m.white, legalMoves);
          if (bestMatch) {
            m.suggested_white = bestMatch;
            correctedCount++;
            try { chess.move(bestMatch); } catch (err) { unrecoverableError = true; }
          } else {
            unrecoverableError = true;
          }
        }
      }

      // Process Black
      if (m.black && m.black !== '?' && !unrecoverableError) {
        try {
          chess.move(m.black);
        } catch (e) {
          const legalMoves = chess.moves({ verbose: true });
          const bestMatch = findClosestLegalMove(m.black, legalMoves);
          if (bestMatch) {
            m.suggested_black = bestMatch;
            correctedCount++;
            try { chess.move(bestMatch); } catch (err) { unrecoverableError = true; }
          } else {
            unrecoverableError = true;
          }
        }
      }
    }

    parsed.has_engine_error = unrecoverableError;
    parsed.moves = moves;
    // --- END MOVE CORRECTION ENGINE ---

    const avgConfidence = moves.length > 0
      ? moves.reduce((sum, m) => {
          const wc = m.white_confidence ?? (m.white === '?' ? 0.1 : 0.9);
          const bc = m.black_confidence ?? (m.black === '?' ? 0.1 : 0.9);
          return sum + (wc + bc) / 2;
        }, 0) / moves.length
      : 0;

    // --- Upload Scan to Supabase Storage ---
    let scan_url = null;
    try {
      if (req.files && req.files.page1 && req.files.page1[0]) {
        const file = req.files.page1[0];
        const fileName = `scan_${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
        
        const { error: uploadError } = await supabase.storage
          .from('scans')
          .upload(fileName, file.buffer, {
            contentType: file.mimetype,
            upsert: false
          });
          
        if (!uploadError) {
          const { data: pubData } = supabase.storage.from('scans').getPublicUrl(fileName);
          scan_url = pubData.publicUrl;
        } else {
          console.error('[OCR] Failed to upload scan to Supabase:', uploadError.message);
        }
      }
    } catch (uploadEx) {
      console.error('[OCR] Exception uploading scan:', uploadEx);
    }
    // ----------------------------------------

    res.json({
      success: true,
      data: parsed,
      scan_url: scan_url,
      stats: {
        total_moves: moves.length,
        avg_confidence: Math.round(avgConfidence * 100) / 100,
        uncertain_moves: moves.filter(m => m.white === '?' || m.black === '?').length,
        tokens_used: response.usage?.total_tokens
      }
    });

  } catch (err) {
    console.error('[OCR] OpenAI error:', err);

    if (err.status === 401) {
      return res.status(401).json({ error: 'Invalid OpenAI API key. Check OPENAI_API_KEY in .env' });
    }
    if (err.status === 429) {
      return res.status(429).json({ error: 'OpenAI rate limit exceeded. Please wait a moment and try again.' });
    }
    if (err.status === 400 && err.message?.includes('image')) {
      return res.status(400).json({ error: 'Image too large or unsupported format. Try JPEG under 20MB.' });
    }

    res.status(500).json({ error: err.message || 'OCR processing failed' });
  }
});

module.exports = router;
