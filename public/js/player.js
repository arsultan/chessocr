/**
 * player.js — ChessOCR Player Profile logic
 */

document.addEventListener('DOMContentLoaded', async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const fideId = urlParams.get('id');

  if (!fideId) {
    document.getElementById('profile-container').innerHTML = `
      <div class="db-empty">
        <div class="db-empty-icon">⚠</div>
        <p>Не указан FIDE ID игрока.</p>
      </div>`;
    return;
  }

  loadProfile(fideId);
  loadGames(fideId);
  initModal();
});

function initModal() {
  document.getElementById('modal-close')?.addEventListener('click', () => {
    document.getElementById('game-modal-overlay').classList.add('hidden');
  });
  document.getElementById('game-modal-overlay')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
  });
}

async function loadProfile(fideId) {
  const container = document.getElementById('profile-container');
  try {
    const res = await fetch(`https://api.chesstools.org/fide/${fideId}`, {
      headers: { 'accept': 'application/json' }
    });
    if (!res.ok) throw new Error('Player not found in FIDE database');
    const data = await res.json();
    
    renderProfile(data);
  } catch (err) {
    console.error('FIDE API Error:', err);
    container.innerHTML = `
      <div class="profile-header" style="justify-content: center; text-align: center; color: var(--error);">
        ⚠ Не удалось загрузить данные FIDE для ID ${fideId}.
      </div>`;
  }
}

