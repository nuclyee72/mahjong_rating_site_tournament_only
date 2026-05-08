// ===== 공통 상수 =====
const API_BASE = "";
const START_SCORE = (window.GAME_CONFIG && window.GAME_CONFIG.start_score) ? Number(window.GAME_CONFIG.start_score) : 25000;
const RETURN_SCORE = (window.GAME_CONFIG && window.GAME_CONFIG.return_score) ? Number(window.GAME_CONFIG.return_score) : 30000;
const UMA_VALUES = (window.GAME_CONFIG && window.GAME_CONFIG.uma) ? window.GAME_CONFIG.uma : [15, 5, -5, -15];
const OKA_TO_1ST = (window.GAME_CONFIG && window.GAME_CONFIG.oka !== undefined) ? Number(window.GAME_CONFIG.oka) : 20;

let TOURNAMENT_GAMES = [];

// ======================= 유틸리티 함수 =======================

function calcPts(scores) {
  const order = scores
    .map((s, i) => ({ s, i }))
    .sort((a, b) => b.s - a.s)
    .map((o) => o.i);

  const uma = [0, 0, 0, 0];
  order.forEach((idx, rank) => {
    uma[idx] = UMA_VALUES[rank] + (rank === 0 ? OKA_TO_1ST : 0);
  });

  return scores.map((s, i) => {
    const base = (s - RETURN_SCORE) / 1000.0;
    return +(base + uma[i]).toFixed(1);
  });
}

function formatKoreanTime(isoString) {
  if (!isoString) return "";
  const parts = isoString.split(/[T ]/);
  if (parts.length < 2) return isoString;

  const [datePart, timePart] = parts;
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);

  if ([year, month, day, hour, minute].some(Number.isNaN)) return isoString;

  const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const kstDate = new Date(utcDate.getTime() + 9 * 60 * 60 * 1000);

  const y = kstDate.getUTCFullYear();
  const m = String(kstDate.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kstDate.getUTCDate()).padStart(2, "0");
  const hh = String(kstDate.getUTCHours()).padStart(2, "0");
  const mm = String(kstDate.getUTCMinutes()).padStart(2, "0");

  return `${y}-${m}-${d} ${hh}:${mm}`;
}

function createRankDistBar(rankCounts, games) {
  const total = games || 1;
  const bar = document.createElement("div");
  bar.className = "rank-dist-bar";

  for (let i = 0; i < 4; i++) {
    const count = rankCounts[i] || 0;
    const percentage = total > 0 ? (count * 100) / total : 0;

    const seg = document.createElement("div");
    seg.className = `rank-seg rank-seg${i + 1}`;
    seg.style.width = percentage.toFixed(1) + "%";

    const span = document.createElement("span");
    if (percentage >= 12) {
      span.textContent = `${percentage.toFixed(0)}%`;
    } else {
      span.textContent = "";
    }
    seg.title = `${i + 1}등: ${count}회 (${percentage.toFixed(1)}%)`;

    seg.appendChild(span);
    bar.appendChild(seg);
  }
  return bar;
}

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const d = await res.json();
      if (d && d.error) msg += ` - ${d.error}`;
    } catch (_) { }
    throw new Error(msg);
  }
  try {
    return await res.json();
  } catch (_) {
    return null;
  }
}

function sortPlayersByState(list, sortState) {
  const key = sortState.key;
  const dir = sortState.dir === "desc" ? -1 : 1;

  const arr = [...(list || [])];
  arr.sort((a, b) => {
    const av = Number(a[key] ?? 0);
    const bv = Number(b[key] ?? 0);
    if (av === bv) return String(a.name).localeCompare(String(b.name), "ko");
    return (av - bv) * dir;
  });
  return arr;
}

// ======================= 공통 렌더링 함수 =======================

