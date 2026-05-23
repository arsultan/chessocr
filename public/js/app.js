/**
 * app.js — Main ChessOCR Application
 */

import { BoardController } from './board.js';

const App = (() => {
  // State
  let state = {
    page1File: null,
    page2File: null,
    ocrResult: null,
    processedMoves: [],
    pgn: '',
    zoomLevel: 1,
    editGameId: null,
    scan_url: null,
    historyStack: []
  };

  // ─── Init ──────────────────────────────────────────────────────────
  function init() {
    setupUploadZone();
    setupFileInputs();
    setupProcessButton();
    setupReviewControls();
    setupBoardControls();
    setupSaveButton();
    setupPGNActions();
    setupImportGames();

    // Init board
    BoardController.init('chess-board');

    // Keyboard shortcuts for board
    document.addEventListener('keydown', (e) => {
      const screen = document.getElementById('screen-review');
      if (!screen || screen.classList.contains('hidden')) return;
      if (e.key === 'ArrowRight') BoardController.goForward();
      if (e.key === 'ArrowLeft') BoardController.goBack();
      if (e.key === 'Home') BoardController.goToStart();
      if (e.key === 'End') BoardController.goToEnd();
    });

    const urlParams = new URLSearchParams(window.location.search);
    const editId = urlParams.get('edit');
    if (editId) {
      loadGameForEdit(editId);
    }
  }

  // ─── Upload Zone ──────────────────────────────────────────────────
  function setupUploadZone() {
    const zone = document.getElementById('upload-zone-main');
    const fileInput = document.getElementById('file-page1');

    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
      if (files[0]) setPageFile(1, files[0]);
    });

    fileInput.addEventListener('change', (e) => {
      const files = Array.from(e.target.files);
      if (files[0]) setPageFile(1, files[0]);
    });
  }

  function setupFileInputs() {
    const cameraInput = document.getElementById('file-camera');
    if (cameraInput) {
      cameraInput.addEventListener('change', (e) => {
        if (e.target.files[0]) setPageFile(1, e.target.files[0]);
      });
    }
  }

  function setPageFile(page, file) {
    state.page1File = file;
    state.page2File = null;

    // Show preview
    const previewEl = document.getElementById('main-preview');
    const contentEl = document.getElementById('upload-zone-content');
    
    if (previewEl && contentEl) {
      const reader = new FileReader();
      reader.onload = (e) => {
        previewEl.innerHTML = `<img src="${e.target.result}" alt="Скан" style="max-height: 250px; border-radius: var(--radius);">`;
        previewEl.classList.remove('hidden');
        contentEl.classList.add('hidden');
      };
      reader.readAsDataURL(file);
    }

    updateProcessButton();
  }

  function updateProcessButton() {
    const btn = document.getElementById('btn-process');
    const note = document.getElementById('process-note');
    if (state.page1File) {
      btn.disabled = false;
      if (note) note.textContent = `Готов к распознаванию`;
    } else {
      btn.disabled = true;
      if (note) note.textContent = 'Добавьте скан бланка';
    }
  }

  // ─── Process ──────────────────────────────────────────────────────
  function setupProcessButton() {
    const btn = document.getElementById('btn-process');
    btn.addEventListener('click', processScoresheet);
  }

  async function processScoresheet() {
    if (!state.page1File && !state.page2File) return;

    showScreen('processing');
    updateProcessingStatus('Отправляем изображение в Gemini AI...');

    try {
      const formData = new FormData();
      if (state.page1File) formData.append('page1', state.page1File);
      if (state.page2File) formData.append('page2', state.page2File);

      updateProcessingStatus('Распознаём ходы...');
      const response = await fetch('/api/process-image', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || `HTTP ${response.status}`);
      }

      const result = await response.json();
      state.ocrResult = result.data;
      state.scan_url = result.scan_url || null;

      updateProcessingStatus('Валидация ходов...');
      await new Promise(r => setTimeout(r, 400));

      // Parse and validate moves
      const validationResult = ChessParser.validateMoves(state.ocrResult.moves || []);
      state.processedMoves = validationResult.moves;
      state.historyStack = [];
      const btnUndo = document.getElementById('btn-undo');
      if (btnUndo) btnUndo.style.display = 'none';

      // Generate PGN
      const meta = buildMetaFromOCR(state.ocrResult);
      state.pgn = PGNExporter.buildPGN(meta, state.processedMoves, validationResult.pgn);

      showScreen('review');
      BoardController.resize(); // Ensure board size is calculated
      populateReviewScreen(state.ocrResult, state.processedMoves, result.stats, state.pgn);

    } catch (err) {
      console.error('Process error:', err);
      showScreen('upload');
      showToast('Ошибка: ' + err.message, 'error');
    }
  }

  function updateProcessingStatus(msg) {
    const el = document.getElementById('processing-sub');
    if (el) el.textContent = msg;
  }

  async function loadGameForEdit(id) {
    state.editGameId = id;
    showScreen('processing');
    updateProcessingStatus('Загрузка партии...');

    try {
      const res = await fetch(`/api/games/${id}`);
      if (!res.ok) throw new Error('Не удалось загрузить партию');
      const game = await res.json();

      // Handle both new and old formats
      let rawMoves = game.raw_moves;
      if (typeof rawMoves === 'string') {
        try { rawMoves = JSON.parse(rawMoves); } catch(e) {}
      }
      
      if (!rawMoves) {
        let gameMoves = game.moves;
        if (typeof gameMoves === 'string') {
          try { gameMoves = JSON.parse(gameMoves); } catch(e) {}
        }
        
        if (gameMoves && Array.isArray(gameMoves) && gameMoves.length > 0) {
          rawMoves = gameMoves;
        } else if (game.pgn) {
          try {
            const chess = new Chess();
            const loaded = chess.load_pgn(game.pgn);
            rawMoves = [];
            
            if (loaded) {
              const hist = chess.history();
              for (let i = 0; i < hist.length; i += 2) {
                rawMoves.push({
                  number: Math.floor(i / 2) + 1,
                  white: hist[i],
                  black: hist[i + 1] || null
                });
              }
            } else {
              // Manual fuzzy parse for PGNs with illegal moves or OCR errors
              const pgnText = game.pgn.replace(/\[.*?\]/g, '').trim(); // Remove tags
              const tokens = pgnText.split(/\s+/).filter(t => t);
              let currentMove = null;
              
              for (const t of tokens) {
                if (t === '1-0' || t === '0-1' || t === '1/2-1/2' || t === '*') continue;
                
                if (/^\d+\./.test(t)) {
                  const num = parseInt(t);
                  currentMove = { number: num, white: null, black: null };
                  rawMoves.push(currentMove);
                  
                  const rest = t.replace(/^\d+\./, '');
                  if (rest) currentMove.white = rest;
                } else if (currentMove) {
                  if (!currentMove.white) {
                    currentMove.white = t;
                  } else if (!currentMove.black) {
                    currentMove.black = t;
                  }
                }
              }
              
              // Clean up {?:move} format from manual PGN builder
              rawMoves.forEach(m => {
                if (m.white && m.white.startsWith('{?:')) m.white = m.white.replace('{?:', '').replace('}', '');
                if (m.black && m.black.startsWith('{?:')) m.black = m.black.replace('{?:', '').replace('}', '');
              });
            }
          } catch (e) {
            console.error('Failed to parse PGN for fallback', e);
          }
        }
        
        if (!rawMoves || rawMoves.length === 0) {
          throw new Error('Данная партия не содержит списка ходов.');
        }
      }

      // Re-validate to ensure fenBefore and other internal states are generated
      const validationResult = ChessParser.validateMoves(rawMoves);
      state.processedMoves = validationResult.moves;
      state.historyStack = [];
      const btnUndo = document.getElementById('btn-undo');
      if (btnUndo) btnUndo.style.display = 'none';
      
      state.pgn = game.pgn;
      state.scan_url = game.scan_url || null;
      
      const ocrFake = {
        moves: rawMoves,
        white_name: game.white_name,
        black_name: game.black_name,
        tournament: game.tournament,
        round: game.round,
        board_number: game.board_number,
        location: game.location,
        game_date: game.game_date,
        result: game.result
      };

      state.ocrResult = ocrFake; // Required for editing to work

      // Set fide IDs directly
      document.getElementById('white-fide-id').value = game.white_fide_id || '';
      document.getElementById('black-fide-id').value = game.black_fide_id || '';

      showScreen('review');
      BoardController.resize(); // Ensure board size is calculated now that it's visible
      populateReviewScreen(ocrFake, state.processedMoves, null, state.pgn);
      
      // Setup image fallback if scan_url exists but we aren't loading an image
      const img = document.getElementById('scan-preview-img');
      const scanCard = img ? img.closest('.card') : null;
      if (img && game.scan_url) {
        img.src = game.scan_url;
        img.style.display = '';
        if (scanCard) scanCard.style.display = '';
      } else if (img) {
        img.style.display = 'none'; // hide if no image
        if (scanCard) scanCard.style.display = 'none';
      }

    } catch (err) {
      console.error('Edit error:', err);
      showScreen('upload');
      showToast('Ошибка: ' + err.message, 'error');
    }
  }

  // ─── Review Screen ────────────────────────────────────────────────
  function populateReviewScreen(ocr, moves, stats, pgn) {
    // Stats subtitle
    const statsEl = document.getElementById('review-stats');
    if (statsEl && stats) {
      const conf = Math.round((stats.avg_confidence || 0) * 100);
      statsEl.textContent = `${stats.total_moves} ходов · точность ~${conf}% · ошибок: ${stats.uncertain_moves || 0}`;
    }

    // Pre-fill player info
    document.getElementById('white-name').value = ocr.white_name || '';
    document.getElementById('black-name').value = ocr.black_name || '';

    // Pre-fill meta
    if (ocr.tournament) document.getElementById('meta-tournament').value = ocr.tournament;
    if (ocr.round) document.getElementById('meta-round').value = ocr.round;
    if (ocr.board_number) document.getElementById('meta-board').value = ocr.board_number;
    if (ocr.location) document.getElementById('meta-location').value = ocr.location;
    if (ocr.game_date) document.getElementById('meta-date').value = ocr.game_date;
    if (ocr.result && ocr.result !== '*') {
      const select = document.getElementById('meta-result');
      if (select) select.value = ocr.result;
    }

    // Scan preview
    const img = document.getElementById('scan-preview-img');
    const scanCard = img ? img.closest('.card') : null;
    
    if (state.page1File) {
      const reader = new FileReader();
      reader.onload = (e) => {
        if (img) {
          img.src = e.target.result;
          img.style.display = '';
          if (scanCard) scanCard.style.display = '';
        }
      };
      reader.readAsDataURL(state.page1File);
    }

    // Moves table
    renderMovesTable(moves);

    // PGN
    const pgnEl = document.getElementById('pgn-output');
    if (pgnEl) pgnEl.value = pgn;

    // Validation status
    renderValidationStatus(moves);

    // Load board
    BoardController.loadGame(moves);
    setTimeout(() => BoardController.resize(), 100);

    // Moves stats
    const movesStatsEl = document.getElementById('moves-stats');
    const errorMoves = moves.filter(m => (!m.whiteValid && m.white && m.white !== '?') || (!m.blackValid && m.black && m.black !== '?')).length;
    if (movesStatsEl) {
      if (errorMoves > 0) {
        movesStatsEl.innerHTML = `<span class="badge badge--error">⚠ ${errorMoves} ошибок</span>`;
      } else {
        movesStatsEl.innerHTML = `<span class="badge badge--success">✓ Все ходы верны</span>`;
      }
    }

    // Lichess button
    const lichessBtn = document.getElementById('btn-lichess-analysis');
    if (lichessBtn) {
      lichessBtn.onclick = async () => {
        try {
          lichessBtn.textContent = 'Экспорт...';
          lichessBtn.disabled = true;
          
          await PGNExporter.importToLichess(pgn);
          // window.open is no longer needed, the form submission opens a new tab automatically
        } catch (err) {
          showToast('Ошибка экспорта в Lichess', 'error');
          console.error(err);
        } finally {
          lichessBtn.textContent = 'Открыть в Lichess ↗';
          lichessBtn.disabled = false;
        }
      };
    }

    // Update save requirements
    updateSaveRequirements();
  }

  function renderMovesTable(moves) {
    const tbody = document.getElementById('moves-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    moves.forEach((m, idx) => {
      const tr = document.createElement('tr');

      // Number cell
      const tdNum = document.createElement('td');
      tdNum.className = 'td-num';
      tdNum.textContent = m.number + '.';
      tr.appendChild(tdNum);

      // White move
      const tdWhite = document.createElement('td');
      tdWhite.className = 'td-move';
      if (!m.whiteValid && m.white) tdWhite.classList.add('error-move');
      else if (m.whiteConfidence < 0.6) tdWhite.classList.add('uncertain-move');

      const whiteSpan = document.createElement('span');
      whiteSpan.className = 'move-text';
      whiteSpan.textContent = m.whiteSAN || m.white || '';
      whiteSpan.title = m.whiteError || '';
      whiteSpan.onclick = () => BoardController.goToMove(idx * 2 + 1);
      tdWhite.appendChild(whiteSpan);

      if (!m.whiteValid && m.white && m.white !== '?') {
        const warn = document.createElement('span');
        warn.className = 'move-warn';
        warn.textContent = '⚠';
        warn.title = m.whiteError || 'Нелегальный ход';
        tdWhite.appendChild(warn);
      }

      const editWhite = document.createElement('button');
      editWhite.className = 'btn-edit-move';
      editWhite.innerHTML = '✏️';
      editWhite.title = 'Изменить ход';
      editWhite.onclick = (e) => { e.stopPropagation(); editMove(idx, 'white', tdWhite); };
      tdWhite.appendChild(editWhite);

      tr.appendChild(tdWhite);

      // Black move
      const tdBlack = document.createElement('td');
      tdBlack.className = 'td-move';
      if (!m.blackValid && m.black) tdBlack.classList.add('error-move');
      else if (m.blackConfidence < 0.6) tdBlack.classList.add('uncertain-move');

      const blackSpan = document.createElement('span');
      blackSpan.className = 'move-text';
      blackSpan.textContent = m.blackSAN || m.black || '';
      blackSpan.title = m.blackError || '';
      blackSpan.onclick = () => BoardController.goToMove(idx * 2 + 2);
      tdBlack.appendChild(blackSpan);

      if (!m.blackValid && m.black && m.black !== '?') {
        const warn = document.createElement('span');
        warn.className = 'move-warn';
        warn.textContent = '⚠';
        warn.title = m.blackError || 'Нелегальный ход';
        tdBlack.appendChild(warn);
      }

      const editBlack = document.createElement('button');
      editBlack.className = 'btn-edit-move';
      editBlack.innerHTML = '✏️';
      editBlack.title = 'Изменить ход';
      editBlack.onclick = (e) => { e.stopPropagation(); editMove(idx, 'black', tdBlack); };
      tdBlack.appendChild(editBlack);

      tr.appendChild(tdBlack);

      tbody.appendChild(tr);
    });
  }

  function editMove(idx, color, cell) {
    if (cell.querySelector('input')) return; // already editing

    const moveData = state.processedMoves[idx];
    const rawValue = color === 'white' ? moveData.white : moveData.black;
    const fenBefore = color === 'white' ? moveData.fenBeforeWhite : moveData.fenBeforeBlack;
    
    // Generate legal moves for datalist
    let legalMoves = [];
    if (fenBefore) {
      try {
        const chess = new Chess(fenBefore);
        legalMoves = chess.moves();
      } catch (e) { console.error('Failed to get legal moves', e); }
    }

    const suggestedMove = color === 'white' ? moveData.suggestedWhite : moveData.suggestedBlack;
    if (suggestedMove && !legalMoves.includes(suggestedMove)) {
      legalMoves.unshift(suggestedMove);
    } else if (suggestedMove) {
      legalMoves = [suggestedMove, ...legalMoves.filter(m => m !== suggestedMove)];
    }

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'move-edit-input';
    input.value = rawValue !== '?' ? rawValue : '';
    input.placeholder = 'Ход...';
    
    const listId = `legal-${idx}-${color}`;
    input.setAttribute('list', listId);
    
    const datalist = document.createElement('datalist');
    datalist.id = listId;
    legalMoves.forEach(m => {
      const option = document.createElement('option');
      option.value = m;
      if (m === suggestedMove) option.textContent = 'Предложение ИИ';
      datalist.appendChild(option);
    });

    let isSaved = false;
    const save = () => {
      if (isSaved) return;
      isSaved = true;
      
      // Restore old value if user leaves it completely empty
      if (input.value.trim() === '' && input.dataset.oldValue) {
        input.value = input.dataset.oldValue;
      }
      
      const newVal = input.value.trim();
      BoardController.disableEditMode();
      if (newVal !== rawValue && newVal !== '') {
        // Save current state for Undo
        state.historyStack.push(JSON.stringify(state.ocrResult.moves));
        if (state.historyStack.length > 50) state.historyStack.shift();
        
        const btnUndo = document.getElementById('btn-undo');
        if (btnUndo) btnUndo.style.display = 'inline-flex';

        // Update raw OCR result
        if (!state.ocrResult.moves[idx]) state.ocrResult.moves[idx] = { number: idx + 1 };
        
        if (color === 'white') state.ocrResult.moves[idx].white = newVal;
        else state.ocrResult.moves[idx].black = newVal;
        
        // Re-validate
        const validationResult = ChessParser.validateMoves(state.ocrResult.moves);
        state.processedMoves = validationResult.moves;
        
        // Update PGN and UI
        const meta = buildMetaFromOCR(state.ocrResult);
        state.pgn = PGNExporter.buildPGN(meta, state.processedMoves, validationResult.pgn);
        
        populateReviewScreen(state.ocrResult, state.processedMoves, null, state.pgn);
        showToast('Ход обновлён', 'success');
      } else {
        renderMovesTable(state.processedMoves);
      }
    };

    input.addEventListener('focus', () => {
      if (!input.dataset.oldValue) {
        input.dataset.oldValue = input.value;
      }
      input.value = '';
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') save();
      else if (e.key === 'Escape') {
        input.value = input.dataset.oldValue || rawValue;
        save();
      }
    });

    input.addEventListener('blur', () => {
      // Give a tiny delay so datalist click can register before saving
      setTimeout(save, 150);
    });

    cell.innerHTML = '';
    cell.appendChild(input);
    cell.appendChild(datalist);
    input.focus();

    if (fenBefore) {
      BoardController.enableEditMode(fenBefore, (sanMove) => {
        input.value = sanMove;
        save();
      });
    }
  }

  function renderValidationStatus(moves) {
    const container = document.getElementById('validation-status');
    if (!container) return;
    container.innerHTML = '';

    const total = moves.length;
    const errors = moves.filter(m => !m.whiteValid || !m.blackValid);
    const uncertain = moves.filter(m => m.whiteConfidence < 0.7 || m.blackConfidence < 0.7);

    if (errors.length === 0 && uncertain.length === 0) {
      addValidationItem(container, 'valid', `✓ Все ${total * 2} ходов успешно провалидированы`);
    } else {
      if (errors.length > 0) {
        addValidationItem(container, 'invalid', `✗ ${errors.length} ходов нелегальны — проверьте и исправьте`);
      }
      if (uncertain.length > 0) {
        addValidationItem(container, 'warning', `⚠ ${uncertain.length} ходов с низкой уверенностью OCR`);
      }
      if (total - errors.length > 0) {
        addValidationItem(container, 'valid', `✓ ${(total - errors.length) * 2} ходов прошли валидацию`);
      }
    }
  }

  function addValidationItem(container, type, text) {
    const div = document.createElement('div');
    div.className = `validation-item ${type}`;
    div.textContent = text;
    container.appendChild(div);
  }

  // ─── Board Controls ───────────────────────────────────────────────
  function setupBoardControls() {
    document.getElementById('btn-board-start')?.addEventListener('click', () => BoardController.goToStart());
    document.getElementById('btn-board-prev')?.addEventListener('click', () => BoardController.goBack());
    document.getElementById('btn-board-next')?.addEventListener('click', () => BoardController.goForward());
    document.getElementById('btn-board-end')?.addEventListener('click', () => BoardController.goToEnd());

    // Setup move list zoom
    document.getElementById('btn-moves-zoom-in')?.addEventListener('click', () => {
      document.querySelector('.moves-table').style.fontSize = '1.1rem';
    });
    document.getElementById('btn-moves-zoom-out')?.addEventListener('click', () => {
      document.querySelector('.moves-table').style.fontSize = '0.9rem';
    });
    document.getElementById('btn-moves-zoom-reset')?.addEventListener('click', () => {
      document.querySelector('.moves-table').style.fontSize = '1rem';
    });

    // Global undo (Ctrl+Z)
    const performUndo = () => {
      if (state.historyStack.length > 0) {
        const prevStr = state.historyStack.pop();
        state.ocrResult.moves = JSON.parse(prevStr);
        
        // Re-validate and update UI
        const validationResult = ChessParser.validateMoves(state.ocrResult.moves);
        state.processedMoves = validationResult.moves;
        const meta = buildMetaFromOCR(state.ocrResult);
        state.pgn = PGNExporter.buildPGN(meta, state.processedMoves, validationResult.pgn);
        
        populateReviewScreen(state.ocrResult, state.processedMoves, null, state.pgn);
        showToast('Действие отменено', 'info');
        
        const btnUndo = document.getElementById('btn-undo');
        if (btnUndo) btnUndo.style.display = state.historyStack.length > 0 ? 'inline-flex' : 'none';
      }
    };

    document.getElementById('btn-undo')?.addEventListener('click', performUndo);

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
        // Don't intercept if user is typing in an input/textarea
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        e.preventDefault();
        performUndo();
      }
    });

    // Zoom controls
    document.getElementById('btn-zoom-in')?.addEventListener('click', () => {
      state.zoomLevel = Math.min(3, state.zoomLevel + 0.25);
      applyZoom();
    });
    document.getElementById('btn-zoom-out')?.addEventListener('click', () => {
      state.zoomLevel = Math.max(0.5, state.zoomLevel - 0.25);
      applyZoom();
    });
    document.getElementById('btn-zoom-reset')?.addEventListener('click', () => {
      state.zoomLevel = 1;
      applyZoom();
    });
  }

  function applyZoom() {
    const img = document.getElementById('scan-preview-img');
    if (img) img.style.transform = `scale(${state.zoomLevel})`;
  }

  // ─── Review Controls ──────────────────────────────────────────────
  function setupReviewControls() {
    document.getElementById('btn-back')?.addEventListener('click', () => {
      if (state.editGameId) {
        window.location.href = '/database.html';
      } else {
        showScreen('upload');
      }
    });

    // FIDE ID inputs - update save button state on change
    ['white-fide-id', 'black-fide-id', 'white-name', 'black-name'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', updateSaveRequirements);
    });

    // FIDE ID Autocomplete from our database
    let debounceTimer;
    const fetchSuggestions = async (q) => {
      if (!q || q.length < 2) return;
      try {
        const res = await fetch(`/api/games/players/search?q=${encodeURIComponent(q)}`);
        if (res.ok) {
          const players = await res.json();
          const datalist = document.getElementById('fide-suggestions');
          if (datalist) {
            datalist.innerHTML = players.map(p => `<option value="${p.fide_id}">${p.name || ''}</option>`).join('');
          }
        }
      } catch (err) {
        console.error('Failed to fetch suggestions:', err);
      }
    };

    ['white-fide-id', 'black-fide-id'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', (e) => {
        const val = e.target.value.trim();
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => fetchSuggestions(val), 300);
      });
    });

    // Auto-fetch names from FIDE ID
    ['white', 'black'].forEach(color => {
      const input = document.getElementById(`${color}-fide-id`);
      const nameInput = document.getElementById(`${color}-name`);
      if (input && nameInput) {
        input.addEventListener('blur', async () => {
          const fideId = input.value.trim();
          if (fideId && fideId.length >= 4) {
            try {
              nameInput.value = 'Загрузка...';
              const res = await fetch(`https://api.chesstools.org/fide/${fideId}`, { headers: { 'accept': 'application/json' } });
              if (res.ok) {
                const data = await res.json();
                let displayName = data.name;
                if (displayName && displayName.includes(',')) {
                  const parts = displayName.split(',');
                  displayName = `${parts[1].trim()} ${parts[0].trim()}`;
                }
                nameInput.value = displayName || '';
              } else {
                nameInput.value = '';
              }
              updateSaveRequirements();
            } catch {
              nameInput.value = '';
              updateSaveRequirements();
            }
          }
        });
      }
    });
  }

  // ─── Save to Database ─────────────────────────────────────────────
  function setupSaveButton() {
    const btn = document.getElementById('btn-save');
    btn?.addEventListener('click', saveGame);
  }

  function updateSaveRequirements() {
    const whiteFide = (document.getElementById('white-fide-id')?.value || '').trim();
    const blackFide = (document.getElementById('black-fide-id')?.value || '').trim();
    const pgn = (document.getElementById('pgn-output')?.value || '').trim();

    const requirements = [
      { text: 'FIDE ID белого игрока', met: whiteFide.length > 0 },
      { text: 'FIDE ID чёрного игрока', met: blackFide.length > 0 },
      { text: 'PGN партии', met: pgn.length > 0 },
    ];

    const reqList = document.getElementById('save-req-list');
    if (reqList) {
      reqList.innerHTML = requirements.map(r =>
        `<li class="${r.met ? 'met' : 'unmet'}">${r.met ? '✓' : '○'} ${r.text}</li>`
      ).join('');
    }

    const saveReqs = document.getElementById('save-requirements');
    const allMet = requirements.every(r => r.met);
    if (saveReqs) saveReqs.style.display = allMet ? 'none' : 'block';

    const btn = document.getElementById('btn-save');
    if (btn) btn.disabled = !allMet;

    // Show FIDE ID badges
    ['white', 'black'].forEach(color => {
      const badge = document.getElementById(`${color}-fide-badge`);
      const val = color === 'white' ? whiteFide : blackFide;
      if (badge) badge.classList.toggle('hidden', val.length === 0);
    });
  }

  async function saveGame() {
    const btn = document.getElementById('btn-save');
    btn.disabled = true;
    btn.textContent = 'Сохранение...';

    const payload = {
      white_name: document.getElementById('white-name')?.value?.trim() || '',
      white_fide_id: document.getElementById('white-fide-id')?.value?.trim(),
      black_name: document.getElementById('black-name')?.value?.trim() || '',
      black_fide_id: document.getElementById('black-fide-id')?.value?.trim(),
      tournament: document.getElementById('meta-tournament')?.value?.trim() || '',
      round: document.getElementById('meta-round')?.value?.trim() || '',
      board_number: document.getElementById('meta-board')?.value?.trim() || '',
      location: document.getElementById('meta-location')?.value?.trim() || '',
      game_date: document.getElementById('meta-date')?.value || null,
      result: document.getElementById('meta-result')?.value || '*',
      pgn: document.getElementById('pgn-output')?.value?.trim(),
      raw_moves: state.processedMoves,
      ocr_confidence: state.ocrResult ? null : null,
      has_errors: state.processedMoves.some(m => (!m.whiteValid && m.white && m.white !== '?') || (!m.blackValid && m.black && m.black !== '?')),
      scan_url: state.scan_url
    };

    try {
      const method = state.editGameId ? 'PATCH' : 'POST';
      const url = state.editGameId ? `/api/games/${state.editGameId}` : '/api/games';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Save failed');

      const feedback = document.getElementById('save-feedback');
      if (feedback) {
        feedback.className = 'save-feedback success';
        feedback.textContent = `✓ Партия сохранена в базу данных (ID: ${result.game.id.slice(0, 8)}...)`;
        feedback.classList.remove('hidden');
      }

      btn.textContent = '✓ Сохранено!';
      btn.disabled = true;
      showToast('Партия успешно сохранена!', 'success');
      
      // Re-enable after delay
      setTimeout(() => {
        btn.textContent = state.editGameId ? '💾 Обновить изменения' : '💾 Сохранить в базу данных';
        btn.disabled = false;
      }, 3000);

    } catch (err) {
      console.error('Save error:', err);
      btn.textContent = '💾 Сохранить в базу данных';
      btn.disabled = false;

      const feedback = document.getElementById('save-feedback');
      if (feedback) {
        feedback.className = 'save-feedback error';
        feedback.textContent = '✗ Ошибка сохранения: ' + err.message;
        feedback.classList.remove('hidden');
      }
      showToast('Ошибка сохранения: ' + err.message, 'error');
    }
  }

  // ─── PGN Actions ──────────────────────────────────────────────────
  function setupPGNActions() {
    document.getElementById('btn-copy-pgn')?.addEventListener('click', () => {
      const pgn = document.getElementById('pgn-output')?.value;
      if (pgn) {
        navigator.clipboard.writeText(pgn).then(() => showToast('PGN скопирован!', 'success'));
      }
    });

    document.getElementById('btn-download-pgn')?.addEventListener('click', () => {
      const pgn = document.getElementById('pgn-output')?.value;
      if (pgn) {
        const white = document.getElementById('white-name')?.value || 'White';
        const black = document.getElementById('black-name')?.value || 'Black';
        PGNExporter.downloadPGN(pgn, `${white}_vs_${black}.pgn`);
      }
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────
  function buildMetaFromOCR(ocr) {
    return {
      whiteName: ocr.white_name || '',
      whiteFideId: document.getElementById('white-fide-id')?.value || '',
      blackName: ocr.black_name || '',
      blackFideId: document.getElementById('black-fide-id')?.value || '',
      tournament: ocr.tournament || '',
      round: ocr.round || '',
      board: ocr.board_number || '',
      date: ocr.game_date || '',
      location: ocr.location || '',
      result: ocr.result || '*',
    };
  }

  function showScreen(name) {
    ['upload', 'processing', 'review', 'import'].forEach(s => {
      const el = document.getElementById(`screen-${s}`);
      if (el) el.classList.toggle('hidden', s !== name);
    });
    
    // Update nav active state
    ['upload', 'import', 'database'].forEach(s => {
      const navEl = document.getElementById(`nav-${s}`);
      if (navEl) navEl.classList.toggle('active', s === name);
    });
    
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ─── Import Games ──────────────────────────────────────────────────
  function setupImportGames() {
    const navUpload = document.getElementById('nav-upload');
    const navImport = document.getElementById('nav-import');
    
    if (navUpload) navUpload.addEventListener('click', (e) => {
      e.preventDefault();
      showScreen('upload');
    });
    
    if (navImport) navImport.addEventListener('click', (e) => {
      e.preventDefault();
      showScreen('import');
    });

    const sourceSelect = document.getElementById('import-source');
    const urlGroup = document.getElementById('import-url-group');
    const fileGroup = document.getElementById('import-file-group');

    if (sourceSelect) {
      sourceSelect.addEventListener('change', (e) => {
        if (e.target.value === 'lichess') {
          urlGroup.classList.remove('hidden');
          fileGroup.classList.add('hidden');
        } else {
          urlGroup.classList.add('hidden');
          fileGroup.classList.remove('hidden');
        }
      });
    }

    const btnSubmit = document.getElementById('btn-import-submit');
    if (btnSubmit) {
      btnSubmit.addEventListener('click', async () => {
        const fideId = document.getElementById('import-fide-id').value.trim();
        const source = document.getElementById('import-source').value;
        const url = document.getElementById('import-url').value.trim();
        const fileInput = document.getElementById('import-file');
        const pgnText = document.getElementById('import-pgn-text').value.trim();
        const note = document.getElementById('import-note');

        btnSubmit.disabled = true;
        btnSubmit.querySelector('.btn-text').textContent = 'Импорт...';
        btnSubmit.querySelector('.btn-spinner').classList.remove('hidden');
        note.textContent = '';
        note.style.color = 'var(--text-dim)';

        try {
          const formData = new FormData();
          formData.append('target_fide_id', fideId);
          formData.append('source', source);
          
          if (source === 'lichess') {
            if (!url) throw new Error('Пожалуйста, введите URL трансляции Lichess');
            formData.append('url', url);
          } else {
            if (fileInput.files.length > 0) {
              formData.append('pgn_file', fileInput.files[0]);
            } else if (pgnText) {
              formData.append('pgn_text', pgnText);
            } else {
              throw new Error('Пожалуйста, выберите файл или вставьте PGN');
            }
          }

          const response = await fetch('/api/games/import', {
            method: 'POST',
            body: formData
          });

          const data = await response.json();
          if (!response.ok) throw new Error(data.error || 'Ошибка импорта');

          note.textContent = `Успешно импортировано партий: ${data.count}.`;
          note.style.color = 'var(--accent-green)';
          showToast(`Импортировано партий: ${data.count}`, 'success');
          
          // Clear inputs
          document.getElementById('import-url').value = '';
          document.getElementById('import-pgn-text').value = '';
          if (fileInput) fileInput.value = '';

        } catch (err) {
          note.textContent = `Ошибка: ${err.message}`;
          note.style.color = 'var(--error)';
        } finally {
          btnSubmit.disabled = false;
          btnSubmit.querySelector('.btn-text').textContent = 'Импортировать';
          btnSubmit.querySelector('.btn-spinner').classList.add('hidden');
        }
      });
    }
  }

  function showToast(message, type = 'info') {
    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  return { init };
})();

// Start app when DOM is ready
document.addEventListener('DOMContentLoaded', () => App.init());
