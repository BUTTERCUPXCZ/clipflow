-- Single local user (spec Phase 2: no login). Id must match LOCAL_USER_ID in src/common/current-user.ts.
INSERT INTO "users" ("id", "display_name")
VALUES ('00000000-0000-4000-8000-000000000001', 'Local user')
ON CONFLICT ("id") DO NOTHING;
