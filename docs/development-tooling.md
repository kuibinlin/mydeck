# Development Tooling

This project uses the following tools for local development, infrastructure management, container builds, and deployment.

## Required Tools

```text
git
gh
terraform
gcloud
docker
nvm
  └── node + npm
uv
  └── Python 3.12 for agent-service
```

## Tool Responsibilities

| Tool          | Purpose                                                              |
| ------------- | -------------------------------------------------------------------- |
| `git`         | Source control and branch management                                 |
| `gh`          | GitHub CLI for repository, pull request, and workflow operations     |
| `terraform`   | Provision and manage cloud infrastructure                            |
| `gcloud`      | Authenticate to Google Cloud and inspect/manage GCP resources        |
| `docker`      | Build and run the Python agent container locally                     |
| `nvm`         | Manage the Node.js version used by the project                       |
| `node`        | Run the frontend and Cloudflare Worker development tooling           |
| `npm`         | Install JavaScript dependencies and run project scripts              |
| `uv`          | Manage the Python environment and dependencies for the agent service |
| `Python 3.12` | Runtime used by `services/agent-service`                             |

## Version Management

### Node.js

Node.js is managed with `nvm`.

The repository contains a `.nvmrc`, so from the repository root run:

```bash
nvm install
nvm use
```

`npm` is installed together with Node.js.

Verify:

```bash
nvm --version
node --version
npm --version
```

Do not manage the project Node.js version separately with Homebrew when using `nvm`.

### Python

The agent service uses Python 3.12.

Python is managed with `uv`, so Python 3.12 does not need to become the system-wide Python version.

Install the required runtime with:

```bash
uv python install 3.12
```

Verify:

```bash
uv --version
uv python list
```

The Python service is located at:

```text
services/agent-service/
```

Its dependencies are defined separately from the Node.js workspaces.

## Infrastructure Tools

### Terraform

Terraform is used to manage Google Cloud infrastructure declaratively.

Typical commands include:

```bash
terraform fmt
terraform init
terraform validate
terraform plan
terraform apply
```

Terraform is run from the developer machine and later from GitHub Actions.

Terraform provider dependencies are downloaded automatically by:

```bash
terraform init
```

Do not install providers such as the Google provider manually.

Commit:

```text
.terraform.lock.hcl
```

Do not commit:

```text
.terraform/
*.tfstate
*.tfstate.*
*.tfplan
```

### Google Cloud CLI

The Google Cloud CLI is used for local authentication, project inspection, and deployment troubleshooting.

Verify:

```bash
gcloud version
```

For local Terraform authentication, use Google Application Default Credentials:

```bash
gcloud auth application-default login
```

CI/CD does not use a stored service-account JSON key. GitHub Actions will authenticate to Google Cloud using Workload Identity Federation.

### GitHub CLI

The GitHub CLI is useful for repository and CI/CD operations.

Verify:

```bash
gh --version
```

Examples:

```bash
gh repo view
gh pr status
gh run list
```

### Docker

Docker is used to build and test the Python agent service locally before deploying it to Google Cloud Run.

Verify:

```bash
docker --version
```

Example local build:

```bash
docker build \
  -t mydeck-agent:local \
  services/agent-service
```

Example local run:

```bash
docker run --rm \
  -p 8080:8080 \
  --env-file services/agent-service/.env.local \
  mydeck-agent:local
```

## Verify the Development Environment

From the developer machine, these commands should succeed:

```bash
git --version
gh --version
terraform version
gcloud version
docker --version
nvm --version
node --version
npm --version
uv --version
```

After entering the repository, also run:

```bash
nvm use
```

For the Python agent service, confirm Python 3.12 is available through `uv`.

## Tool Ownership Summary

```text
Developer machine
├── git
├── gh
├── terraform
├── gcloud
├── docker
├── nvm
│   └── node + npm
└── uv
    └── Python 3.12

Project
├── frontend/                 Node.js
├── backend/                  Node.js / Cloudflare Worker
├── services/agent-service/   Python 3.12
└── infrastructure/           Terraform
```

The goal is to keep version management explicit:

* Node.js is managed by `nvm`.
* Python is managed by `uv`.
* Terraform is installed as a standalone CLI.
* Google Cloud access is handled through `gcloud`.
* Containers are built and tested with Docker.
* GitHub operations can be performed through `git` and `gh`.
