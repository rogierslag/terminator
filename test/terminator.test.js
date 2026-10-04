import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.NODE_CONFIG = JSON.stringify({
	github: { oauth_token: 'test-token' },
	repos: ['owner/repo'],
	files: ['changelog.xml'],
});
const { default: checkPayload } = await import('../src/terminator.js');

const sha = 'a'.repeat(40);
const filesUrl = 'https://api.github.com/repos/owner/repo/pulls/42/files';

function payload(overrides = {}) {
	return {
		action: 'opened',
		pull_request: {
			number: 42,
			head: { repo: { full_name: 'OWNER/REPO' }, sha },
		},
		...overrides,
	};
}

async function run(t, body, responses = []) {
	const calls = [];
	t.mock.method(globalThis, 'fetch', async (url, options) => {
		calls.push({ url, options });
		assert.equal(options.redirect, 'error');
		assert.equal(new URL(url).origin, 'https://api.github.com');
		const response = responses.shift();
		assert.ok(response, 'Unexpected outgoing request');
		return response;
	});
	t.mock.method(console, 'log', () => {});
	t.mock.method(console, 'error', () => {});
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const ctx = { request: { body } };
	const result = checkPayload(ctx);
	t.mock.timers.tick(5000);
	await result;
	return { ctx, calls };
}

function files(names = [], next) {
	return new Response(JSON.stringify(names.map(filename => ({ filename }))), {
		headers: next ? { link: `<${next}>; rel="next"` } : {},
	});
}

test('reports success for a supported PR without deployment changes', async t => {
	const { ctx, calls } = await run(t, payload(), [files(['README.md']), new Response()]);
	assert.equal(ctx.status, 200);
	assert.deepEqual(calls.map(call => call.url), [
		`${filesUrl}?page=1`,
		`https://api.github.com/repos/owner/repo/statuses/${sha}`,
	]);
	assert.equal(JSON.parse(calls[1].options.body).state, 'success');
});

test('follows pagination and reports pending for deployment changes', async t => {
	const { ctx, calls } = await run(t, payload({ action: 'synchronize' }), [
		files(['README.md'], `${filesUrl}?per_page=30&page=2`),
		files(['db/changelog.xml']), new Response(),
	]);
	assert.equal(ctx.status, 200);
	assert.equal(calls[1].url, `${filesUrl}?page=2`);
	assert.equal(JSON.parse(calls[2].options.body).state, 'pending');
});

test('stops pagination once a deployment change is found', async t => {
	const { ctx, calls } = await run(t, payload(), [
		files(['changelog.xml'], `${filesUrl}?page=2`), new Response(),
	]);
	assert.equal(ctx.status, 200);
	assert.equal(calls.length, 2);
});

for (const body of [
	payload({ action: '<script>alert(1)</script>' }),
	payload({ pull_request: { head: { repo: { full_name: 'attacker/repo' } } } }),
	payload({ pull_request: { head: { repo: { full_name: 'owner/repo/../../evil' } } } }),
	{},
]) {
	test(`ignores unsupported payload ${JSON.stringify(body)}`, async t => {
		const { ctx, calls } = await run(t, body);
		assert.equal(ctx.status, 200);
		assert.equal(ctx.body, 'Unsupported update');
		assert.equal(calls.length, 0);
	});
}

test('accepts GitHub ping without a pull request', async t => {
	const { ctx, calls } = await run(t, { zen: 'Keep it logically awesome.' });
	assert.equal(ctx.status, 200);
	assert.equal(calls.length, 0);
});

for (const [field, value] of [
	['number', '../1'], ['number', '42'], ['number', -1],
	['number', 1.5], ['number', Number.MAX_SAFE_INTEGER + 1],
	['sha', '../commits'], ['sha', `${sha}?redirect=http://127.0.0.1`],
	['sha', null],
]) {
	test(`rejects invalid ${field}: ${value}`, async t => {
		const body = payload();
		if (field === 'number') body.pull_request.number = value;
		else body.pull_request.head.sha = value;
		const { ctx, calls } = await run(t, body);
		assert.equal(ctx.status, 400);
		assert.equal(calls.length, 0);
	});
}

for (const next of [
	'http://127.0.0.1/admin?page=2',
	'https://attacker.example/files?page=2',
	'https://api.github.com/repos/other/repo/pulls/42/files?page=2',
	`${filesUrl}?page=1`, `${filesUrl}?page=NaN`,
	`${filesUrl}?page=2.5`, `${filesUrl}?page=9007199254740992`,
	`${filesUrl}?page=2#fragment`,
	'https://user:password@api.github.com/repos/owner/repo/pulls/42/files?page=2',
	'not a URL',
]) {
	test(`rejects unsafe pagination ${next}`, async t => {
		const { ctx, calls } = await run(t, payload(), [files([], next)]);
		assert.equal(ctx.status, 500);
		assert.equal(calls.length, 1);
	});
}

test('does not report success when GitHub rejects the file request', async t => {
	const { ctx, calls } = await run(t, payload(), [new Response('', { status: 403 })]);
	assert.equal(ctx.status, 500);
	assert.equal(calls.length, 1);
});

test('does not accept a failed status update', async t => {
	const { ctx } = await run(t, payload(), [files(), new Response('', { status: 403 })]);
	assert.equal(ctx.status, 500);
});
