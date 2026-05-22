/**
 * pgn-exporter.js
 * Generates standard PGN from game metadata + validated moves
 */

const PGNExporter = (() => {

  /**
   * Build full PGN string
   * @param {Object} meta - { whiteName, whiteFideId, blackName, blackFideId, tournament, round, date, location, result }
   * @param {Array} moves - from ChessParser.validateMoves()
   * @param {String} chessJsPgn - optional PGN from chess.js (contains only valid moves)
   */
  function buildPGN(meta, moves, chessJsPgn) {
    const tags = buildTags(meta);

    // Use chess.js PGN if available and complete, otherwise build manually
    let movesText;
    if (chessJsPgn && chessJsPgn.trim()) {
      // Extract moves part (after tags in chess.js pgn)
      const pgnLines = chessJsPgn.split('\n').filter(l => !l.startsWith('['));
      movesText = pgnLines.join('\n').trim();

      // If some moves failed validation, append partial note
      const hasErrors = moves.some(m => !m.whiteValid || !m.blackValid);
      if (hasErrors) {
        const errorMoves = buildErrorAnnotations(moves);
        if (errorMoves) {
          movesText = movesText.replace(/\s*\*\s*$/, '').replace(/\s*1-0\s*$/, '').replace(/\s*0-1\s*$/, '').replace(/\s*1\/2-1\/2\s*$/, '').trim();
          movesText += ` ${errorMoves}`;
        }
      }
    } else {
      movesText = buildMovesManually(moves, meta.result || '*');
    }

    // Append result
    const result = meta.result || '*';
    if (!movesText.endsWith(result)) {
      movesText = movesText.trim() + ' ' + result;
    }

    return tags + '\n' + movesText;
  }

  function escapeTag(val) {
    if (!val) return '?';
    return String(val).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function buildTags(meta) {
    const tags = [];
    tags.push(`[Event "${escapeTag(meta.tournament)}"]`);
    tags.push(`[Site "${escapeTag(meta.location)}"]`);
    tags.push(`[Date "${escapeTag(formatPGNDate(meta.date))}"]`);
    tags.push(`[Round "${escapeTag(meta.round)}"]`);
    tags.push(`[White "${escapeTag(meta.whiteName)}"]`);
    tags.push(`[Black "${escapeTag(meta.blackName)}"]`);
    tags.push(`[Result "${meta.result || '*'}"]`);

    if (meta.whiteFideId) tags.push(`[WhiteFideId "${escapeTag(meta.whiteFideId)}"]`);
    if (meta.blackFideId) tags.push(`[BlackFideId "${escapeTag(meta.blackFideId)}"]`);
    if (meta.board) tags.push(`[Board "${escapeTag(meta.board)}"]`);

    return tags.join('\n');
  }

  function formatPGNDate(dateStr) {
    if (!dateStr) return '????.??.??';
    try {
      const d = new Date(dateStr);
      if (isNaN(d)) return dateStr;
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yyyy}.${mm}.${dd}`;
    } catch { return '????.??.??'; }
  }

  function buildMovesManually(moves, result) {
    const parts = [];
    for (const m of moves) {
      parts.push(`${m.number}.`);
      parts.push(m.whiteSAN && m.whiteSAN !== '?' ? m.whiteSAN : `{?:${m.white || '??'}}`);
      if (m.blackSAN || m.black) {
        parts.push(m.blackSAN && m.blackSAN !== '?' ? m.blackSAN : `{?:${m.black || '??'}}`);
      }
    }
    return parts.join(' ');
  }

  function buildErrorAnnotations(moves) {
    const errors = moves.filter(m => !m.whiteValid || !m.blackValid);
    if (!errors.length) return '';
    return `{OCR errors at moves: ${errors.map(e => e.number).join(', ')}}`;
  }

  /**
   * Build a Lichess analysis URL from PGN
   */
  function getLichessUrl(pgn) {
    const encoded = encodeURIComponent(pgn);
    return `https://lichess.org/paste?pgn=${encoded}`;
  }

  /**
   * Download PGN as a file
   */
  function downloadPGN(pgn, filename) {
    const blob = new Blob([pgn], { type: 'application/x-chess-pgn' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'game.pgn';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Import PGN directly to Lichess via API
   */
  function importToLichess(pgn) {
    return new Promise((resolve, reject) => {
      try {
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = 'https://lichess.org/api/import';
        form.target = '_blank'; // Opens in a new tab

        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = 'pgn';
        input.value = pgn;

        form.appendChild(input);
        document.body.appendChild(form);
        form.submit();
        
        setTimeout(() => {
          document.body.removeChild(form);
          resolve(); // Resolve immediately after submitting
        }, 100);
      } catch (err) {
        reject(err);
      }
    });
  }

  return { buildPGN, getLichessUrl, importToLichess, downloadPGN };
})();
