# Pi Customizations

Pi user-level customizations added in this setup.

## Contents

- `extensions/response-timing.ts` — shows request elapsed time, generated output tokens, end-to-end TPS, and answer timestamp after a response settles.
- `config/enabled-models.json` — model IDs to merge into `enabledModels` in `~/.pi/agent/settings.json`.

## Install the extension

```sh
pi install git:github.com/ghyen/pi-customizations
```

Then run `/reload` or restart Pi.

## Enable the model IDs

Merge the IDs in `config/enabled-models.json` into the existing `enabledModels` array. This only enables model selection; the provider, authentication, and model catalog must also be available in the target environment.

## Security

This repository does not include `auth.json`, provider headers, session transcripts, or generated model caches. Authenticate separately in each environment with `/login`.
