-- Typed rules do not use condition_json or action; make them optional
ALTER TABLE governance.policy_rules
  ALTER COLUMN condition_json DROP NOT NULL,
  ALTER COLUMN action         DROP NOT NULL;
