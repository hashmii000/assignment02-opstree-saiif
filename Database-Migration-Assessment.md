# Enterprise DevOps Database Migration Documentation

**Version:** 1.0  
**Date:** 2026-06-09  
**Owner:** DevOps Engineering  

## Executive Summary

This project establishes a secure, automated database migration pipeline for PostgreSQL (Neon) using Flyway and GitHub Actions. The pipeline integrates DevSecOps controls such as secret scanning with Gitleaks and SQL linting with SQLFluff. It validates migration integrity and ensures deterministic promotion to production via a manual, auditable Continuous Deployment (CD) workflow. The following migrations were executed end to end:

- **V1__create_users.sql** — Creates the users table.
- **V2__add_phone_column.sql** — Adds a phone column.
- **V3__rollback_phone_column.sql** — Removes the phone column.

Evidence from Neon reflects the `flyway_schema_history` entries and the final users table schema, demonstrating a complete forward and rollback change cycle.

## Project Objectives

- Implement repeatable, idempotent database migrations with full history and auditability.
- Integrate DevSecOps checks in Continuous Integration (CI) for early defect and secret leakage detection.
- Provide a controlled CD process with manual approval and environment-segregated credentials.
- Produce artifacts for traceability and post-deployment verification.
- Use managed PostgreSQL (Neon) to reduce operational overhead while preserving security and observability.

## Problem Statement

Database changes are often applied manually or via ad hoc SQL, causing drift, broken environments, and inadequate rollback strategies. A standardized mechanism is needed to:

- **Version-control schema changes.**
- **Validate and lint SQL prior to deployment.**
- **Prevent secret leakage in code.**
- **Promote migrations across environments in a governed, auditable manner.**

## Why Database Migration Automation is Important

- **Consistency:** Eliminates "works on my machine" drift between development, staging, and production.
- **Auditability:** Every change is recorded with checksum, author, and timestamp.
- **Safety:** Pre-deploy validation and linting reduce runtime failures.
- **Speed:** CI/CD enables faster, reliable releases.
- **Compliance:** Provides evidence for controls such as segregation of duties, approvals, and traceability.

## Solution Architecture

### Components

- **Source Code Repository (GitHub):** Stores SQL migrations and pipeline definitions.
- **CI Workflow:** Runs on pull requests and pushes.
  - **Steps:** Checkout → Gitleaks → SQLFluff → Naming validation → Flyway info/validate → Upload artifacts.
- **CD Workflow:** Manually triggered on main/production branch.
  - **Steps:** Flyway info/validate → Flyway migrate → Flyway info post-deploy → Upload artifacts.
- **Secure Secrets:** Injected via GitHub Encrypted Secrets.
- **Neon:** Provides managed PostgreSQL; Flyway connects using JDBC via secrets.

### Architecture Diagram (ASCII)

```
+------------------+ PR / Push +----------------------+
|   Developer      | ---------------------------->    |  GitHub Repository  |
| (feature branch) |                                   | (assignment02-...)  |
+------------------+    +----------+-----------+
                        |
                        |  CI (on push/PR)
                        v
                  +-------+--------+
                  | GitHub Actions |
                  |   CI Workflow  |
                  +-------+--------+
                        |
+-------------------Security Gates----------------------+
|    Gitleaks    |  SQLFluff   | Naming Check | Flyway Val |
+----------------+-------------+---------------+------------+
                        |
                        v
                 Artifacts / Reports
                        |
                Manual Approval (dispatch)
                        |
                        v
                  +-------+--------+
                  | GitHub Actions |
                  |   CD Workflow  |
                  +-------+--------+
                        |
                  Flyway Migrate
                        |
                        v
+------------------+   TLS/JDBC   +--------------------+------------------+
| Observability &  | <----------- |  Neon PostgreSQL (managed)            |
|   Verification   |              | - flyway_schema_history               |
| (Console/SQL)    |              | - users table                         |
+------------------+   +--------------------------------------+
```

## Technology Stack

- **PostgreSQL (Neon):** Fully managed, serverless PostgreSQL with branching, automatic scaling, and strong security defaults.
- **Flyway:** Simple, SQL-first migrations, checksums, validation, and widely adopted in enterprises.
- **GitHub Actions:** Native to GitHub repos, powerful marketplace actions, OIDC support, and fine-grained environment protections.
- **SQLFluff:** Enforces SQL style and common anti-pattern checks.
- **Gitleaks:** Fast, accurate secret scanner integrated in CI.
- **Docker:** Ensures consistent local tooling and CI parity.

## Why These Technologies Were Chosen

### PostgreSQL (Neon)
- Fully managed with automatic scaling and database branching.
- Reduces operational overhead while offering native PostgreSQL compatibility.

### Flyway
- SQL-first philosophy matches the team’s workflow.
- Faster onboarding with fewer moving parts.
- Validate/info workflow aligns with GitHub Actions simplicity.

### GitHub Actions
- Native integration with GitHub repository, permissions, and code review.
- Lower maintenance compared to managing Jenkins controllers/agents.

## Security Considerations

- **Secrets stored in GitHub Encrypted Secrets:** FLYWAY_URL, FLYWAY_USER, FLYWAY_PASSWORD.
- **Gitleaks blocks merging** when hardcoded credentials or tokens are detected.
- **Flyway uses a least privilege database account** (schema change only for the target database).
- **Read-only operations (info/validate) in CI;** write (migrate) only in CD with manual approval.
- **Artifact redaction** to avoid leaking connection strings.

## CI Pipeline Design

### Triggers
- **Trigger:** Push and/or pull_request targeting main or feature branches.

### Stages
1. Checkout repository.
2. Secret scanning with Gitleaks.
3. SQL linting with SQLFluff.
4. Migration naming validation (regex `V[0-9]+__name.sql`).
5. Flyway info (read-only) to display state.
6. Flyway validate to ensure checksums and ordering are correct.
7. Upload artifacts (reports, logs).

## CD Pipeline Design

### Trigger
- **Trigger:** `workflow_dispatch` (manual), restricted to maintainers and protected environments.

### Stages
1. Flyway info (pre-check).
2. Flyway validate (gate).
3. Flyway migrate (apply changes).
4. Flyway info after deployment (evidence).
5. Upload artifacts (logs, final state).

## Challenges Faced During Implementation

- **Naming Convention Discipline:** Ensuring consistent V# and descriptive names to avoid out-of-order issues.
- **Rollback Intent:** Choosing between Flyway “undo” versus forward inverse migration; opted for forward inverse (V3) for auditability.
- **SQLFluff Configuration:** Balancing strictness to avoid noisy CI while catching meaningful issues.
- **Secrets Scoping:** Ensuring credentials are only available to the correct workflows and environments.

## Conclusion

The repository `assignment02-opstree-saiif` implements an industry-grade, secure database migration pipeline. It demonstrates end-to-end DevSecOps practices, including secret scanning, SQL linting, rigorous validation, manual gated deployment, and auditable evidence via `flyway_schema_history` and the resulting table schema. The chosen stack—Neon, Flyway, GitHub Actions, SQLFluff, Gitleaks—balances simplicity, security, and maintainability, making it a robust baseline for startup and enterprise teams alike.

## References and Further Reading

- [Flyway Documentation](https://documentation.red-gate.com)
- [SQLFluff](https://docs.sqlfluff.com)
- [Gitleaks](https://github.com)
- [Neon PostgreSQL](https://neon.tech)
- [GitHub Actions](https://docs.github.com)
- [PostgreSQL Documentation](https://postgresql.org)