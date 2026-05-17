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

This document covers how database schema changes are managed, validated, and deployed in this project. The short version: no one runs SQL scripts manually against production anymore. Everything goes through GitHub Actions.

The goal was to make database deployments as boring and repeatable as possible same process every time, no surprises.

---

## 2. Objectives

The main thing we wanted to fix was the "someone ran the wrong script in prod" problem. Every schema change should be version-controlled, reviewed, and deployed automatically.

Secondary goals include making rollbacks less stressful, keeping all environments in sync, and having something useful to show in audits.

---

## 3. Why Manual Releases Break

Most database incidents aren't caused by bad SQL they're caused by good SQL run at the wrong time, in the wrong environment, or in the wrong order. Manual processes are just too easy to get wrong.

| Challenge | Impact |
|-----------|--------|
| Manual SQL execution | Human error risk |
| Untracked schema changes | Environment inconsistency |
| No migration versioning | Deployment confusion |
| Missing rollback planning | Recovery delays |
| No automated validation | Production instability |

---

## 4. Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Source Control | GitHub | Version control & collaboration |
| CI/CD Platform | GitHub Actions | Automated deployment pipeline |
| Database | PostgreSQL (Neon) | Managed relational database |
| Migration Tool | Flyway | Schema migration management |
| Secret Scanning | Gitleaks | Detect secrets in `.sql` files |
| SQL Linting | sqlfluff | Catch syntax errors before DB contact |

---

## 5. Tool Selection — Why Flyway

Before picking Flyway, we looked at a few other options. The two main industry standards are Flyway and Liquibase, but we also evaluated stack-specific tools.

### Flyway vs. Liquibase
**Liquibase** is the heavyweight contender. It’s incredibly powerful, supporting XML, YAML, JSON, and SQL formats, and it has built-in rollback capabilities even in its free version. 

However, we chose **Flyway** over Liquibase for three main reasons:
1. **Simplicity:** Flyway is strictly SQL-first. Liquibase's flexibility (XML/YAML) often leads to unnecessary abstraction. When a DBA needs to review a migration, plain `.sql` is always better than XML tags.
2. **Learning Curve:** Flyway requires zero new syntax to learn. If you know SQL, you know Flyway.
3. **CI/CD Fit:** Flyway’s CLI and Docker image are incredibly lightweight, making it frictionless to drop into GitHub Actions without heavy Java dependencies.

### Other Tools Evaluated
**Alembic** is great — if you're on Python. We're on Node.js, so pulling in a Python dependency purely for migrations didn't make sense.

**node-pg-migrate** felt like the "obvious" choice given the stack. But mixing JavaScript logic into migration files makes them harder to review and less portable. A DBA shouldn't need to understand JavaScript closures to read a migration.

**Custom shell scripts** were considered for their simplicity. They work fine until they don't — and when they break, you're debugging a DIY migration system instead of shipping features.

Ultimately, Flyway won because it validates checksums out-of-the-box, has no runtime dependency on our app stack, and enforces a clean, SQL-only approach.

---

## 6. Pipeline Architecture

```
Developer writes migration script
        ↓
Pushes code to GitHub
        ↓
GitHub Actions triggers
        ↓
┌──────────────────────────────────┐
│  JOB 1 — Lint & Scan             │
│  • Gitleaks secret scan          │
└──────────────┬───────────────────┘
               ↓
┌──────────────────────────────────┐
│  JOB 2 — Flyway Validate         │
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
│  • Logs branch, actor, run URL   │
└──────────────────────────────────┘
```

### When each job runs

| Event | Jobs executed |
|-------|--------------|
| Pull Request to `main` | Lint → Validate only |
| Push / Merge to `main` | Lint → Validate → Migrate |
| Manual (`workflow_dispatch`) | All jobs |

**Why separate validate and migrate?** Validate is read-only safe to run on every PR so developers catch issues early. Migrate actually changes the database, so it only runs after a merge to main. A PR can never touch production, by design.

The pipeline also uses `cancel-in-progress: false` on the concurrency group. A migration that's already running will never be killed halfway through.

---

## 7. GitHub Secrets Setup

Go to: **Repository → Settings → Secrets and Variables → Actions**

| Secret | What to put in it |
|--------|--------------------|
| `FLYWAY_URL` | Full Neon connection string from the Neon console |
| `FLYWAY_USER` | Your Neon database username |
| `FLYWAY_PASSWORD` | Your Neon database password |
| `TOKEN` | GitHub Personal Access Token (for Gitleaks scan) |

