# User Story: Automated Documentation Sync

> Source: drafted for the capstone in place of a JIRA/Confluence ticket.
> Status: **Clarified – see [requirements.md](requirements.md)** (initial ACs below are superseded where they conflict)

## Story

**As a** repository maintainer,
**I want** a command-line tool that reads a GitHub repository's metadata from the GitHub REST API and writes it into a Markdown documentation file,
**so that** the project's documentation stays in sync with the actual state of the repository without manual copy-and-paste.

## Context

Project overview documents (name, description, license, languages, latest release, contributors and so on) go stale quickly because people update them by hand. The tool should regenerate that information on demand, for example locally or in CI, and produce the same result every time for the same input data.

## Acceptance Criteria (initial)

1. **Given** a valid `owner/repo`, **when** the tool runs, **then** it writes a Markdown file that contains the repository's key metadata.
2. **Given** a metadata field that is missing or empty on GitHub (for example no license, no description, or no releases), **when** the document is generated, **then** that field shows `Not Found` and the tool does not fail.
3. **Given** a repository that does not exist or cannot be accessed, **when** the tool runs, **then** it exits with a non-zero code and a clear error message.
4. **Given** an empty repository (no commits), **when** the tool runs, **then** it still produces a document and marks the commit-dependent fields as `Not Found`.
5. **Given** a GitHub token supplied through the environment, **when** the tool runs, **then** it uses the token to authenticate and never writes it to the output or the logs.
6. **Given** a GitHub API failure (rate limit, 5xx, or network error), **when** the tool runs, **then** it reports the failure clearly and leaves any existing output file unchanged.

## Out of Scope (initial)

- Writing back to GitHub (commits, PRs, or wiki edits).
- Platforms other than GitHub (GitLab, Bitbucket).
- A web UI.
