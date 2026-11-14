// src/host/ids.ts — AM-07: Single source of IDs derived from EXTENSION_ID

export const EXTENSION_ID = "gitflux";

export const COMMAND_OPEN = `${EXTENSION_ID}.open` as const;
export const COMMAND_OPEN_FOR_SELECTION = `${EXTENSION_ID}.openForSelection` as const;

export const REGISTERED_COMMANDS = [COMMAND_OPEN, COMMAND_OPEN_FOR_SELECTION] as const;

export const VIEW_ID = `${EXTENSION_ID}.panel` as const;

export const CONFIG_SHELL = `${EXTENSION_ID}.shell` as const;
export const CONFIG_WORKING_HOURS_START = `${EXTENSION_ID}.workingHours.start` as const;
export const CONFIG_WORKING_HOURS_END = `${EXTENSION_ID}.workingHours.end` as const;
export const CONFIG_PUSH_DEFAULT_ENABLED = `${EXTENSION_ID}.push.defaultEnabled` as const;
export const CONFIG_TERMINAL_AUTO_RUN = `${EXTENSION_ID}.terminal.autoRun` as const;

export const CONFIG_KEYS = [
  CONFIG_SHELL,
  CONFIG_WORKING_HOURS_START,
  CONFIG_WORKING_HOURS_END,
  CONFIG_PUSH_DEFAULT_ENABLED,
  CONFIG_TERMINAL_AUTO_RUN,
] as const;

export const OUTPUT_CHANNEL_NAME = "Commit With Custom Date";
