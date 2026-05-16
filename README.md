# Standard Operating Procedure (SOP)
## Database Release Management & CI/CD Automation

---

| Field | Value |
|-------|-------|
| **Document Title** | Database Release Management SOP |
| **Version** | 1.0 |
| **Prepared By** | DevOps / Platform Engineering |
| **Purpose** | Standardized Database Release Automation |
| **Scope** | Database schema deployment & migration lifecycle |
| **Target Environment** | PostgreSQL (Neon) |
| **Migration Tool** | Flyway |
| **CI/CD Platform** | GitHub Actions |

---

## 1. Executive Summary

The purpose of this Standard Operating Procedure is to establish a secure, automated, and repeatable database release process using CI/CD automation and migration governance. Traditional database deployments rely heavily on manual SQL execution, verbal coordination between engineers, and undocumented schema changes — all of which introduce risk, inconsistency, and audit gaps. This SOP addresses those problems directly.

All database schema changes governed by this process are version-controlled, validated before deployment, consistently applied across environments, fully auditable, and rollback-aware. The architecture described here minimizes manual operational effort while improving deployment reliability and significantly reducing the probability of production incidents caused by bad or out-of-order migrations.

---

## 2. Objectives

The database release strategy is designed to solve a specific operational problem: schema changes in production databases are high-risk, and the risk compounds when the process is manual. The primary goal is to remove human hands from the deployment step entirely — not because engineers are unreliable, but because automation is more consistent, faster, and produces a verifiable audit trail.

Secondary objectives include improving engineering delivery speed by removing the bottleneck of coordinated manual releases, establishing a governance model for migration approval, and laying the foundation for multi-environment (staging + production) deployment flows that scale with the team.

---

## 3. Current Challenges in Traditional Database Releases

Before designing this solution, the team reviewed common failure patterns in traditional database release processes. The problems are well-understood across the industry, and this project is not unique in experiencing them.

Manual SQL execution is the most common source of production database incidents. Engineers running scripts directly against a live database have no automated safety net — a script executed in the wrong environment, or against the wrong database, can cause irreversible data loss. Even careful engineers make mistakes under time pressure.

Untracked schema changes create environment drift. When developers run ad-hoc `ALTER TABLE` statements locally or in staging without committing them to source control, the production database quickly diverges from what the codebase expects. These inconsistencies are difficult to detect and even harder to fix retroactively.

The absence of migration versioning means there is no reliable way to know which changes have been applied to which environment. Teams resort to spreadsheets, shared documents, or tribal knowledge — none of which scale. Without ordering guarantees, migrations applied out of sequence can silently break dependent structures.

Missing rollback planning is a risk that only becomes visible during an incident. Teams discover they have no documented recovery path at exactly the moment they need one most.

| Challenge | Impact |
|-----------|--------|
| Manual SQL execution | Human error risk |
| Untracked schema changes | Environment inconsistency |
| No migration versioning | Deployment confusion |
| Missing rollback planning | Recovery delays |
| No automated validation | Production instability |
| Inconsistent deployment process | Operational inefficiency |
| Lack of release governance | Compliance & audit concerns |

---

## 4. Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Source Control | GitHub | Version control & collaboration |
| CI/CD Platform | GitHub Actions | Automated deployment pipeline |
| Database | PostgreSQL (Neon) | Managed relational database |
| Migration Tool | Flyway | Database schema migration management |
| Secret Scanning | Gitleaks | Detect secrets in migration files |
| SQL Linting | sqlfluff | Validate SQL syntax before DB contact |

---

## 5. Tool Selection — Migration Tool Evaluation

Before committing to Flyway, the team evaluated several migration tools against the specific requirements of this project. The evaluation criteria were: SQL-first workflow, ease of CI/CD integration, community maturity, operational simplicity, and compatibility with Neon PostgreSQL.

**Liquibase** was the first tool considered. It is the most feature-complete migration tool available, supporting XML, YAML, JSON, and SQL formats. For enterprise environments with complex multi-database setups and rollback requirements baked into the tooling itself, Liquibase is a strong choice. However, for this project, the XML/YAML abstraction layer added unnecessary complexity. The team's migration scripts are pure SQL, and wrapping them in Liquibase changesets would have created more overhead than value. Liquibase Community also has limitations around certain rollback operations that require the paid Pro edition.

