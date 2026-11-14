# Identity Tokens (AM-07)

The Blueprint uses placeholder tokens. During initial development, neutral working values were used per AM-07. The production identity, licensing, and repository metadata have now been fully applied across the project:

| Blueprint Token | Production Value | Used In |
|---|---|---|
| `<project-slug>` | `gitflux` | `package.json#name`, `package-lock.json`, `EXTENSION_ID` in `ids.ts` |
| `<publisher-id>` | `advaetuc` | `package.json#publisher` |
| `<extension-id>` | `gitflux` | All `contributes.*` prefixes, command IDs, view IDs, config keys |
| `<display-name>` | `GitFlux` | `package.json#displayName`, `README.md` |
| `<license>` | `MIT` | `package.json#license`, `LICENSE`, `package-lock.json` |
| `<repository>` | `https://github.com/advaetuc/GitFlux.git` | `package.json#repository` |

All command IDs, view IDs, and configuration keys are derived from `EXTENSION_ID` in `src/host/ids.ts`.
