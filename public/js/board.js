/**
 * board.js
 * Chess board controller using chessboard.js + position history navigation
 */

const BoardController = (() => {
  let board = null;
  let fenHistory = [];
  let currentIndex = 0;
  let processedMoves = [];

  function init(containerId) {
    const cfg = {
      position: 'start',
      showNotation: true,
      pieceTheme: 'https://lichess1.org/assets/piece/cburnett/{piece}.svg',
      draggable: false,
    };

    // Resize board to fit container
    const containerEl = document.getElementById(containerId);
    if (!containerEl) return;
    const width = Math.min(containerEl.parentElement.offsetWidth - 32, 440);

    board = Chessboard(containerId, { ...cfg, pieceTheme: cfg.pieceTheme });
    $(window).resize(() => {
      if (board) board.resize();
    });
  }

  function loadGame(moves) {
    processedMoves = moves;
    fenHistory = ChessParser.getFENHistory(moves.filter(m => m.whiteValid || m.whiteSAN));
    currentIndex = 0;
    updateBoardToIndex(0);
  }

  function updateBoardToIndex(idx) {
    if (!board || fenHistory.length === 0) return;
    currentIndex = Math.max(0, Math.min(idx, fenHistory.length - 1));
    board.position(fenHistory[currentIndex]);

    // Update move indicator
    const indicator = document.getElementById('board-move-indicator');
    const status = document.getElementById('board-status');
    if (indicator) {
      if (currentIndex === 0) {
        indicator.textContent = 'Нач.';
      } else {
        const moveNum = Math.ceil(currentIndex / 2);
        const color = currentIndex % 2 === 1 ? '♔' : '♚';
        indicator.textContent = `${moveNum}. ${color}`;
      }
    }

    // Highlight active move in table
    document.querySelectorAll('.moves-table tbody tr').forEach((row, i) => {
      row.classList.remove('active-move');
    });
    if (currentIndex > 0) {
      const rowIdx = Math.floor((currentIndex - 1) / 2);
      const rows = document.querySelectorAll('.moves-table tbody tr');
      if (rows[rowIdx]) {
        rows[rowIdx].classList.add('active-move');
        rows[rowIdx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }

    if (status) {
      // Show chess.js game state at current position
      try {
        const chess = new Chess(fenHistory[currentIndex]);
        if (chess.in_checkmate()) status.textContent = '♟ Мат!';
        else if (chess.in_stalemate()) status.textContent = '½ Пат';
        else if (chess.in_check()) status.textContent = '⚡ Шах';
        else if (chess.in_draw()) status.textContent = '½ Ничья';
        else status.textContent = '';
      } catch { status.textContent = ''; }
    }
  }

  function goToStart() { updateBoardToIndex(0); }
  function goToEnd() { updateBoardToIndex(fenHistory.length - 1); }
  function goForward() { updateBoardToIndex(currentIndex + 1); }
  function goBack() { updateBoardToIndex(currentIndex - 1); }
  function goToMove(halfMoveIndex) { updateBoardToIndex(halfMoveIndex); }

  function resize() {
    if (board) board.resize();
  }

  return { init, loadGame, goToStart, goToEnd, goForward, goBack, goToMove, resize };
})();
