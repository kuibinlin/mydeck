# MyDeck Target Architecture

```text
                        ┌─────────────────────┐
                        │       Users         │
                        │   Browser / Mobile  │
                        └──────────┬──────────┘
                                   │
                                   ▼
                        ┌─────────────────────┐
                        │     Cloudflare      │
                        │  DNS / WAF / Proxy  │
                        └──────────┬──────────┘
                                   │
                  ┌────────────────┴────────────────┐
                  │                                 │
                  ▼                                 ▼
        ┌───────────────────┐             ┌───────────────────┐
        │ Cloudflare Pages  │             │ Cloudflare Worker │
        │ React Frontend    │             │ Main API          │
        └───────────────────┘             │ Auth / Policy     │
                                          │ D1 / KV access    │
                                          └─────────┬─────────┘
                                                    │
                         Agentic tutor request      │
                                                    ▼
                                          ┌───────────────────┐
                                          │   Google Cloud    │
                                          │     Cloud Run     │
                                          │                   │
                                          │ mydeck-agent      │
                                          │ Python / FastAPI  │
                                          │ LangChain agent   │
                                          └─────────┬─────────┘
                                                    │
                                    ┌───────────────┴───────────────┐
                                    │                               │
                                    ▼                               ▼
                           ┌─────────────────┐              ┌─────────────────┐
                           │   LLM Provider  │              │    HSK MCP      │
                           │   SEA-LION      │              │ Dictionary Tools│
                           └─────────────────┘              └─────────────────┘


# CI/CD + Infrastructure

Developer
    │
    │ git push
    ▼
┌──────────────────────┐
│       GitHub         │
│                      │
│ Source Code          │
│ GitHub Actions       │
└──────────┬───────────┘
           │
           │ OIDC / Workload Identity Federation
           │ no service-account JSON key
           ▼
┌──────────────────────────────────────────────────────────┐
│                    Google Cloud                          │
│                                                          │
│  ┌───────────────────────┐                               │
│  │   Artifact Registry   │                               │
│  │                       │                               │
│  │ mydeck-images         │                               │
│  │   └── mydeck-agent    │                               │
│  │       └── :<git-sha>  │                               │
│  └───────────┬───────────┘                               │
│              │                                           │
│              ▼                                           │
│  ┌───────────────────────┐                               │
│  │       Cloud Run       │                               │
│  │   mydeck-agent-dev    │                               │
│  └───────────────────────┘                               │
│                                                          │
│  ┌───────────────────────┐   ┌────────────────────────┐  │
│  │    Secret Manager     │   │ Logging / Monitoring   │  │
│  │ runtime secrets       │   │ metrics / alerts       │  │
│  └───────────────────────┘   └────────────────────────┘  │
│                                                          │
└──────────────────────────────────────────────────────────┘


# Terraform

Terraform
    │
    ├── bootstrap/
    │     ├── GCS remote state bucket
    │     └── required GCP APIs
    │
    ├── artifact-registry/
    │     └── mydeck-images
    │
    ├── iam/
    │     ├── runtime service account
    │     └── GitHub Workload Identity Federation
    │
    ├── secrets/
    │     └── Secret Manager containers
    │
    ├── run-dev/
    │     └── Cloud Run agent service
    │
    └── observability/
          ├── logging
          ├── monitoring
          └── alerts


# Terraform State

Git Repository
    │
    │ .tf files = desired state
    ▼
Terraform
    │
    │ reads / updates state
    ▼
GCS
┌───────────────────────────────┐
│ mydeck-linsnotes-tfstate      │
│                               │
│ ├── bootstrap/                │
│ ├── artifact-registry/        │
│ ├── iam/                      │
│ ├── secrets/                  │
│ ├── run-dev/                  │
│ └── observability/            │
└───────────────────────────────┘