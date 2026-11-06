# Reserved Migration Numbers

**005** and **006** are reserved for `feature/multi-platform`.

- `005_platform_connections.sql` — new `platform_connections` table
- `006_workflows_platform.sql` — adds `platform`, `platform_connection_id`, `source_id` to `workflows`

If `master` needs a new migration during the feature/multi-platform window, use **007+**.
