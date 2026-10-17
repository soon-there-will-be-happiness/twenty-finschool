# Partner instance template

```bash
# from crm/twenty/finschool
./scripts/new-partner.sh mypartner crm-mypartner.finschool.pro 3101 3199
cd partners/mypartner
cp .env.example .env   # if script did not
# edit secrets
docker compose -f ../../compose/docker-compose.yml -f docker-compose.override.yml --env-file .env up -d
```
