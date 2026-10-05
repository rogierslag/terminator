// Determine whether to do something with the payload
import config from 'config';
import parse from 'parse-link-header';

const supportedActions = ['opened', 'synchronize'];

const sleep = (timeout) => new Promise((resolve) => setTimeout(resolve, timeout));

function headers() {
	return {
		'User-Agent': 'Terminator https://github.com/rogierslag/terminator',
		Authorization: `token ${config.get('github.oauth_token')}`,
	};
}

function validatePullRequest(repoName, pullRequestId) {
	return validatePendingFiles(`/repos/${repoName}/pulls/${encodeURIComponent(pullRequestId)}/files`);
}

// Determine whether the PR contains any files that require a pending status by recursing over the PR
async function validatePendingFiles(path, page = 1) {
	const url = `https://api.github.com${path}?page=${page}`;
	const response = await fetch(url, {
		headers: headers(),
		redirect: 'error',
	});
	if (!response.ok) {
		throw new Error(`Unexpected status ${response.status} on ${url}`);
	}

	const body = await response.json();
	const fileNames = body.map((e) => e.filename);
	const filesWhichTrigger = fileNames.filter((item) => config.get('files').some((file) => item.endsWith(file)));

	const hasPendingFiles = filesWhichTrigger.length > 0;
	const linkHeader = parse(response.headers.get('link'))?.next;
	if (!linkHeader) {
		return hasPendingFiles;
	}
	// Early exit if we have any pending files
	if (hasPendingFiles) {
		return true;
	}
	// A Link header may select the next page, but never the request destination.
	const next = new URL(linkHeader.url);
	const nextPage = Number(next.searchParams.get('page'));
	if (next.origin !== 'https://api.github.com' || next.pathname !== path ||
		next.username || next.password || next.hash ||
		!Number.isSafeInteger(nextPage) || nextPage <= page) {
		throw new Error('Invalid GitHub pagination link');
	}
	return validatePendingFiles(path, nextPage);
}

async function reportStatus(repoName, sha, pendingFiles) {
	const url = `https://api.github.com/repos/${repoName}/statuses/${sha}`;
	let body;

	if (!pendingFiles) {
		body = {
			state: 'success',
			context: 'Terminator',
			description: 'This PR does not contain changes which affect deployment',
		};
	} else {
		body = {
			state: 'pending',
			context: 'Terminator',
			description: 'This PR contains changes which may affect deployment',
		};
	}

	const response = await fetch(url, {
		method: 'POST',
		redirect: 'error',
		body: JSON.stringify(body),
		headers: {
			...headers(),
			'content-type': 'application/json',
		},
	});
	if (!response.ok) {
		throw new Error(`Unexpected status ${response.status} on ${url}`);
	}
}

export default async function checkPayload(ctx) {
	const { pull_request, zen, action } = ctx.request.body ?? {};
	if (zen) {
		ctx.status = 200;
		ctx.body = 'Well Github, I love you too!';
		return;
	}

	const fullName = pull_request?.head?.repo?.full_name;
	// Select the repository from trusted configuration, not from webhook input.
	const repoName = config.get('repos').find((name) =>
		typeof fullName === 'string' && name === fullName.toLowerCase());
	if (!repoName || !supportedActions.includes(action)) {
		ctx.body = 'Unsupported update';
		ctx.status = 200;
		return;
	}

	const pullRequestId = pull_request.number;
	const sha = pull_request.head.sha;
	if (!/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(repoName) ||
		!Number.isSafeInteger(pullRequestId) || pullRequestId <= 0 ||
		typeof sha !== 'string' || !/^[a-fA-F0-9]{40}$/.test(sha)) {
		ctx.status = 400;
		ctx.body = 'Invalid pull request';
		return;
	}

	console.log(`${action} ${pullRequestId} for ${repoName}`);

	await sleep(5000);
	try {
		const pendingFiles = await validatePullRequest(repoName, pullRequestId);
		await reportStatus(repoName, sha, pendingFiles);
		ctx.status = 200;
	} catch (e) {
		console.error(`Encountered an unexpected error ${e}`);
		ctx.status = 500;
	}
}
