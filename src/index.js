import { QUESTIONS } from './questions.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

async function userId(request, ctx) {
  if (ctx?.access) {
    const identity = await ctx.access.getIdentity();
    if (identity?.email) return identity.email;
  }
  return request.headers.get('Cf-Access-Authenticated-User-Email') || 'owner';
}

async function bodyOf(request) {
  try { return await request.json(); } catch { return null; }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    const user = await userId(request, ctx);

    try {
      if (request.method === 'GET' && url.pathname === '/api/questions') {
        return json({ questions: QUESTIONS });
      }

      if (request.method === 'GET' && url.pathname === '/api/progress') {
        const { results } = await env.DB.prepare(
          'SELECT question_nr, mastered, correct_count, wrong_count, last_answer, updated_at FROM progress WHERE user_id = ?'
        ).bind(user).all();
        return json({ user, progress: results });
      }

      if (request.method === 'POST' && url.pathname === '/api/progress') {
        const body = await bodyOf(request);
        const nr = Number(body?.questionNr);
        const mastered = body?.mastered === true ? 1 : 0;
        if (!QUESTIONS.some(q => q.nr === nr)) return json({ error: 'Nieznany numer pytania.' }, 400);
        await env.DB.prepare(`
          INSERT INTO progress (user_id, question_nr, mastered, updated_at)
          VALUES (?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(user_id, question_nr) DO UPDATE SET
            mastered = excluded.mastered,
            updated_at = CURRENT_TIMESTAMP
        `).bind(user, nr, mastered).run();
        return json({ ok: true, questionNr: nr, mastered: Boolean(mastered) });
      }

      if (request.method === 'POST' && url.pathname === '/api/answer') {
        const body = await bodyOf(request);
        const nr = Number(body?.questionNr);
        const answer = String(body?.answer || '').toUpperCase();
        const question = QUESTIONS.find(q => q.nr === nr);
        if (!question || !['A', 'B', 'C'].includes(answer)) return json({ error: 'Nieprawidłowa odpowiedź.' }, 400);
        const correct = answer === question.poprawna;
        await env.DB.prepare(`
          INSERT INTO progress (user_id, question_nr, correct_count, wrong_count, last_answer, updated_at)
          VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(user_id, question_nr) DO UPDATE SET
            correct_count = correct_count + excluded.correct_count,
            wrong_count = wrong_count + excluded.wrong_count,
            last_answer = excluded.last_answer,
            updated_at = CURRENT_TIMESTAMP
        `).bind(user, nr, correct ? 1 : 0, correct ? 0 : 1, answer).run();
        return json({ ok: true, correct, correctAnswer: question.poprawna });
      }

      return json({ error: 'Nie znaleziono.' }, 404);
    } catch (error) {
      console.error(error);
      return json({ error: 'Błąd bazy danych lub konfiguracji aplikacji.' }, 500);
    }
  }
};
