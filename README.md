# Database Release Pipeline — Standard Operating Procedure

> **Scope:** This SOP covers **database migration automation only** using Flyway, Neon PostgreSQL, and GitHub Actions.  
> The Node.js application is managed separately.

---

## Architecture Overview

```
Developer writes migration script
        ↓
Pushes code to GitHub (main branch)
        ↓
GitHub Actions pipeline triggers
        ↓
┌──────────────────────────────────┐
│  JOB 1 — Lint & Scan             │
│  • Gitleaks secret scan          │
│  • sqlfluff SQL lint             │
└──────────────┬───────────────────┘
               ↓
┌──────────────────────────────────┐
│  JOB 2 — Flyway Validate         │
│  • Normalize JDBC URL            │
│  • flyway validate (read-only)   │
└──────────────┬───────────────────┘
               ↓  (main branch only)
┌──────────────────────────────────┐
│  JOB 3 — Flyway Migrate          │
│  • flyway info (before)          │
│  • flyway migrate                │
│  • flyway info (after)           │
└──────────────────────────────────┘
```

---

## Part 1 — Neon Database Setup

1. Go to [https://neon.tech](https://neon.tech) and create a free account
2. Create a new **Project** and note down:
   - Host: `ep-xxxx.us-east-1.aws.neon.tech`
   - Database: `neondb`
   - Username: `neondb_owner`
   - Password: (shown once — copy it)

3. Your connection string from Neon looks like:
   ```
   postgresql://neondb_owner:YOUR_PASSWORD@ep-xxxx.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
   ```

   > ⚠️ **Important:** Flyway requires JDBC format, NOT the `postgresql://` format above.  
   > The pipeline handles this conversion automatically — see [Part 4](#part-4--github-secrets-setup).

---

## Part 2 — Migration File Structure

```
db/
└── migrations/
    ├── V1__create_users.sql
    └── V2__add_phone_column.sql
```

### Flyway Naming Convention

Every migration file **must** follow this exact pattern:

```
V{version}__{description}.sql
   │              │
   │              └── Underscore separated description
   └── Version number (integer, must be unique and increasing)
```

| File | Version | Description |
|------|---------|-------------|
| `V1__create_users.sql` | 1 | Creates the users table |
| `V2__add_phone_column.sql` | 2 | Adds phone column |

> **Rule:** Never modify a migration file after it has been applied. Flyway tracks checksums — any change to an applied file will cause `validate` to fail and block the pipeline.

---

## Part 3 — Writing Migrations

### V1__create_users.sql

```sql
CREATE TABLE users (
    id         SERIAL PRIMARY KEY,
    name       VARCHAR(100) NOT NULL,
    email      VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### V2__add_phone_column.sql

```sql
ALTER TABLE users
ADD COLUMN phone VARCHAR(20);
```

### Safe Migration Patterns (Expand-and-Contract)

Always prefer **backward-compatible** changes. Follow the 3-phase approach:

**Phase 1 — Expand** *(add new structure, keep old)*
```sql
-- Safe: nullable column, old app still works
ALTER TABLE users ADD COLUMN phone VARCHAR(20);
```

**Phase 2 — Migrate data** *(fill new column)*
```sql
UPDATE users SET phone = 'UNKNOWN' WHERE phone IS NULL;
```

**Phase 3 — Contract** *(remove old structure after app is updated)*
```sql
ALTER TABLE users DROP COLUMN old_field;
```

> **Never** drop columns or rename columns in a single migration that runs at the same time as a deployment. Apps still running the old code will break.

---

## Part 4 — GitHub Secrets Setup

Go to your repository → **Settings → Secrets and Variables → Actions → New repository secret**

Add the following secrets:

| Secret Name | Value | Example |
|-------------|-------|---------|
| `FLYWAY_URL` | Full Neon connection string (pipeline strips incompatible params) | `postgresql://neondb_owner:pass@ep-xxxx.neon.tech/neondb?sslmode=require` |
| `FLYWAY_USER` | Your Neon database username | `neondb_owner` |
| `FLYWAY_PASSWORD` | Your Neon database password | `npg_xxxxxxxx` |
| `TOKEN` | GitHub Personal Access Token (for Gitleaks secret scanning) | `ghp_xxxxxxxx` |

> **Note on `FLYWAY_URL`:** Neon provides `postgresql://` format. The pipeline automatically:
> 1. Converts it to `jdbc:postgresql://` (required by Flyway)
> 2. Strips `channel_binding=require` (a libpq-only parameter that breaks the JDBC driver)

---

## Part 5 — CI/CD Pipeline Breakdown

The pipeline file lives at: `.github/workflows/test_and_migrate.yml`

### Trigger Conditions

| Event | Jobs that run |
|-------|--------------|
| Pull Request to `main` | Lint + Validate only (never touches DB) |
| Push / Merge to `main` | Lint + Validate + Migrate |
| Manual (`workflow_dispatch`) | All jobs |

### Job 1 — Lint & Scan SQL Migrations

```
Runs on: every PR and every push
Purpose: catch issues before any DB contact
```

- **Gitleaks** — scans migration files for accidentally committed secrets (passwords, tokens, keys)
- **sqlfluff** — lints SQL syntax against PostgreSQL dialect

### Job 2 — Flyway Validate

```
Runs on: every PR and every push (after Job 1)
Purpose: confirm migrations are consistent and checksums match
```

Steps:
1. Normalize the JDBC URL (strips incompatible libpq params)
2. Run `flyway validate` — read-only, confirms all applied migrations still match their files

### Job 3 — Flyway Migrate (Production)

```
Runs on: push to main ONLY (skipped on PRs)
Purpose: apply pending migrations to the Neon database
```

Steps:
1. Normalize JDBC URL
2. `flyway info` — shows pending migrations before applying (audit trail)
3. `flyway migrate` — applies all pending scripts in version order
4. `flyway info` — confirms final state after migration (runs even on failure for debugging)

### Concurrency Guard

```yaml
concurrency:
  group: db-release-${{ github.ref }}
  cancel-in-progress: false
```

Prevents two migration runs from overlapping on the same branch. `cancel-in-progress: false` means an in-flight migration is **never** killed mid-run.

---

## Part 6 — Rollback Strategy

### Option 1 — Write a new migration (preferred)

```sql
-- V3__rollback_phone_column.sql
ALTER TABLE users DROP COLUMN phone;
```

This is the safest approach — maintains full migration history.

### Option 2 — Neon Point-in-Time Restore

Neon supports database branching and restore:
1. Go to Neon Console → **Branches**
2. Select the branch and choose **Restore to point in time**
3. Pick a timestamp before the migration ran

> Use Neon restore only in emergencies — it affects all data, not just schema.

---

## Part 7 — Running Flyway Locally (Optional)

To test migrations locally before pushing:

```bash
docker run --rm \
  -v "$(pwd)/db/migrations:/flyway/migrations" \
  flyway/flyway:latest \
  -url="jdbc:postgresql://ep-xxxx.neon.tech/neondb?sslmode=require" \
  -user="neondb_owner" \
  -password="YOUR_PASSWORD" \
  info
```

Replace `info` with `validate` or `migrate` as needed.

---

## Part 8 — Interview Talking Points

### What is this pipeline doing?

> *"Developers write version-controlled SQL migration scripts using Flyway's naming convention. When code is pushed, GitHub Actions first scans the files for secrets and lints the SQL syntax. It then runs `flyway validate` to confirm all previously applied migrations are intact. On merge to main, `flyway migrate` applies any pending scripts to the Neon PostgreSQL database. The pipeline ensures no migration runs without passing validation first, and PRs can never touch the production database."*

### Why Flyway?

> *"Flyway is SQL-first, lightweight, and has zero learning curve for anyone who knows SQL. It tracks applied migrations in a `flyway_schema_history` table and uses checksums to detect tampering. It integrates cleanly into any CI/CD pipeline via CLI or Docker."*

### Why version-controlled migrations?

> *"Version-controlled migrations give you auditability — you can see exactly what changed, when, and who wrote it. They're reproducible across environments (dev, staging, prod) and make rollback planning straightforward."*

### Why separate validate and migrate jobs?

> *"Validate is a read-only check — it's safe to run on every PR to catch broken migrations early, before they reach production. Migrate actually changes the database, so it's gated behind an environment approval and only runs on the main branch. This separation prevents accidental writes from PR branches."*

### What happens if a migration file is modified after being applied?

> *"Flyway stores a checksum of every applied migration. On the next `validate` or `migrate` run, if the checksum doesn't match, Flyway throws an error and stops. The pipeline fails and nothing proceeds to production. This is an intentional safeguard — migration files are immutable once applied."*

---

## Part 9 — Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `No Flyway database plugin found` | URL missing `jdbc:` prefix or contains unsupported params | The pipeline normalizes this automatically. Check `FLYWAY_URL` secret format. |
| `No locations configured` | Mount path mismatch in Docker command | Migrations must be in `db/migrations/` — mounted to `/flyway/migrations` |
| `Validate failed — checksum mismatch` | A migration file was edited after being applied | Never modify applied migrations. Write a new version instead. |
| `curl: 404` on tarball install | Flyway tarball not available on Maven Central for v10+ | Pipeline uses the official `flyway/flyway` Docker image instead |
| Pipeline runs on PR but shouldn't migrate | Missing `if:` condition on migrate job | Migrate job has `if: github.event_name != 'pull_request'` guard |
