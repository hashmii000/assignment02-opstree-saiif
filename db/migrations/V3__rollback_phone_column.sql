-- ============================================================
-- Rollback Migration: Undo V2__add_phone_column.sql
-- Version: V3
-- Description: Removes the phone column added in V2
--
-- HOW TO USE:
--   1. Commit this file to main
--   2. Go to GitHub Actions → "DB Rollback — Manual Trigger"
--   3. Click "Run workflow", enter V3 and CONFIRM
--   4. The pipeline applies this migration, reverting the schema
--
-- IMPORTANT: Never delete or modify this file after it runs.
-- ============================================================

ALTER TABLE users
DROP COLUMN IF EXISTS phone;