function renderGameList(tbodyId, games, options = {}) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;

  tbody.innerHTML = "";
  if (!games || games.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="ranking-placeholder">기록 없음</td></tr>';
    return;
  }

  games.forEach((g, index) => {
    const scores = [
      Number(g.player1_score), Number(g.player2_score),
      Number(g.player3_score), Number(g.player4_score),
    ];
    const names = [
      g.player1_name, g.player2_name,
      g.player3_name, g.player4_name,
    ].map((n) => (n || "").trim());

    const pts = calcPts(scores);

    const order = scores.map((s, i) => ({ s, i })).sort((a, b) => b.s - a.s);
    const ranks = [0, 0, 0, 0];
    order.forEach((o, idx) => (ranks[o.i] = idx + 1));

    const tr = document.createElement("tr");

    const displayId = options.useIndexNumbering ? (index + 1) : (g.id || "");
    tr.innerHTML = `
      <td>${displayId}</td>
      <td>${formatKoreanTime(g.created_at)}</td>
      <td></td><td></td><td></td><td></td>
      <td></td>
    `;

    for (let i = 0; i < 4; i++) {
      const td = tr.children[2 + i];
      const name = names[i] || "";
      const score = scores[i];
      const pt = pts[i];

      td.innerHTML = `<strong>${name}</strong><br>${score} (${pt})`;
      if (ranks[i] === 1) td.classList.add("winner-cell");
    }

    const tdDel = tr.children[6];
    if (options.onDelete) {
      const btn = document.createElement("button");
      btn.textContent = "삭제";
      btn.addEventListener("click", () => options.onDelete(g.id));
      tdDel.appendChild(btn);
    }

    tbody.appendChild(tr);
  });
}

function calculateStatsFromGames(games) {
  const playerStats = {};

  games.forEach((g) => {
    const scores = [
      Number(g.player1_score), Number(g.player2_score),
      Number(g.player3_score), Number(g.player4_score),
    ];
    const names = [
      g.player1_name, g.player2_name,
      g.player3_name, g.player4_name,
    ].map((n) => (n || "").trim());

    const pts = calcPts(scores);

    const order = scores.map((s, i) => ({ s, i })).sort((a, b) => b.s - a.s);
    const ranks = [0, 0, 0, 0];
    order.forEach((o, idx) => (ranks[o.i] = idx + 1));

    for (let i = 0; i < 4; i++) {
      const name = names[i];
      if (!name) continue;
      if (!playerStats[name]) {
        playerStats[name] = { games: 0, total_pt: 0, rankCounts: [0, 0, 0, 0] };
      }
      playerStats[name].games += 1;
      playerStats[name].total_pt += pts[i];
      playerStats[name].rankCounts[ranks[i] - 1] += 1;
    }
  });

  return Object.entries(playerStats).map(([name, st]) => {
    const games = st.games;
    const total_pt_raw = st.total_pt;
    const total_pt = +total_pt_raw.toFixed(1);
    const avg_pt = games > 0 ? total_pt_raw / games : 0;
    const c1 = st.rankCounts[0];
    const c2 = st.rankCounts[1];
    const yonde = games > 0 ? ((c1 + c2) * 100) / games : 0;

    return {
      name,
      games,
      total_pt,
      avg_pt: +avg_pt.toFixed(1),
      yonde_rate: +yonde.toFixed(1),
      rankCounts: st.rankCounts,
    };
  });
}

function renderRankingTable(tbodyId, players, sortState, tableIdForIndicators, emptyMsg = "통계 없음") {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;

  const sorted = sortPlayersByState(players, sortState);

  tbody.innerHTML = "";
  if (!sorted.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="ranking-placeholder">${emptyMsg}</td></tr>`;
    return;
  }

  sorted.forEach((p, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td>${p.name}</td>
      <td>${p.games}</td>
      <td>${Number(p.total_pt).toFixed(1)}</td>
      <td>${Number(p.avg_pt).toFixed(1)}</td>
      <td>${Number(p.yonde_rate).toFixed(1)}%</td>
      <td></td>
    `;
    tr.children[6].appendChild(createRankDistBar(p.rankCounts, p.games));
    tbody.appendChild(tr);
  });
}


// ======================= 대회 전용 메인 로직 =======================

