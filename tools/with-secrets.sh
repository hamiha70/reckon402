#!/usr/bin/env bash
# Single source of the Infisical invocation — all recipes call this shim.
exec infisical run --env dev --domain https://secrets.intentralabs.com -- "$@"
