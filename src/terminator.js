// Determine whether to do something with the payload
import config from 'config';
import fetch from 'node-fetch';
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
	return validatePendingFiles(`https://api.github.com/repos/${repoName}/pulls/${pullRequestId}/files`);
}

// Determine whether the PR contains any files that require a pending status by recursing over the PR
async function validatePendingFiles(url) {
	const response = await fetch(url, {
		headers: headers(),
	});
	if (!response.ok) {
		throw new Error(`Unexpected status ${response.status} on ${url}`);
	}

	const body = await response.json();
	const fileNames = body.map((e) => e.filename);
	const filesWhichTrigger = fileNames.filter((item) => config.get('files').some((file) => item.endsWith(file)));

	const hasPendingFiles = filesWhichTrigger.length > 0;
	const linkHeader = response.headers.has('link') && parse(response.headers.get('link')).next;
	if (!linkHeader) {
		return hasPendingFiles;
	}
	// Early exit if we have any pending files
	if (hasPendingFiles) {
		return true;
	}
	return validatePendingFiles(linkHeader.url);
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
	const { pull_request, zen, action } = ctx.request.body;
	const { head, number: pullRequestId } = pull_request;
	const { repo, sha } = head;
	const repoName = repo.full_name.toLowerCase();

	const isSupportedRepo = config.get('repos').includes(repoName);

	if (!isSupportedRepo || !supportedActions.includes(action)) {
		ctx.body = `Unsupported update: ${action} for ${repoName}`;
		ctx.status = 200;
		return;
	}

	if (zen) {
		ctx.status = 200;
		ctx.body = 'Well Github, I love you too!';
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