**Alembic** is Python-native and tightly integrated with SQLAlchemy. It is the right tool when the application is built in Python and already uses SQLAlchemy's ORM. Since this project runs on Node.js, Alembic would have introduced a Python dependency purely for migration management — an awkward coupling that increases complexity without any benefit.

**node-pg-migrate** and similar Node.js-native tools were considered because the application stack is JavaScript. These tools allow migrations to be written in JavaScript, which might seem natural. However, mixing application logic with schema management creates coupling that is difficult to maintain. SQL migrations should be readable and reviewable by DBAs who may not be JavaScript developers. Writing migrations as JavaScript functions also obscures what the migration actually does at the SQL level.

**Custom migration scripts** — simple numbered `.sql` files executed by a shell script in CI — are used by many teams and are worth considering for their simplicity. The limitation is that they require building the state tracking, checksum validation, and ordering logic yourself. These are solved problems, and reimplementing them introduces maintenance burden and risk.

**Flyway** emerged as the right tool for this project after evaluating the alternatives. It is SQL-first (migrations are plain `.sql` files), lightweight, and has no runtime dependency on the application stack. It integrates with CI/CD pipelines through a command-line interface or Docker image, maintains its own state tracking table in the database, and validates checksums of applied migrations to detect tampering. It does exactly what this project needs, with no unnecessary abstraction.

---

## 6. Why Flyway

Flyway's SQL-first approach means that every migration is a plain `.sql` file that any engineer or DBA can read and review without learning a tool-specific syntax. The migration files are committed alongside application code in the same repository, which means every schema change has a code review, a commit author, a timestamp, and a deploy history.

The versioning convention is strict and simple. Files must follow the format `V{version}__{description}.sql` — for example `V1__create_users.sql` or `V2__add_phone_column.sql`. Flyway reads the version number to determine execution order and will refuse to run migrations out of sequence. Once a migration is applied, Flyway records its checksum in the `flyway_schema_history` table. If the file is subsequently modified, the next `validate` or `migrate` call will detect the checksum mismatch and fail immediately, before any changes reach the database.

The Docker distribution (`flyway/flyway`) makes CI/CD integration straightforward. There is no installation step, no dependency on the runner's package manager, and no version availability issue. The pipeline mounts the `migrations/` directory into the container and executes the desired command — `validate`, `info`, or `migrate` — with the connection details passed as environment variables.

---

## 7. Pipeline Architecture

The CI/CD pipeline is defined in `.github/workflows/test_and_migrate.yml` and consists of four jobs that execute in sequence. The design separates validation from deployment, and ensures that pull requests can never write to the production database.

```
Developer writes migration script
        ↓
Pushes code to GitHub
        ↓
GitHub Actions pipeline triggers
        ↓
┌──────────────────────────────────┐
│  JOB 1 — Lint & Scan             │
│  • Gitleaks secret scan          │
│  • sqlfluff SQL syntax lint      │
└──────────────┬───────────────────┘
               ↓
┌──────────────────────────────────┐
│  JOB 2 — Flyway Validate         │
│  • Normalize JDBC URL            │
│  • flyway validate (read-only)   │
└──────────────┬───────────────────┘
               ↓  (main branch push only)
┌──────────────────────────────────┐
│  JOB 3 — Flyway Migrate          │
│  • flyway info  (before)         │
│  • flyway migrate                │
│  • flyway info  (after)          │
└──────────────────────────────────┘
               ↓  (on any failure)
┌──────────────────────────────────┐
│  JOB 4 — Failure Notification    │
│  • Log branch, actor, run URL    │
└──────────────────────────────────┘
```

### Trigger Conditions

| Event | Jobs Executed |
|-------|--------------|
| Pull Request to `main` | Lint & Scan → Validate only |
| Push / Merge to `main` | Lint & Scan → Validate → Migrate |
| Manual (`workflow_dispatch`) | All jobs |

