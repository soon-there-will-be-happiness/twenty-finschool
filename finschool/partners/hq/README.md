# HQ — crm.finschool.pro

Текущий прод на mvlad: `/opt/twenty` (пока ещё `twentycrm/twenty:latest`).

Миграция на образ форка:

1. Собрать `finschool/twenty:local` на mvlad или залить готовый образ.
2. Положить этот каталог / compose рядом с `.env` прода.
3. В `.env`: `FINSCHOOL_TWENTY_IMAGE=finschool/twenty:local` (или digest).
4. `docker compose up -d` без смены volumes `db-data` / `server-local-data`.
