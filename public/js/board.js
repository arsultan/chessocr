import { Chessground } from 'https://unpkg.com/chessground@9.2.1/dist/chessground.min.js';

export const BoardController = (() => {
  let cg = null;
  let fenHistory = [];
  let currentIndex = 0;
  let processedMoves = [];
  let editMoveCallback = null;
  let editChess = null;

  function init(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    // CSS handles the size and aspect ratio now

    cg = Chessground(container, {
      fen: 'start',
      viewOnly: true,
      animation: { enabled: true, duration: 200 }
    });

    window.addEventListener('resize', resize);
  }

  function resize() {
    // Chessground handles resize automatically, CSS aspect-ratio maintains square shape
  }

  function loadGame(moves) {
    processedMoves = moves;
    fenHistory = ChessParser.getFENHistory(moves.filter(m => m.whiteValid || m.whiteSAN));
    currentIndex = 0;
    updateBoardToIndex(0);
  }

  function updateBoardToIndex(idx) {
    if (!cg || fenHistory.length === 0) return;
    currentIndex = Math.max(0, Math.min(idx, fenHistory.length - 1));
    
    cg.set({
      fen: fenHistory[currentIndex],
      viewOnly: true,
      lastMove: null // Clear last move highlight when navigating history
    });

    const indicator = document.getElementById('board-move-indicator');
    const status = document.getElementById('board-status');
    if (indicator) {
      if (currentIndex === 0) indicator.textContent = 'Нач.';
      else {
        const moveNum = Math.ceil(currentIndex / 2);
        const color = currentIndex % 2 === 1 ? '♔' : '♚';
        indicator.textContent = `${moveNum}. ${color}`;
      }
    }

    document.querySelectorAll('.moves-table tbody tr').forEach((row) => {
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

  function calculateDests(chess) {
    const dests = new Map();
    chess.SQUARES.forEach(s => {
      const ms = chess.moves({ square: s, verbose: true });
      if (ms.length) dests.set(s, ms.map(m => m.to));
    });
    return dests;
  }

  function enableEditMode(fen, callback) {
    editMoveCallback = callback;
    editChess = new Chess(fen);
    
    const turnColor = editChess.turn() === 'w' ? 'white' : 'black';
    const dests = calculateDests(editChess);

    cg.set({
      fen: fen,
      viewOnly: false,
      turnColor: turnColor,
      movable: {
        color: turnColor,
        free: false,
        dests: dests,
        showDests: true,
        events: {
          after: (orig, dest) => {
            const move = editChess.move({ from: orig, to: dest, promotion: 'q' });
            if (move && editMoveCallback) {
              editMoveCallback(move.san);
            }
            editChess.undo();
          }
        }
      }
    });
  }

  function disableEditMode() {
    editMoveCallback = null;
    editChess = null;
    if (fenHistory[currentIndex]) {
      cg.set({
        fen: fenHistory[currentIndex],
        viewOnly: true
      });
    }
  }

  function goToStart() { updateBoardToIndex(0); }
  function goToEnd() { updateBoardToIndex(fenHistory.length - 1); }
  function goForward() { updateBoardToIndex(currentIndex + 1); }
  function goBack() { updateBoardToIndex(currentIndex - 1); }
  function goToMove(halfMoveIndex) { updateBoardToIndex(halfMoveIndex); }
  // resize is defined above

  return { init, loadGame, goToStart, goToEnd, goForward, goBack, goToMove, resize, enableEditMode, disableEditMode };
})();
