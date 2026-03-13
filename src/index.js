const core = require("@actions/core");
const github = require("@actions/github");

function toBoolean(value) {
  return String(value).toLowerCase() === "true";
}

function uniqueNumbers(values) {
  return [...new Set(values)].sort((left, right) => left - right);
}

async function getCurrentTag(context, inputTag) {
  if (inputTag) {
    return inputTag;
  }

  const eventTag = context.payload?.release?.tag_name;
  if (eventTag) {
    return eventTag;
  }

  throw new Error(
    "Unable to determine the current release tag. Provide the 'current-tag' input or run the action from a release event.",
  );
}

async function getPreviousTag(client, { owner, repo, currentTag, explicitPreviousTag }) {
  if (explicitPreviousTag) {
    return explicitPreviousTag;
  }

  const releases = await client.paginate(client.rest.repos.listReleases, {
    owner,
    repo,
    per_page: 100,
  });

  const publishedReleases = releases.filter((release) => !release.draft);
  const currentIndex = publishedReleases.findIndex(
    (release) => release.tag_name === currentTag,
  );

  if (currentIndex === -1) {
    throw new Error(
      `Could not find release metadata for tag '${currentTag}'. Ensure the release exists or pass 'previous-tag' explicitly.`,
    );
  }

  const previousRelease = publishedReleases
    .slice(currentIndex + 1)
    .find((release) => release.tag_name !== currentTag);

  return previousRelease ? previousRelease.tag_name : "";
}

async function resolvePullRequestsInRange(client, { owner, repo, previousTag, currentTag }) {
  if (!previousTag) {
    return [];
  }

  const comparison = await client.rest.repos.compareCommitsWithBasehead({
    owner,
    repo,
    basehead: `${previousTag}...${currentTag}`,
    per_page: 100,
  });

  const prNumbers = [];

  for (const commit of comparison.data.commits) {
    const pullRequests = await client.paginate(
      client.rest.repos.listPullRequestsAssociatedWithCommit,
      {
        owner,
        repo,
        commit_sha: commit.sha,
        per_page: 100,
      },
    );

    for (const pullRequest of pullRequests) {
      if (pullRequest.merged_at) {
        prNumbers.push(pullRequest.number);
      }
    }
  }

  return uniqueNumbers(prNumbers);
}

async function ensureLabelExists(client, { owner, repo, label, color, description }) {
  try {
    await client.rest.issues.getLabel({ owner, repo, name: label });
  } catch (error) {
    if (error.status !== 404) {
      throw error;
    }

    await client.rest.issues.createLabel({
      owner,
      repo,
      name: label,
      color,
      description,
    });
  }
}

async function addLabelToPullRequests(client, { owner, repo, label, pullRequestNumbers }) {
  for (const issueNumber of pullRequestNumbers) {
    await client.rest.issues.addLabels({
      owner,
      repo,
      issue_number: issueNumber,
      labels: [label],
    });
  }
}

async function runAction({ core: actionCore, githubModule, context, clientFactory } = {}) {
  const coreApi = actionCore || core;
  const githubApi = githubModule || github;
  const actionContext = context || github.context;

  const token = coreApi.getInput("github-token", { required: true });
  const label = coreApi.getInput("label") || "released";
  const previousTagInput = coreApi.getInput("previous-tag");
  const currentTagInput = coreApi.getInput("current-tag");
  const createLabel = toBoolean(coreApi.getInput("create-label"));
  const labelColor = coreApi.getInput("label-color") || "0e8a16";
  const labelDescription = coreApi.getInput("label-description");

  const owner = actionContext.repo.owner;
  const repo = actionContext.repo.repo;
  const client = clientFactory ? clientFactory(token) : githubApi.getOctokit(token);
  const currentTag = await getCurrentTag(actionContext, currentTagInput);
  const previousTag = await getPreviousTag(client, {
    owner,
    repo,
    currentTag,
    explicitPreviousTag: previousTagInput,
  });

  coreApi.info(`Processing release tag '${currentTag}'.`);
  if (previousTag) {
    coreApi.info(`Comparing changes from '${previousTag}' to '${currentTag}'.`);
  } else {
    coreApi.info("No previous release tag found. No pull requests will be labeled.");
  }

  const pullRequestNumbers = await resolvePullRequestsInRange(client, {
    owner,
    repo,
    previousTag,
    currentTag,
  });

  if (pullRequestNumbers.length === 0) {
    coreApi.info("No merged pull requests found in the release range.");
  } else {
    if (createLabel) {
      await ensureLabelExists(client, {
        owner,
        repo,
        label,
        color: labelColor,
        description: labelDescription,
      });
    }

    await addLabelToPullRequests(client, {
      owner,
      repo,
      label,
      pullRequestNumbers,
    });
    coreApi.info(
      `Applied label '${label}' to pull requests: ${pullRequestNumbers.join(", ")}.`,
    );
  }

  coreApi.setOutput("current-tag", currentTag);
  coreApi.setOutput("previous-tag", previousTag);
  coreApi.setOutput("labeled-pr-count", String(pullRequestNumbers.length));
  coreApi.setOutput("labeled-prs", JSON.stringify(pullRequestNumbers));

  return {
    currentTag,
    previousTag,
    pullRequestNumbers,
  };
}

async function main() {
  try {
    await runAction();
  } catch (error) {
    core.setFailed(error.message);
  }
}

if (require.main === module) {
  void main();
}

module.exports = {
  addLabelToPullRequests,
  ensureLabelExists,
  getCurrentTag,
  getPreviousTag,
  resolvePullRequestsInRange,
  runAction,
  toBoolean,
  uniqueNumbers,
};