function renderProfile(player) {
  const container = document.getElementById('profile-container');
  
  // Parse name correctly if it's stored as "Lastname, Firstname"
  let displayName = player.name;
  if (displayName && displayName.includes(',')) {
    const parts = displayName.split(',');
    displayName = `${parts[1].trim()} ${parts[0].trim()}`;
  }

  const titleBadge = player.title ? `<span class="badge badge--required" style="font-size: 14px;">${player.title}</span>` : '';
  const countryFlag = player.country ? `<span style="color: var(--text-muted); font-size: 16px;">[${player.country}]</span>` : '';

  container.innerHTML = `
    <div class="profile-header fade-in">
      <div class="profile-avatar">
        ${player.title ? '♛' : '♟'}
      </div>
      <div class="profile-info">
        <div class="profile-title-row">
          <h1 class="profile-name">${displayName || 'Неизвестный игрок'}</h1>
          ${titleBadge}
          ${countryFlag}
        </div>
        <span class="profile-fide-id">FIDE ID: ${player.fideid}</span>
        
        <div class="profile-stats">
          <div class="stat-item">
            <span class="stat-label">Рейтинг (STD)</span>
            <span class="stat-value highlight">${player.rating || 'N/A'}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Год рождения</span>
            <span class="stat-value">${player.birth_year || 'N/A'}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Пол</span>
            <span class="stat-value">${player.sex === 'F' ? 'Женский' : 'Мужской'}</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

async function loadGames(fideId) {
  const container = document.getElementById('games-container');
  const loading = document.getElementById('games-loading');
  const empty = document.getElementById('games-empty');

  loading.classList.remove('hidden');
  empty.classList.add('hidden');
  container.innerHTML = '';

  try {
    const res = await fetch(`/api/games?fide_id=${fideId}`);
    if (!res.ok) throw new Error('Failed to fetch games');
    const data = await res.json();
    
    loading.classList.add('hidden');

    if (!data.games || data.games.length === 0) {
      empty.classList.remove('hidden');
      return;
    }

    data.games.forEach(game => renderGameRow(game, container));
  } catch (err) {
    console.error('Games fetch error:', err);
    loading.classList.add('hidden');
    container.innerHTML = `<p style="color: var(--error)">Ошибка загрузки партий: ${err.message}</p>`;
  }
}

function renderGameRow(game, container) {
  const row = document.createElement('div');
  row.className = 'game-row fade-in';
  row.onclick = () => openGame(game.id);
  
  // Format Date
  let dateStr = 'Нет даты';
  if (game.game_date) {
    const d = new Date(game.game_date);
    dateStr = d.toLocaleDateString('ru-RU');
  }

  const resultColor = game.result === '1-0' ? 'var(--text-primary)' : game.result === '0-1' ? 'var(--text-primary)' : 'var(--gold)';

  row.innerHTML = `
    <div>
      <div class="game-players">
        <a href="/player.html?id=${game.white_fide_id}" onclick="event.stopPropagation()" class="hover-gold" style="color: inherit;">♔ ${game.white_name || game.white_fide_id}</a> 
        <span style="color: var(--text-muted); margin: 0 8px;">vs</span> 
        <a href="/player.html?id=${game.black_fide_id}" onclick="event.stopPropagation()" class="hover-gold" style="color: inherit;">♚ ${game.black_name || game.black_fide_id}</a>
      </div>
      <div class="game-meta" style="margin-top: 4px;">
        ${game.tournament ? '🏆 ' + game.tournament : ''} 
        ${game.round ? ' • Тур ' + game.round : ''}
      </div>
    </div>
    <div class="game-meta">
      <div>📅 ${dateStr}</div>
      ${game.location ? '<div>📍 ' + game.location + '</div>' : ''}
    </div>
    <div class="game-result" style="color: ${resultColor}">
      ${game.result}
    </div>
    <div class="game-errors">
      ${game.has_errors ? '<span class="badge badge--error" title="Есть ошибки OCR">⚠</span>' : '<span class="badge badge--success">✓</span>'}
    </div>
  `;

  container.appendChild(row);
}

async function openGame(id) {
  const overlay = document.getElementById('game-modal-overlay');
  const body = document.getElementById('modal-body');
  const title = document.getElementById('modal-title');
  overlay.classList.remove('hidden');
  body.innerHTML = '<p style="color: var(--text-muted)">Загрузка...</p>';

  try {
    const res = await fetch('/api/games/' + id);
    const g = await res.json();

    title.textContent = `${g.white_name || '?'} vs ${g.black_name || '?'}`;
    body.innerHTML = `
      <div class="meta-details">
        <div class="meta-detail"><span class="label">Белые</span><span class="value">${g.white_name || '—'} (${g.white_fide_id})</span></div>
        <div class="meta-detail"><span class="label">Чёрные</span><span class="value">${g.black_name || '—'} (${g.black_fide_id})</span></div>
        <div class="meta-detail"><span class="label">Турнир</span><span class="value">${g.tournament || '—'}</span></div>
        <div class="meta-detail"><span class="label">Дата</span><span class="value">${g.game_date ? new Date(g.game_date).toLocaleDateString('ru-RU') : '—'}</span></div>
        <div class="meta-detail"><span class="label">Тур / Стол</span><span class="value">${g.round || '?'} / ${g.board_number || '?'}</span></div>
        <div class="meta-detail"><span class="label">Результат</span><span class="value" style="color: var(--gold); font-size: 18px;">${g.result || '*'}</span></div>
        <div class="meta-detail"><span class="label">Локация</span><span class="value">${g.location || '—'}</span></div>
        <div class="meta-detail"><span class="label">Добавлено</span><span class="value">${new Date(g.created_at).toLocaleString('ru-RU')}</span></div>
      </div>
      <div style="margin-bottom: 12px; display: flex; gap: 8px;">
        <a href="/index.html?edit=${g.id}" class="btn btn--primary btn--sm">Редактировать</a>
        <button class="btn btn--secondary btn--sm" onclick="navigator.clipboard.writeText(document.getElementById('pgn-modal-text').textContent)">Копировать PGN</button>
        <a href="https://lichess.org/paste?pgn=${encodeURIComponent(g.pgn)}" target="_blank" class="btn btn--ghost btn--sm">Открыть в Lichess ↗</a>
      </div>
      <div class="pgn-modal" id="pgn-modal-text">${escapeHtml(g.pgn)}</div>
      ${g.has_errors ? '<p style="color: var(--warning); font-size: 13px; margin-top: 12px;">⚠ Партия содержит нераспознанные или нелегальные ходы</p>' : ''}
    `;
  } catch (err) {
    body.innerHTML = `<p style="color: var(--error)">Ошибка: ${err.message}</p>`;
  }
}

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
