# Releasing ScopeView

ScopeView has one package and one version. The library, Node HTML API and `scopeview` executable ship together as `@scopedb/scopeview`. Releases are stable versions; prerelease channels are not automated.

## Published artifacts

For version `0.1.0`, npm receives `@scopedb/scopeview@0.1.0` with public access and the `latest` dist-tag. GitHub Release `v0.1.0` receives:

| Artifact                                    | Contents                                                         |
| ------------------------------------------- | ---------------------------------------------------------------- |
| `scopedb-scopeview-0.1.0.tgz` and `.sha256` | The exact npm tarball accepted by package tests                  |
| `scopeview-v0.1.0-linux-x64.tar.gz`         | CLI, package resources and pinned Linux x64 Node runtime         |
| `scopeview-v0.1.0-linux-arm64.tar.gz`       | CLI, package resources and pinned Linux ARM64 Node runtime       |
| `scopeview-v0.1.0-darwin-x64.tar.gz`        | CLI, package resources and pinned macOS x64 Node runtime         |
| `scopeview-v0.1.0-darwin-arm64.tar.gz`      | CLI, package resources and pinned macOS ARM64 Node runtime       |
| `scopeview-v0.1.0-windows-x64.zip`          | CLI, package resources and pinned Windows x64 Node runtime       |
| `scopeview-v0.1.0-windows-arm64.zip`        | CLI, package resources and pinned Windows ARM64 Node runtime     |
| `scopeview-v0.1.0-<target>.sha256`          | Checksums for that platform archive and its original npm tarball |

Every platform archive consumes the same tested npm tarball. Native jobs use only Node built-ins and do not install the project's development dependencies. They check the actual launcher on its target OS/architecture. Fonts and third-party runtime licenses are included. Extract and retain the complete directory; the launcher is not a single-file executable.

The documentation site is built for validation but is not deployed by the release workflow. Public GitHub downloads require a publicly readable repository or separate public hosting. Publishing npm does not make a private GitHub repository public.

## npm trusted publisher setup

In the npm settings for `@scopedb/scopeview`, configure a GitHub Actions trusted publisher:

| Setting              | Value                       |
| -------------------- | --------------------------- |
| Organization or user | `scopedb`                   |
| Repository           | `scopeview`                 |
| Workflow filename    | `release.yml`               |
| Environment name     | `release`                   |
| Allowed action       | Enable direct `npm publish` |

Use only the filename, not `.github/workflows/release.yml`. Create the matching `release` GitHub environment; add a required reviewer there if publication should wait for human approval. The publishing job grants `id-token: write` and uses a GitHub-hosted runner. Do not add an `NPM_TOKEN` secret. The workflow checks npm >= 11.5.1. Keep `repository.url` in package metadata matched to the GitHub repository; npm validates that association.

[Trusted publisher configurations](https://docs.npmjs.com/trusted-publishers/) bind to the repository's immutable identity after their first successful publication. Recreate the configuration if the GitHub repository is deleted and recreated, even under the same name. Configure it close to publication: an unused new configuration currently expires after two days. Automatic npm provenance requires both a public package and a public source repository.

### First publication

[npm requires the package to exist before configuring trust](https://docs.npmjs.com/cli/v11/commands/npm-trust/). If this package does not yet exist, an npm account with publishing rights in the `@scopedb` organization must publish the first accepted tarball using interactive authentication:

```sh
npm login
npm publish ./scopedb-scopeview-0.1.0.tgz --access public --ignore-scripts
```

Use the accepted artifact from the release run, after all verification and native jobs have passed. Do not create an empty placeholder version or rebuild locally for this bootstrap. If the publishing job stopped at missing npm trust, complete that first publication manually and rerun only the failed job. It compares the existing registry integrity with the accepted tarball, skips an identical npm publication and completes the GitHub Release. A differing published version is an error. The initial interactive publication does not have CI provenance; subsequent OIDC publications can. Configure trust just before the first subsequent automated release; skipping an already-published version does not validate a new trusted publisher.

## Release procedure

1. Prepare a commit with the intended `package.json` version and a dated changelog heading, for example `## v0.1.0 (2026-10-28)`. Keep the notes focused on the released behavior. Review and merge the changes.
2. Optionally run **Release** through `workflow_dispatch` on the candidate ref. This builds and tests all artifacts without publishing. Artifact retention is seven days.
3. Create and push `v<version>` at that reviewed commit. This is the publication trigger. Tag/version mismatches and undated changelog entries fail before building. Never move a published tag or reuse an npm version.
4. `release.yml` calls the normal verification workflow, packages and tests all six native targets, verifies checksums, then publishes the accepted npm bytes using OIDC. It creates the GitHub Release with those same artifacts and the changelog section.
5. Install the exact version in a fresh project, run `scopeview example bar` and `scopeview render`, and inspect the HTML offline. Check a public native download and its checksum before advertising the installation links.

PRs changing release workflows, the pinned Node runtime or native packaging also run the release build and native checks, with publication disabled. Ordinary source/documentation PRs run only the normal CI job. A tag release re-verifies its own commit; it does not reuse an unrelated PR artifact.

If publication is interrupted, rerun only failed jobs while artifacts remain available. npm is skipped only after matching the existing version's SHA-512 integrity. If GitHub already has a partially created release, inspect and complete its assets from the accepted run instead of overwriting the release or rebuilding packages. No workflow rewrites tags or changes repository visibility.
