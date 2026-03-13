# Label Released Pull Requests

`label-released-pull-requests` is a JavaScript GitHub Action that finds merged pull requests included in a published release and adds a label to each of them.

It compares the current release tag to the previous published release tag, resolves the pull requests associated with commits in that range, de-duplicates them, and applies the configured label.

## Inputs

| Name | Required | Default | Description |
| --- | --- | --- | --- |
| `github-token` | yes | - | Token with `contents: read` and `pull-requests: write` permissions. |
| `label` | no | `released` | Label to apply to included pull requests. |
| `previous-tag` | no | - | Explicit previous tag to compare against. |
| `current-tag` | no | release event tag | Explicit current tag override. |
| `create-label` | no | `false` | Create the label if it does not already exist. |
| `label-color` | no | `0e8a16` | Hex color used when creating the label. |
| `label-description` | no | `Pull request included in a published release` | Description used when creating the label. |

## Outputs

| Name | Description |
| --- | --- |
| `current-tag` | Current release tag processed by the action. |
| `previous-tag` | Previous release tag used for comparison. |
| `labeled-pr-count` | Number of pull requests that were labeled. |
| `labeled-prs` | JSON array of labeled pull request numbers. |

## Example workflow

```yaml
name: Label released pull requests

on:
  release:
    types: [published]

jobs:
  label-released-prs:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write

    steps:
      - name: Label pull requests included in the release
        uses: fobozdev/action-tag-released@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          label: released
          create-label: true
```

## Versioning

- Reference a release tag such as `fobozdev/action-tag-released@v1` instead of `@master`.
- Move the `v1` tag forward as you publish compatible updates, and create full tags such as `v1.0.0` for each release.

## Notes

- By default, the action uses the current release tag from the `release` event payload.
- If no previous published release exists, the action exits successfully without labeling any pull requests.
- If your release flow needs a custom comparison base, pass `previous-tag` explicitly.

## Development

```bash
npm install
npm test
npm run build
```