The separation of validate and migrate is intentional. `flyway validate` is read-only and safe to run on every pull request — it gives developers fast feedback on whether their migration files are consistent before the code is merged. `flyway migrate` is destructive in the sense that it permanently changes the database schema, so it is gated behind a branch check (`github.ref == 'refs/heads/main'`) and a GitHub Environment approval gate.

### Concurrency Guard

The pipeline uses GitHub Actions' `concurrency` configuration to prevent two migration runs from overlapping on the same branch. `cancel-in-progress` is set to `false`, which means an in-flight migration is never killed mid-execution. Cancelling a migration partway through could leave the database in a partially-migrated state.

---

## 8. GitHub Secrets Configuration

Go to your repository → **Settings → Secrets and Variables → Actions → New repository secret**

| Secret Name | Description | Example Format |
|-------------|-------------|---------------|
| `FLYWAY_URL` | Neon connection string | `postgresql://user:pass@ep-xxxx.neon.tech/neondb?sslmode=require` |
| `FLYWAY_USER` | Database username | `neondb_owner` |
| `FLYWAY_PASSWORD` | Database password | `npg_xxxxxxxxxx` |
| `TOKEN` | GitHub PAT for Gitleaks | `ghp_xxxxxxxxxx` |

**Important — URL format:** Neon provides connection strings in `postgresql://` format. The PostgreSQL JDBC driver used by Flyway requires `jdbc:postgresql://` format. Additionally, Neon appends `channel_binding=require` to its connection strings, which is a `libpq`-only parameter that the JDBC driver does not recognise and will reject. The pipeline handles both conversions automatically in the "Normalize JDBC URL" step before any Flyway command runs.

---

## 9. Migration File Structure

```
db/
└── migrations/
    ├── V1__create_users.sql
    └── V2__add_phone_column.sql
```

### Naming Convention

```
V{version}__{description}.sql
```

Every migration file must follow this format exactly. The version number must be a unique integer. The double underscore (`__`) separator is required by Flyway. The description is free-form and should describe what the migration does in plain language.

### Immutability Rule

Once a migration has been applied to any environment, the file must never be modified. Flyway stores a checksum of each applied migration. If the file content changes, the checksum no longer matches and Flyway will refuse to proceed. The correct way to undo or modify an applied migration is to write a new migration script that makes the desired change.

---

## 10. Safe Migration Patterns (Expand-and-Contract)

Database migrations carry more risk than application deployments because they are difficult to reverse quickly. The expand-and-contract pattern reduces this risk by splitting breaking schema changes into three separate, backward-compatible phases that can be deployed independently.

**Phase 1 — Expand.** Add new structures without removing old ones. The running application continues to use the old column while the new one is available. New columns should be nullable so that existing rows do not require immediate data migration.

```sql
-- V3__add_phone_column.sql
ALTER TABLE users ADD COLUMN phone VARCHAR(20);
```

**Phase 2 — Migrate data.** Once the application is deployed and writing to both old and new structures, backfill the existing rows.

```sql
-- V4__backfill_phone_defaults.sql
UPDATE users SET phone = 'UNKNOWN' WHERE phone IS NULL;
```

**Phase 3 — Contract.** After confirming that no part of the application reads from the old structure, remove it in a final migration.

```sql
-- V5__drop_old_phone_field.sql
ALTER TABLE users DROP COLUMN old_phone;
```

Never combine Phase 1 and Phase 3 into a single migration that runs at the same time as an application deployment. Applications still on the old version will break if a column they depend on is removed.

---

## 11. Neon Database Setup

