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
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

  const { playerId, displayName, score, level } = body;

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

  const now = Date.now();
  const oneMinuteAgo = now - 60 * 1000;

  // Rate limit: max 3 submissions per playerId per minute
  const rateCheck = await env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM scores WHERE player_id = ? AND created_at > ?'
  ).bind(playerId, oneMinuteAgo).first();

  if (rateCheck && rateCheck.cnt >= 3) {
    return json({ error: 'Rate limit exceeded. Please wait before submitting again.' }, 429);
  }

  await env.DB.prepare(
    'INSERT INTO scores (player_id, display_name, score, level, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(playerId, displayName.slice(0, 30), score, level, now).run();

  return json({ ok: true });
}

async function handleGetLeaderboard(url, env) {
  const type = url.searchParams.get('type') === 'weekly' ? 'weekly' : 'alltime';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 100);

  let result;

  if (type === 'weekly') {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    result = await env.DB.prepare(
      `SELECT player_id, display_name, MAX(score) AS score, MAX(level) AS level
       FROM scores
       WHERE created_at >= ?
       GROUP BY player_id
       ORDER BY score DESC
       LIMIT ?`
    ).bind(weekAgo, limit).all();
  } else {
    result = await env.DB.prepare(
      `SELECT player_id, display_name, MAX(score) AS score, MAX(level) AS level
       FROM scores
       GROUP BY player_id
       ORDER BY score DESC
       LIMIT ?`
    ).bind(limit).all();
  }

  return json({ ok: true, entries: result.results || [] });
}
