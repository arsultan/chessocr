/**
 * chess-parser.js
 * Converts Cyrillic chess notation to standard SAN, validates moves with chess.js
 */

const ChessParser = (() => {

  // Cyrillic piece map → standard SAN pieces
  const CYRILLIC_TO_SAN = {
    'Кр': 'K',  // Король → King
    'Фр': 'Q',  // fallback
    'Ф':  'Q',  // Ферзь → Queen
    'Л':  'R',  // Ладья → Rook
    'Сл': 'B',  // Слон → Bishop
    'С':  'B',  // Слон → Bishop
    'Кк': 'N',  // Knight (alternative)
    'К':  'N',  // Конь → Knight (must come after Кр in processing)
  };

  // Note: order matters — process longer prefixes first
  const CYRILLIC_ORDERED = ['Кр', 'Фр', 'Сл', 'Ф', 'Л', 'С', 'Кк', 'К'];

  /**
   * Convert a single move string from Cyrillic to standard SAN
   * e.g. "Кe4" → "Ne4", "Лxe4" → "Rxe4", "Крg1" → "Kg1"
   */
  function convertMove(raw) {
    if (!raw || raw === '?' || raw === '') return raw;

    let move = raw.trim();

    // Handle castling variants
    move = move.replace(/О-О-О|0-0-0|о-о-о/gi, 'O-O-O');
    move = move.replace(/О-О|0-0|о-о/gi, 'O-O');

    // Replace × with x (capture symbol)
    move = move.replace(/×/g, 'x');

    // Replace Cyrillic piece prefixes
    for (const cyr of CYRILLIC_ORDERED) {
      if (move.startsWith(cyr)) {
        move = CYRILLIC_TO_SAN[cyr] + move.slice(cyr.length);
        break;
      }
    }

    // Normalize: remove dots, extra spaces
    move = move.replace(/\.\.\./g, '').replace(/\s+/g, '').trim();

    // Handle pawn promotion: e8=Q, e8(Q), e8/Q
    move = move.replace(/\(([QRBN])\)/, '=$1');
    move = move.replace(/\/([QRBN])/, '=$1');

    return move;
  }

  /**
   * Validate moves with chess.js and return structured result
   * @param {Array} rawMoves - array of {number, white, black, white_confidence, black_confidence}
   * @returns {Object} { moves, pgn, validMoves, errorMoves, gameResult, chess }
   */
  function validateMoves(rawMoves) {
    const chess = typeof Chess !== 'undefined' ? new Chess() : null;
    const processedMoves = [];
    let gameEnded = false;
    let errorCount = 0;
    let validCount = 0;

    for (const entry of rawMoves) {
      const moveNum = entry.number;

      // Process White's move
      const whiteRaw = entry.white || '';
      const blackRaw = entry.black || '';

      if (!whiteRaw && !blackRaw) continue;

      const whiteSAN = convertMove(whiteRaw);
      const blackSAN = convertMove(blackRaw);

      const fenBeforeWhite = chess ? chess.fen() : null;
      const whiteResult = validateSingleMove(chess, whiteSAN, moveNum, 'white', entry.white_confidence);
      if (whiteResult.valid) validCount++;
      else if (whiteRaw && whiteRaw !== '?') {
        errorCount++;
        if (entry.suggested_white && chess) {
          try { chess.move(entry.suggested_white); } catch(e) {}
        }
      }

      const fenBeforeBlack = chess ? chess.fen() : null;
      const blackResult = validateSingleMove(chess, blackSAN, moveNum, 'black', entry.black_confidence);
      if (blackResult.valid) validCount++;
      else if (blackRaw && blackRaw !== '?') {
        errorCount++;
        if (entry.suggested_black && chess) {
          try { chess.move(entry.suggested_black); } catch(e) {}
        }
      }

      processedMoves.push({
        number: moveNum,
        white: whiteRaw,
        whiteSAN: whiteSAN,
        whiteValid: whiteResult.valid,
        whiteError: whiteResult.error,
        whiteConfidence: entry.white_confidence || 0.9,
        fenBeforeWhite: fenBeforeWhite,
        suggestedWhite: entry.suggested_white || null,

        black: blackRaw,
        blackSAN: blackSAN,
        blackValid: blackResult.valid,
        blackError: blackResult.error,
        blackConfidence: entry.black_confidence || 0.9,
        fenBeforeBlack: fenBeforeBlack,
        suggestedBlack: entry.suggested_black || null,
      });

      // Stop if game ended (checkmate, etc.)
      if (chess && chess.game_over()) {
        gameEnded = true;
        break;
      }
    }

    const pgn = chess ? chess.pgn() : '';

    return {
      moves: processedMoves,
      pgn,
      validMoves: validCount,
      errorMoves: errorCount,
      totalMoves: processedMoves.length,
      gameEnded,
      chess,
    };
  }

  /**
   * Attempt to make a move on the chess instance
   * Returns { valid: bool, move: object|null, error: string|null }
   */
  function validateSingleMove(chess, san, moveNum, color, confidence) {
    if (!san || san === '?' || san === '') {
      return { valid: false, move: null, error: 'Unreadable move' };
    }

    if (!chess) {
      // No chess.js available, just return as-is
      return { valid: true, move: { san }, error: null };
    }

    // Skip validation if game already over
    if (chess.game_over()) {
      return { valid: false, move: null, error: 'Game already ended' };
    }

    // Try making the move
    try {
      const result = chess.move(san, { sloppy: true });
      if (result) {
        return { valid: true, move: result, error: null };
      } else {
        return { valid: false, move: null, error: `Illegal move: ${san}` };
      }
    } catch (e) {
      return { valid: false, move: null, error: e.message || `Invalid: ${san}` };
    }
  }

  /**
   * Get FEN positions array for board navigation
   * @param {Object} chess - chess.js instance after playing moves
   * @param {Array} processedMoves - from validateMoves
   */
  function getFENHistory(rawMoves) {
    const chess = typeof Chess !== 'undefined' ? new Chess() : null;
    if (!chess) return [];

    const history = ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'];

    for (const entry of rawMoves) {
      if (entry.whiteSAN && entry.whiteSAN !== '?') {
        const r = chess.move(entry.whiteSAN, { sloppy: true });
        if (r) history.push(chess.fen());
        else break;
      }
      if (entry.blackSAN && entry.blackSAN !== '?') {
        const r = chess.move(entry.blackSAN, { sloppy: true });
        if (r) history.push(chess.fen());
        else break;
      }
    }
    return history;
  }

  return { convertMove, validateMoves, getFENHistory };
})();
