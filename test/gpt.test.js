const test = require('node:test');
const assert = require('node:assert');

const RESP = {
  model: 'test-model',
  output: [
    { type: 'web_search_call', status: 'completed' },
    { type: 'message', content: [{ type: 'output_text', text: '1. [맞음] 세대주 요건', annotations: [
      { type: 'url_citation', url: 'https://www.law.go.kr/a', title: '주택공급에 관한 규칙' },
      { type: 'url_citation', url: 'https://www.law.go.kr/a', title: '중복' },
    ] }] },
  ],
};

let seen = [];
let mode = 'ok';
global.fetch = async (url, opt) => {
  const body = JSON.parse(opt.body);
  seen.push({ url, body, auth: opt.headers.authorization });
  if (mode === 'nosearch' && body.tools) return { status: 400, text: async () => JSON.stringify({ error: { message: 'tool not supported' } }) };
  if (mode === 'badkey') return { status: 401, text: async () => '{}' };
  return { status: 200, text: async () => JSON.stringify(RESP) };
};

const { askGpt, GptError } = require('../lib/gpt');
const { _callTool } = require('../api/mcp');

test('키·모델이 없으면 알기 쉬운 오류', async () => {
  delete process.env.OPENAI_API_KEY; delete process.env.OPENAI_MODEL;
  await assert.rejects(askGpt({ question: 'x' }), (e) => e instanceof GptError && /OPENAI_API_KEY/.test(e.message));
  process.env.OPENAI_API_KEY = 'sk-test';
  await assert.rejects(askGpt({ question: 'x' }), (e) => e instanceof GptError && /OPENAI_MODEL/.test(e.message));
});

test('웹 검색을 켜고 답과 출처(중복 제거)를 돌려준다', async () => {
  process.env.OPENAI_API_KEY = 'sk-test'; process.env.OPENAI_MODEL = 'test-model';
  seen = []; mode = 'ok';
  const r = await askGpt({ question: '틀린 것만', context: '세대주 필요' });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'https://api.openai.com/v1/responses');
  assert.equal(seen[0].auth, 'Bearer sk-test');
  assert.deepEqual(seen[0].body.tools, [{ type: 'web_search' }]);
  assert.match(seen[0].body.input, /검증할 내용[\s\S]*세대주 필요[\s\S]*틀린 것만/);
  assert.match(seen[0].body.instructions, /확인 불가/);
  assert.equal(r.answer, '1. [맞음] 세대주 요건');
  assert.equal(r.sources.length, 1);
  assert.equal(r.usedSearch, true);
});

test('모델이 웹 검색을 못 쓰면 검색 없이 다시 묻고 표시한다', async () => {
  seen = []; mode = 'nosearch';
  const r = await askGpt({ question: 'q' });
  assert.equal(seen.length, 2);
  assert.equal(seen[1].body.tools, undefined);
  assert.equal(r.usedSearch, false);
});

test('키가 틀리면 401 안내', async () => {
  mode = 'badkey';
  await assert.rejects(askGpt({ question: 'q' }), /키가 맞지 않아요/);
});

test('MCP 도구 ask_gpt 결과 문구', async () => {
  mode = 'ok';
  const out = await _callTool('ask_gpt', { question: 'q' });
  assert.match(out.text, /GPT 답변 · 모델 test-model · 웹 검색 사용/);
  assert.match(out.text, /출처:\n- 주택공급에 관한 규칙 https:\/\/www\.law\.go\.kr\/a/);
});