**One thing to know about `FLYWAY_URL`:** Neon gives you a `postgresql://` connection string. Flyway needs `jdbc:postgresql://`. Neon also appends `channel_binding=require` which the JDBC driver doesn't understand. The pipeline handles both of these conversions automatically — you just paste in the Neon URL as-is.

---

## 8. Migration Files

```
db/
└── migrations/
    ├── V1__create_users.sql
    ├── V2__add_phone_column.sql
    └── V3__rollback_phone_column.sql
```

### Naming rule

```
V{version}__{description}.sql
```

The version number must be a unique integer. The double underscore is required. Keep descriptions readable `V3__add_audit_log` is better than `V3__changes`.

**Never edit a migration file after it's been applied.** Flyway stores a checksum of every applied migration. If the file changes, the next pipeline run will fail immediately. The fix is always to write a new migration, not edit the old one.

---

## 9. Neon Setup

Sign up at [https://neon.tech](https://neon.tech). Create a project and copy the connection string it goes into the `FLYWAY_URL` secret.

Neon supports **database branching**, which is useful for this workflow. You can create a branch from a production snapshot and test migrations against it before pushing to main. It's effectively a free staging environment with real production data shape.

---

## 10. Writing Safe Migrations (Expand-and-Contract)

The risk with database changes is that the old application version and the new schema version both need to work at the same time during a deployment. The expand-and-contract pattern handles this.

**Phase 1 Expand.** Add new columns as nullable. The old app still works.
```sql
-- V3__add_phone_column.sql
ALTER TABLE users ADD COLUMN phone VARCHAR(20);
```

**Phase 2 Migrate data.** Fill in the new column once the app is deployed.
```sql
-- V4__backfill_phone.sql
UPDATE users SET phone = 'UNKNOWN' WHERE phone IS NULL;
```

**Phase 3 Contract.** Remove old structures after the new app version is stable.
```sql
-- V5__drop_old_phone.sql
ALTER TABLE users DROP COLUMN old_phone;
```

Don't combine phase 1 and phase 3 into a single migration that runs at deploy time. If a rollback is needed, you'll be in a much worse position.

---

## 11. Rollback Strategy

Flyway community edition doesn't have a built-in undo command that's a paid feature. The standard approach is the **forward-rollback**: write a new migration that reverses the previous change.

```sql
-- V3__rollback_phone_column.sql
ALTER TABLE users DROP COLUMN IF EXISTS phone;
```

This keeps the full migration history intact and is safe to apply through the normal pipeline.

For emergencies where a forward migration isn't fast enough, Neon has point-in-time restore. Go to the Neon console → Branches → Restore to point in time. Use this carefully it restores all data, not just schema.

---

## 12. Running Flyway Locally

Same Docker image the CI uses, so results are identical:

```bash
# See what's been applied and what's pending
docker run --rm \
  -v "$(pwd)/db/migrations:/flyway/migrations" \
  flyway/flyway:latest \
  -url="jdbc:postgresql://ep-xxxx.neon.tech/neondb?sslmode=require" \
  -user="neondb_owner" \
  -password="YOUR_PASSWORD" \
  info

# Apply pending migrations
docker run --rm \
  -v "$(pwd)/db/migrations:/flyway/migrations" \
  flyway/flyway:latest \
  -url="jdbc:postgresql://ep-xxxx.neon.tech/neondb?sslmode=require" \
  -user="neondb_owner" \
  -password="YOUR_PASSWORD" \
  migrate
```

---

## 13. Troubleshooting

| Error | What it means | Fix |
|-------|---------------|-----|
| `No Flyway database plugin found` | URL isn't in JDBC format | Pipeline auto-fixes this. Check `FLYWAY_URL` secret is the Neon connection string. |
| `No locations configured` | Migrations folder not found in container | Make sure `db/migrations/` exists and has `.sql` files in it. |
| `Validate failed — checksum mismatch` | A migration file was edited after being applied | Don't edit applied migrations. Write a new one instead. |
| `channel_binding` error | Neon-specific libpq param in JDBC URL | Pipeline strips it automatically in the normalize step. |
| Migrate runs on a PR | Missing branch guard | Check that migrate job has `if: github.event_name != 'pull_request'`. |

---