Neon is a serverless PostgreSQL provider. Create a free account at [https://neon.tech](https://neon.tech), create a new project, and note down the connection details (host, database name, username, and password). These values map directly to the GitHub Secrets described in Part 8.

Neon supports database **branching**, which is particularly useful for this workflow. A production branch holds the live schema. A develop or staging branch can be created from a point-in-time snapshot of production and used for testing migrations before they reach the main branch. This eliminates the need for a separate staging database instance.

---

## 12. Running Flyway Locally

To validate or test migrations locally without triggering the CI pipeline, use the official Flyway Docker image. This is the same method the CI pipeline uses, so the results are identical.

```bash
# Check migration status
docker run --rm \
  -v "$(pwd)/db/migrations:/flyway/migrations" \
  flyway/flyway:latest \
  -url="jdbc:postgresql://ep-xxxx.neon.tech/neondb?sslmode=require" \
  -user="neondb_owner" \
  -password="YOUR_PASSWORD" \
  info

# Validate checksums
docker run --rm \
  -v "$(pwd)/db/migrations:/flyway/migrations" \
  flyway/flyway:latest \
  -url="jdbc:postgresql://ep-xxxx.neon.tech/neondb?sslmode=require" \
  -user="neondb_owner" \
  -password="YOUR_PASSWORD" \
  validate

# Apply migrations
docker run --rm \
  -v "$(pwd)/db/migrations:/flyway/migrations" \
  flyway/flyway:latest \
  -url="jdbc:postgresql://ep-xxxx.neon.tech/neondb?sslmode=require" \
  -user="neondb_owner" \
  -password="YOUR_PASSWORD" \
  migrate
```

Note the volume mount path: the local `db/migrations/` directory maps to `/flyway/migrations` inside the container. Using `/flyway/sql` was the old convention and produces a deprecation warning in Flyway 10+.

---

## 13. Rollback Strategy

**Option 1 — Forward migration (preferred).** Write a new migration that reverses the change. This maintains the full migration history and is always safe.

```sql
-- V5__revert_phone_column.sql
ALTER TABLE users DROP COLUMN phone;
```

**Option 2 — Neon point-in-time restore.** Neon supports restoring a database branch to any point in time within the retention window. This is an emergency option — it restores all data, not just schema, and should only be used when a forward migration is not feasible. To use: Neon Console → Branches → select the branch → Restore to point in time.

**Option 3 — Neon branch swap.** Create a branch from a pre-migration snapshot, validate it, and redirect the application connection string to the branch. This provides a fast switchover without waiting for a restore operation.

---

## 14. Troubleshooting

| Error | Cause | Resolution |
|-------|-------|-----------|
| `No Flyway database plugin found` | URL in wrong format or contains unsupported JDBC params | Pipeline normalizes automatically. Verify `FLYWAY_URL` secret is the full Neon connection string. |
| `No locations configured` | Volume mount path mismatch | Ensure `db/migrations/` directory exists and is mounted to `/flyway/migrations` |
| `Validate failed — checksum mismatch` | Migration file was modified after being applied | Never edit applied migrations. Write a new version script instead. |
| `curl: 404` on tarball download | Flyway 10+ tarball not on Maven Central | Pipeline uses official Docker image — no tarball download needed. |
| `channel_binding` error | libpq parameter in JDBC URL | Pipeline strips `channel_binding=require` in normalization step. |
| Pipeline runs migrate on PR | Missing branch guard on migrate job | Migrate job has `if: github.event_name != 'pull_request'` condition. |

---

## 15. Interview Reference

**On tool selection:**
> "We evaluated Liquibase, Alembic, node-pg-migrate, and custom shell scripts before selecting Flyway. Liquibase was the main contender but added XML abstraction overhead we didn't need. Alembic is Python-native and we're on Node.js. Flyway gave us SQL-first migrations, checksum validation, clean CI/CD integration via Docker, and no application-stack dependency — exactly what the project required."

**On the pipeline design:**
> "The pipeline separates validation from deployment deliberately. Flyway validate is read-only and runs on every pull request so developers get immediate feedback before merge. Flyway migrate only runs on main branch pushes and is gated behind a GitHub Environment approval. This means a pull request can never touch the production database, no matter what the migration file contains."

**On migration immutability:**
> "Flyway stores a checksum of every applied migration in the flyway_schema_history table. If you modify a migration file after it's been applied — even a single whitespace change — the checksum will not match and Flyway will fail before executing anything. This is a deliberate safeguard. The correct pattern is always to write a new migration that makes the corrective change."

**On the expand-and-contract pattern:**
> "We use expand-and-contract to avoid coordinating database deployments with application deployments. In Phase 1 we add new columns as nullable — the old application still works. In Phase 2 we backfill data. In Phase 3, after the new application version is stable, we remove the deprecated column. This pattern eliminates the need for maintenance windows and significantly reduces rollback risk."
