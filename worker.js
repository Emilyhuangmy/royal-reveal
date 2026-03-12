export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      return handleAPI(request, url, env);
    }

    return env.ASSETS.fetch(request);
  }
};

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS_HEADERS });
}

async function handleAPI(request, url, env) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  try {
    if (url.pathname === '/api/scores' && request.method === 'POST') {
      return handlePostScore(request, env);
    }
    if (url.pathname === '/api/leaderboard' && request.method === 'GET') {
      return handleGetLeaderboard(url, env);
    }
    if (url.pathname === '/api/stats/today' && request.method === 'GET') {
      return handleGetTodayCount(request, env);
    }
    if (url.pathname === '/api/profile' && request.method === 'PUT') {
      return handlePutProfile(request, env);
    }
    return json({ error: 'Not found' }, 404);
  } catch (e) {
    console.error(e);
    return json({ error: 'Internal server error' }, 500);
  }
}

async function handlePostScore(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const { playerId, displayName, avatar, country, score, level } = body;

  if (
    typeof playerId !== 'string' || !playerId ||
    typeof displayName !== 'string' || !displayName ||
    typeof score !== 'number' ||
    typeof level !== 'number'
  ) {
    return json({ error: 'Missing or invalid fields' }, 400);
  }

  if (score < 0 || score > 999999 || level < 1 || level > 10) {
    return json({ error: 'Score or level out of range' }, 400);
  }

  const avatarVal = typeof avatar === 'string' && avatar.length <= 2097152 ? avatar : null;
  const countryVal = typeof country === 'string' && /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : null;

  const now = Date.now();
  const oneMinuteAgo = now - 60 * 1000;

  // Rate limit: max 3 submissions per playerId per minute
  const rateCheck = await env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM scores WHERE player_id = ? AND created_at > ?'
  ).bind(playerId, oneMinuteAgo).first();

  if (rateCheck && rateCheck.cnt >= 3) {
    return json({ error: 'Rate limit exceeded. Please wait before submitting again.' }, 429);
  }

  try {
    await env.DB.prepare(
      'INSERT INTO scores (player_id, display_name, avatar, country, score, level, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(playerId, displayName.slice(0, 30), avatarVal, countryVal, score, level, now).run();
  } catch (e) {
    await env.DB.prepare(
      'INSERT INTO scores (player_id, display_name, score, level, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(playerId, displayName.slice(0, 30), score, level, now).run();
  }

  await upsertProfile(env, playerId, displayName.slice(0, 30), avatarVal, countryVal, now);
  return json({ ok: true });
}

async function upsertProfile(env, playerId, displayName, avatar, country, updatedAt) {
  try {
    await env.DB.prepare(
      `INSERT INTO profiles (player_id, display_name, avatar, country, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(player_id) DO UPDATE SET display_name = excluded.display_name, avatar = excluded.avatar, country = excluded.country, updated_at = excluded.updated_at`
    ).bind(playerId, displayName, avatar, country, updatedAt).run();
  } catch (_) {}
}

async function handlePutProfile(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const { playerId, displayName, avatar, country } = body;

  if (typeof playerId !== 'string' || !playerId || typeof displayName !== 'string' || !displayName) {
    return json({ error: 'Missing or invalid playerId / displayName' }, 400);
  }

  const avatarVal = typeof avatar === 'string' && avatar.length <= 2097152 ? avatar : null;
  const countryVal = typeof country === 'string' && /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : null;
  const now = Date.now();

  await upsertProfile(env, playerId, displayName.slice(0, 30), avatarVal, countryVal, now);
  return json({ ok: true });
}

function startOfTodayUTC() {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

async function handleGetTodayCount(request, env) {
  const url = new URL(request.url);
  const playerId = url.searchParams.get('playerId') || '';
  const todayStart = startOfTodayUTC();

  const row = await env.DB.prepare(
    'SELECT COUNT(DISTINCT player_id) AS cnt FROM scores WHERE created_at >= ?'
  ).bind(todayStart).first();
  const count = (row && row.cnt != null) ? Number(row.cnt) : 0;

  let playerRank = null;
  if (playerId) {
    const rankRow = await env.DB.prepare(
      `WITH first_today AS (
        SELECT player_id, MIN(created_at) AS first_at
        FROM scores WHERE created_at >= ? GROUP BY player_id
       )
       SELECT (SELECT COUNT(*) FROM first_today f2 WHERE f2.first_at < f1.first_at) + 1 AS rn
       FROM first_today f1 WHERE f1.player_id = ?`
    ).bind(todayStart, playerId).first();
    if (rankRow && rankRow.rn != null) playerRank = Number(rankRow.rn);
  }

  return json({ ok: true, count, playerRank });
}

async function handleGetLeaderboard(url, env) {
  const typeParam = url.searchParams.get('type');
  const type = typeParam === 'daily' ? 'daily' : typeParam === 'weekly' ? 'weekly' : 'alltime';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 100);

  let entries = [];

  try {
    const withProfile = (inner) =>
      `WITH ranked AS (${inner}),
        best AS (SELECT player_id, display_name, avatar, country, score, level FROM ranked WHERE rn = 1)
       SELECT best.player_id,
              COALESCE(p.display_name, best.display_name) AS display_name,
              COALESCE(p.avatar, best.avatar) AS avatar,
              COALESCE(p.country, best.country) AS country,
              best.score, best.level
       FROM best LEFT JOIN profiles p ON best.player_id = p.player_id ORDER BY best.score DESC LIMIT ?`;

    if (type === 'daily') {
      const todayStart = startOfTodayUTC();
      const result = await env.DB.prepare(
        withProfile(
          `SELECT player_id, display_name, avatar, country, score, level,
                  ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY score DESC, created_at DESC) AS rn
           FROM scores WHERE created_at >= ?`
        )
      ).bind(todayStart, limit).all();
      entries = result.results || [];
    } else if (type === 'weekly') {
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const result = await env.DB.prepare(
        withProfile(
          `SELECT player_id, display_name, avatar, country, score, level,
                  ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY score DESC, created_at DESC) AS rn
           FROM scores WHERE created_at >= ?`
        )
      ).bind(weekAgo, limit).all();
      entries = result.results || [];
    } else {
      const result = await env.DB.prepare(
        withProfile(
          `SELECT player_id, display_name, avatar, country, score, level,
                  ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY score DESC, created_at DESC) AS rn
           FROM scores`
        )
      ).bind(limit).all();
      entries = result.results || [];
    }
  } catch (e) {
    entries = await getLeaderboardFallback(env, type, limit);
  }

  let total = 0;
  try {
    if (type === 'daily') {
      const todayStart = startOfTodayUTC();
      const row = await env.DB.prepare('SELECT COUNT(DISTINCT player_id) AS total FROM scores WHERE created_at >= ?').bind(todayStart).first();
      total = (row && row.total != null) ? Number(row.total) : 0;
    } else if (type === 'weekly') {
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const row = await env.DB.prepare('SELECT COUNT(DISTINCT player_id) AS total FROM scores WHERE created_at >= ?').bind(weekAgo).first();
      total = (row && row.total != null) ? Number(row.total) : 0;
    } else {
      const row = await env.DB.prepare('SELECT COUNT(DISTINCT player_id) AS total FROM scores').first();
      total = (row && row.total != null) ? Number(row.total) : 0;
    }
  } catch (_) {}

  return json({ ok: true, entries, total });
}

async function getLeaderboardFallback(env, type, limit) {
  let result;
  if (type === 'daily') {
    const todayStart = startOfTodayUTC();
    result = await env.DB.prepare(
      `SELECT player_id, display_name, MAX(score) AS score, MAX(level) AS level
       FROM scores WHERE created_at >= ? GROUP BY player_id ORDER BY score DESC LIMIT ?`
    ).bind(todayStart, limit).all();
  } else if (type === 'weekly') {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    result = await env.DB.prepare(
      `SELECT player_id, display_name, MAX(score) AS score, MAX(level) AS level
       FROM scores WHERE created_at >= ? GROUP BY player_id ORDER BY score DESC LIMIT ?`
    ).bind(weekAgo, limit).all();
  } else {
    result = await env.DB.prepare(
      `SELECT player_id, display_name, MAX(score) AS score, MAX(level) AS level
       FROM scores GROUP BY player_id ORDER BY score DESC LIMIT ?`
    ).bind(limit).all();
  }
  const rows = result.results || [];
  return rows.map(r => ({ ...r, avatar: null, country: null }));
}
