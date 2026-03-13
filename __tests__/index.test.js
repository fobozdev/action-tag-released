const {
  getPreviousTag,
  resolvePullRequestsInRange,
  runAction,
} = require("../src/index");

function createCore(inputs = {}) {
  const outputs = {};
  const info = jest.fn();

  return {
    info,
    outputs,
    getInput: jest.fn((name, options = {}) => {
      const value = inputs[name] || "";
      if (options.required && !value) {
        throw new Error(`Missing input: ${name}`);
      }
      return value;
    }),
    setOutput: jest.fn((name, value) => {
      outputs[name] = value;
    }),
  };
}

describe("getPreviousTag", () => {
  test("returns explicit previous tag when provided", async () => {
    const client = { paginate: jest.fn() };

    await expect(
      getPreviousTag(client, {
        owner: "acme",
        repo: "widgets",
        currentTag: "v2.0.0",
        explicitPreviousTag: "v1.9.0",
      }),
    ).resolves.toBe("v1.9.0");
    expect(client.paginate).not.toHaveBeenCalled();
  });

  test("finds previous published release by tag order", async () => {
    const client = {
      rest: { repos: { listReleases: {} } },
      paginate: jest.fn().mockResolvedValue([
        { tag_name: "v2.0.0", draft: false },
        { tag_name: "v1.5.0", draft: true },
        { tag_name: "v1.4.0", draft: false },
        { tag_name: "v1.3.0", draft: false },
      ]),
    };

    await expect(
      getPreviousTag(client, {
        owner: "acme",
        repo: "widgets",
        currentTag: "v2.0.0",
      }),
    ).resolves.toBe("v1.4.0");
  });
});

describe("resolvePullRequestsInRange", () => {
  test("returns unique merged pull request numbers for commit range", async () => {
    const client = {
      rest: {
        repos: {
          compareCommitsWithBasehead: jest.fn().mockResolvedValue({
            data: {
              commits: [{ sha: "a1" }, { sha: "b2" }],
            },
          }),
          listPullRequestsAssociatedWithCommit: {},
        },
      },
      paginate: jest
        .fn()
        .mockResolvedValueOnce([
          { number: 12, merged_at: "2026-03-13T10:00:00Z" },
          { number: 12, merged_at: "2026-03-13T10:00:00Z" },
          { number: 18, merged_at: null },
        ])
        .mockResolvedValueOnce([
          { number: 15, merged_at: "2026-03-13T10:00:00Z" },
        ]),
    };

    await expect(
      resolvePullRequestsInRange(client, {
        owner: "acme",
        repo: "widgets",
        previousTag: "v1.0.0",
        currentTag: "v2.0.0",
      }),
    ).resolves.toEqual([12, 15]);
  });

  test("returns no pull requests when no previous tag exists", async () => {
    const client = {
      rest: {
        repos: {
          compareCommitsWithBasehead: jest.fn(),
        },
      },
    };

    await expect(
      resolvePullRequestsInRange(client, {
        owner: "acme",
        repo: "widgets",
        previousTag: "",
        currentTag: "v1.0.0",
      }),
    ).resolves.toEqual([]);
    expect(client.rest.repos.compareCommitsWithBasehead).not.toHaveBeenCalled();
  });
});

describe("runAction", () => {
  test("creates a missing label and applies it to discovered pull requests", async () => {
    const core = createCore({
      "github-token": "token",
      label: "released",
      "current-tag": "v2.0.0",
      "previous-tag": "v1.0.0",
      "create-label": "true",
      "label-color": "123456",
      "label-description": "Included in release",
    });

    const client = {
      rest: {
        repos: {
          compareCommitsWithBasehead: jest.fn().mockResolvedValue({
            data: { commits: [{ sha: "a1" }] },
          }),
          listPullRequestsAssociatedWithCommit: {},
        },
        issues: {
          getLabel: jest.fn().mockRejectedValue({ status: 404 }),
          createLabel: jest.fn().mockResolvedValue({}),
          addLabels: jest.fn().mockResolvedValue({}),
        },
      },
      paginate: jest.fn().mockResolvedValue([{ number: 42, merged_at: "2026-03-13T10:00:00Z" }]),
    };

    const result = await runAction({
      core,
      githubModule: {},
      context: { repo: { owner: "acme", repo: "widgets" }, payload: {} },
      clientFactory: () => client,
    });

    expect(client.rest.issues.createLabel).toHaveBeenCalledWith({
      owner: "acme",
      repo: "widgets",
      name: "released",
      color: "123456",
      description: "Included in release",
    });
    expect(client.rest.issues.addLabels).toHaveBeenCalledWith({
      owner: "acme",
      repo: "widgets",
      issue_number: 42,
      labels: ["released"],
    });
    expect(core.outputs["labeled-pr-count"]).toBe("1");
    expect(result.pullRequestNumbers).toEqual([42]);
  });

  test("uses release event tag and skips labeling when no prior release exists", async () => {
    const core = createCore({
      "github-token": "token",
      label: "released",
    });

    const client = {
      rest: {
        repos: {
          listReleases: {},
          compareCommitsWithBasehead: jest.fn(),
        },
      },
      paginate: jest.fn().mockResolvedValue([{ tag_name: "v1.0.0", draft: false }]),
    };

    const result = await runAction({
      core,
      githubModule: {},
      context: {
        repo: { owner: "acme", repo: "widgets" },
        payload: { release: { tag_name: "v1.0.0" } },
      },
      clientFactory: () => client,
    });

    expect(core.outputs["current-tag"]).toBe("v1.0.0");
    expect(core.outputs["previous-tag"]).toBe("");
    expect(core.outputs["labeled-pr-count"]).toBe("0");
    expect(result.pullRequestNumbers).toEqual([]);
    expect(client.rest.repos.compareCommitsWithBasehead).not.toHaveBeenCalled();
  });
});
