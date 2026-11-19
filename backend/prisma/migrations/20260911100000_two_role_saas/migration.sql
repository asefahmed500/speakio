-- Two-role SaaS model: collapse STUDENT/INSTRUCTOR/SUPER_ADMIN into USER/ADMIN.
-- The remap happens inside the USING clause because the OLD enum cannot store
-- the value 'USER'. The column default must be dropped around the type swap,
-- and the old enum type dropped before the new one takes its name.

CREATE TYPE "Role_new" AS ENUM ('USER', 'ADMIN');

ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;

ALTER TABLE "users" ALTER COLUMN "role" TYPE "Role_new" USING (
  CASE "role"::text
    WHEN 'ADMIN' THEN 'ADMIN'::"Role_new"
    WHEN 'SUPER_ADMIN' THEN 'ADMIN'::"Role_new"
    ELSE 'USER'::"Role_new"
  END
);

ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'USER';

DROP TYPE "Role";

ALTER TYPE "Role_new" RENAME TO "Role";
