# FinSchool packaging layer

Всё, что относится к деплою и партнёрам, лежит здесь.
Правки продукта Twenty — в `packages/twenty-front` / `packages/twenty-server` на ветке `finschool/main`.

| Путь | Назначение |
|------|------------|
| `docker/` | Образ `finschool/twenty` |
| `compose/` | Базовый Compose (server/worker/db/redis + sso-bridge) |
| `sso-bridge/` | Trusted SSO без Organization Key |
| `partners/` | Инстансы: `_template`, `hq`, далее партнёры |
| `caddy/` | TLS site-блоки |
| `overlay/` | Тема, feature-flags, копируются в образ |
| `scripts/` | build / new-partner / sync-upstream |

## Feature flags (заготовка)

Файл `overlay/feature-flags/flags.json` монтируется или вшивается в образ.
Партнёрский `.env` может переопределять через `FINSCHOOL_FEATURE_*`.

Пока флаги не вырезают UI — только контракт. Реализация отключения — следующие коммиты в `twenty-front`.
