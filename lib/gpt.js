// GPT 교차 검증 — OpenAI Responses API로 질문을 보내고 답과 출처를 돌려준다.
// Vercel 환경변수: OPENAI_API_KEY (필수), OPENAI_MODEL (필수, OpenAI 콘솔에 보이는 모델 이름 그대로)
// 정확성을 위해 웹 검색 도구를 켜고, 모르면 모른다고 답하게 지시한다.

class GptError extends Error {}

const INSTRUCTIONS = [
  '너는 한국 부동산 법령(주택공급에 관한 규칙, 주택법, 도시정비법, 세법 등)과 청약 제도를 검증하는 검토자다.',
  '받은 내용을 항목별로 나눠 각 항목마다 [맞음] / [틀림] / [확인 불가] 중 하나로 판정한다.',
  '[틀림]이면 맞는 내용과 근거를 쓴다. 근거는 법령 이름과 조항 번호, 또는 정부·공공기관 공식 페이지 주소로 쓴다.',
  '근거를 찾지 못했으면 추측하지 말고 [확인 불가]로 쓴다. 확신이 없는 내용을 맞다고 하지 않는다.',
  '최신 시행일 기준으로 판단하고, 법령 개정으로 달라질 수 있는 내용은 기준일을 함께 쓴다.',
  '군더더기 없이 짧게, 한국어로 답한다.',
].join('\n');

function pickText(json) {
  if (typeof json.output_text === 'string' && json.output_text) return json.output_text;
  const parts = [];
  for (const item of json.output || []) {
    if (item.type !== 'message') continue;
    for (const c of item.content || []) if (c.type === 'output_text' && c.text) parts.push(c.text);
  }
  return parts.join('\n').trim();
}

function pickSources(json) {
  const seen = new Map();
  for (const item of json.output || []) {
    if (item.type !== 'message') continue;
    for (const c of item.content || []) {
      for (const a of c.annotations || []) {
        if (a.type === 'url_citation' && a.url && !seen.has(a.url)) seen.set(a.url, a.title || a.url);
      }
    }
  }
  return [...seen].map(([url, title]) => ({ title, url }));
}

async function callOpenAI(body, key) {
  const r = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(50000),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 아래에서 처리 */ }
  return { status: r.status, json, text };
}

async function askGpt({ question, context, search = true }) {
  const key = (process.env.OPENAI_API_KEY || '').trim();
  const model = (process.env.OPENAI_MODEL || '').trim();
  if (!key) throw new GptError('OpenAI API 키가 아직 연결되지 않았어요. Vercel 환경변수 OPENAI_API_KEY를 넣어 주세요.');
  if (!model) throw new GptError('쓸 GPT 모델 이름이 없어요. Vercel 환경변수 OPENAI_MODEL에 OpenAI 콘솔의 모델 이름을 넣어 주세요.');
  const q = String(question || '').trim();
  if (!q) throw new GptError('GPT에게 물어볼 내용(question)을 넣어 주세요.');
  const input = context ? `[검증할 내용]\n${String(context).slice(0, 20000)}\n\n[질문]\n${q}` : q;
  const base = { model, instructions: INSTRUCTIONS, input };

  let usedSearch = false;
  let r;
  if (search) {
    r = await callOpenAI({ ...base, tools: [{ type: 'web_search' }] }, key);
    usedSearch = r.status === 200;
    if (r.status === 400) r = null; // 이 모델이 웹 검색을 못 쓰면 검색 없이 다시
  }
  if (!r) r = await callOpenAI(base, key);

  if (r.status === 401) throw new GptError('OpenAI API 키가 맞지 않아요. 키를 다시 확인해 주세요.');
  if (r.status === 429) throw new GptError('OpenAI 사용 한도에 걸렸어요(크레딧 부족 또는 요청 과다). OpenAI 결제·사용량 화면을 확인해 주세요.');
  if (r.status !== 200 || !r.json) {
    const msg = r.json && r.json.error && r.json.error.message ? r.json.error.message : r.text.slice(0, 300);
    throw new GptError(`GPT 호출이 실패했어요 (${r.status}): ${msg}`);
  }
  const answer = pickText(r.json);
  if (!answer) throw new GptError('GPT가 빈 답을 돌려줬어요. 다시 시도해 주세요.');
  return { answer, sources: pickSources(r.json), model: r.json.model || model, usedSearch };
}

module.exports = { askGpt, GptError, _pickText: pickText, _pickSources: pickSources, INSTRUCTIONS };