function setupTournamentForm() {
  const form = document.getElementById("tournament-game-form");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const p1 = (fd.get("player1_name") || "").trim();
    const p2 = (fd.get("player2_name") || "").trim();
    const p3 = (fd.get("player3_name") || "").trim();
    const p4 = (fd.get("player4_name") || "").trim();
    const s1 = parseInt(fd.get("player1_score"), 10);
    const s2 = parseInt(fd.get("player2_score"), 10);
    const s3 = parseInt(fd.get("player3_score"), 10);
    const s4 = parseInt(fd.get("player4_score"), 10);

    if ([s1, s2, s3, s4].some(Number.isNaN)) return alert("pt는 숫자여야 합니다.");
    const targetSum = START_SCORE * 4;
    if (s1 + s2 + s3 + s4 !== targetSum) return alert(`합 ${targetSum}이(가) 아닙니다. (현재: ${s1 + s2 + s3 + s4})`);

    const payload = {
      player1_name: p1, player2_name: p2, player3_name: p3, player4_name: p4,
      player1_score: s1, player2_score: s2, player3_score: s3, player4_score: s4,
    };

    try {
      await fetchJSON(`${API_BASE}/api/tournament_games`, { method: "POST", body: JSON.stringify(payload) });
      form.reset();
      await loadTournamentGamesAndRanking();
    } catch (err) {
      console.error(err);
      alert("저장 실패: " + err.message);
    }
  });
}

async function loadTournamentGamesAndRanking() {
  let games = [];
  try {
    games = await fetchJSON(`${API_BASE}/api/tournament_games`);
  } catch (err) {
    console.error(err);
    return;
  }
  games = (games || []).slice().sort((a, b) => (b.id || 0) - (a.id || 0));
  TOURNAMENT_GAMES = games;

  renderGameList("tournament-games-tbody", games, {
    onDelete: (id) => {
      showConfirm("이 대회 대국을 삭제할까요?", async () => {
        try {
          await fetchJSON(`${API_BASE}/api/tournament_games/${id}`, { method: "DELETE" });
          await loadTournamentGamesAndRanking();
        } catch (e) { console.error(e); alert("삭제 실패"); }
      });
    }
  });

  const players = calculateStatsFromGames(games);
  renderRankingTable("tournament-ranking-tbody", players, { key: "total_pt", dir: "desc" }, null);
}

// ======================= 앱 초기화 =======================

document.addEventListener("DOMContentLoaded", () => {
  setupTournamentForm();
  loadTournamentGamesAndRanking();
  setupMobileSwipe();
});

// ======================= 모바일 풀스크린 패널 슬라이드 =======================

function setupMobileSwipe() {
  if (window.innerWidth > 700) return;

  document.querySelectorAll('.view').forEach(view => {
    const layout = view.querySelector('.main-layout');
    if (!layout) return;

    if (layout.dataset.mobileInit === '1') return;
    layout.dataset.mobileInit = '1';

    const leftPanel = layout.querySelector('.left-panel');
    const rightPanel = layout.querySelector('.right-panel');
    if (!leftPanel || !rightPanel) return;

    const tabs = document.createElement('div');
    tabs.className = 'mobile-panel-tabs';
    tabs.innerHTML =
      '<div class="mobile-panel-tab active" data-idx="0"></div>' +
      '<div class="mobile-panel-tab"         data-idx="1"></div>';
    layout.insertBefore(tabs, layout.firstChild);

    const track = document.createElement('div');
    track.className = 'mobile-track';
    track.appendChild(leftPanel);
    track.appendChild(rightPanel);
    layout.appendChild(track);

    let currentIdx = 0;

    function goTo(idx) {
      currentIdx = idx;
      track.style.transform = 'translateX(-' + (idx * 100) + '%)';
      tabs.querySelectorAll('.mobile-panel-tab').forEach((t, i) => {
        t.classList.toggle('active', i === idx);
      });
    }

    tabs.querySelectorAll('.mobile-panel-tab').forEach((tab, i) => {
      tab.addEventListener('click', () => goTo(i));
    });

    let touchStartX = 0, touchStartY = 0;

    layout.addEventListener('touchstart', e => {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }, { passive: true });

    layout.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - touchStartX;
      const dy = e.changedTouches[0].clientY - touchStartY;
      if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
      if (dx < 0) goTo(Math.min(currentIdx + 1, 1));
      else goTo(Math.max(currentIdx - 1, 0));
    }, { passive: true });

    goTo(0);
  });
}
