# Identity Tokens (AM-07)

The Blueprint uses placeholder tokens. Since `npm` and `vsce` reject angle-bracket
tokens in `name`/`publisher` fields, the following neutral working values are used
throughout the codebase:

| Blueprint Token | Working Value | Used In |
|---|---|---|
| `<project-slug>` | `dev-extension` | `package.json#name`, `EXTENSION_ID` in `ids.ts` |
| `<publisher-id>` | `dev-publisher` | `package.json#publisher` |
| `<extension-id>` | `dev-extension` | All `contributes.*` prefixes, command IDs, view IDs, config keys |
| `<display-name>` | `Dev Display Name` | `package.json#displayName` |
| `<license>` | `UNLICENSED` | `package.json#license` |

## Find/Replace Map for Owner

To replace with real values, find and replace these exact strings:

```
dev-extension    → your-chosen-slug (in package.json name, all contributes.* prefixes, ids.ts EXTENSION_ID)
dev-publisher    → your-marketplace-publisher-id
Dev Display Name → Your Extension Display Name
UNLICENSED       → your-chosen-license (e.g. MIT)
```

All command IDs, view IDs, and configuration keys are derived from `EXTENSION_ID`
in `src/host/ids.ts`. Changing the constant there and `package.json` is sufficient.
