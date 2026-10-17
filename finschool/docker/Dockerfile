# FinSchool Twenty image — stock upstream + FinSchool overlay.
# When front/server patches land, switch to a source build stage.
ARG UPSTREAM_IMAGE=twentycrm/twenty
ARG UPSTREAM_TAG=latest
FROM ${UPSTREAM_IMAGE}:${UPSTREAM_TAG}

LABEL org.opencontainers.image.title="finschool-twenty" \
      org.opencontainers.image.source="https://github.com/twentyhq/twenty" \
      org.opencontainers.image.vendor="FinSchool"

USER root
COPY overlay/feature-flags /finschool/feature-flags
COPY overlay/theme /finschool/theme
COPY sso-bridge /finschool/sso-bridge
USER 1000
