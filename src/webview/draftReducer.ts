import type {
  ActionResult,
  CommitDraft,
  HostEnv,
  RepoSnapshot,
  RepoSummary,
  RunStepId,
} from "../shared/protocol";
import type {
  CommitPlan,
  Result,
  ShellKind,
  ShellSetting,
} from "../core/types";
import type { PlanError } from "../core/plan";
import type { PlanWarning } from "../core/warnings";
import { buildCommitPlan } from "../core/plan";
import { planWarnings } from "../core/warnings";
import { renderShell } from "../core/shellRender";
import { localOffsetMinutesAt } from "../core/timestamp";
import { pickTimeInWindow } from "../core/jitter";

export const PREFIX_CHIPS = ["feat:", "fix:", "docs:", "chore:", "refactor:", "test:"] as const;
export type PrefixChip = (typeof PREFIX_CHIPS)[number];

const PREFIX_REGEX = /^(?:feat|fix|docs|chore|refactor|test):\s*/i;

export interface DraftState {
  readonly env: HostEnv;
  readonly repos: readonly RepoSummary[];
  readonly activeRepoId: string;
  readonly snapshot: RepoSnapshot | undefined;
  readonly draft: CommitDraft;
  readonly offsetMode: "local" | "fixed";
  readonly detachedHeadAcknowledged: boolean;
  readonly filterText: string;
  readonly inFlight: boolean;
  readonly currentStep: RunStepId | undefined;
  readonly lastResult: ActionResult | undefined;
  readonly stalePathsNotice: string | undefined;
  readonly plan: Result<CommitPlan, PlanError>;
  readonly warnings: readonly PlanWarning[];
  readonly preview: string;
}

export type DraftAction =
  | { readonly type: "INIT"; readonly env: HostEnv; readonly repos: readonly RepoSummary[]; readonly activeRepoId?: string; readonly snapshot?: RepoSnapshot }
  | { readonly type: "SNAPSHOT"; readonly snapshot: RepoSnapshot }
  | { readonly type: "PRESELECT"; readonly repoId: string; readonly paths: readonly string[]; readonly droppedCount: number }
  | { readonly type: "SET_REPO"; readonly repoId: string }
  | { readonly type: "TOGGLE_PATH"; readonly path: string }
  | { readonly type: "SELECT_ALL_PATHS"; readonly select: boolean }
  | { readonly type: "SET_FILTER"; readonly filterText: string }
  | { readonly type: "SET_DATE"; readonly year: number; readonly month: number; readonly day: number }
  | { readonly type: "SET_TIME"; readonly hour: number; readonly minute: number; readonly second: number }
  | { readonly type: "SET_OFFSET_MODE"; readonly mode: "local" | "fixed"; readonly offsetMinutes?: number }
  | { readonly type: "SET_OFFSET_MINUTES"; readonly offsetMinutes: number }
  | { readonly type: "RANDOM_WORKING_HOURS" }
  | { readonly type: "SET_SUBJECT"; readonly subject: string }
  | { readonly type: "SET_BODY"; readonly body: string }
  | { readonly type: "APPLY_PREFIX_CHIP"; readonly prefix: PrefixChip }
  | { readonly type: "SET_PUSH_ENABLED"; readonly enabled: boolean }
  | { readonly type: "SET_PUSH_REMOTE"; readonly remote: string }
  | { readonly type: "SET_SHELL"; readonly shell: ShellSetting }
  | { readonly type: "SET_DETACHED_ACK"; readonly acknowledged: boolean }
  | { readonly type: "START_RUN"; readonly step?: RunStepId }
  | { readonly type: "PROGRESS"; readonly step: RunStepId; readonly status: "start" | "ok" | "fail" }
  | { readonly type: "RESULT"; readonly result: ActionResult }
  | { readonly type: "DISMISS_STALE_NOTICE" };

export function resolveEffectiveShell(
  draftShell: ShellSetting,
  configShell: ShellSetting,
  detected: string,
): ShellKind | "none" {
  if (draftShell !== "auto") return draftShell;
  if (configShell !== "auto") return configShell;
  if (detected !== "unsupported") return detected as ShellKind;
  return "none";
}

function resolveDefaultRemote(snapshot: RepoSnapshot | undefined): string {
  const remotes = snapshot?.remotes ?? [];
  if (remotes.length === 0) return "";

  const upstream = snapshot?.head.kind === "branch" ? snapshot.head.upstream : undefined;
  if (upstream) {
    let longest = "";
    for (const r of remotes) {
      if (upstream.startsWith(`${r}/`) && r.length > longest.length) {
        longest = r;
      }
    }
    if (longest) return longest;
  }

  if (remotes.includes("origin")) return "origin";
  return remotes[0] ?? "";
}

export function createDefaultDraft(
  repoId: string,
  snapshot: RepoSnapshot | undefined,
  env: HostEnv,
  preselectedPaths: readonly string[] = [],
  now = new Date(),
): CommitDraft {
  const local = {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
    hour: now.getHours(),
    minute: now.getMinutes(),
    second: now.getSeconds(),
  };

  const offsetRes = localOffsetMinutesAt(local);
  const offsetMinutes = offsetRes.ok ? offsetRes.value : 0;
  const remote = resolveDefaultRemote(snapshot);

  return {
    repoId,
    revision: snapshot?.revision ?? 0,
    paths: preselectedPaths,
    message: { subject: "", body: "" },
    when: { local, offsetMinutes },
    push: { enabled: env.pushDefaultEnabled, remote },
    shell: "auto",
  };
}

export function deriveDerivedState(
  snapshot: RepoSnapshot | undefined,
  draft: CommitDraft,
  env: HostEnv,
  nowEpochSeconds = Math.floor(Date.now() / 1000),
): { plan: Result<CommitPlan, PlanError>; warnings: readonly PlanWarning[]; preview: string } {
  if (!snapshot) {
    return {
      plan: { ok: false, error: { code: "BLOCKED", detail: "No repository loaded" } },
      warnings: [],
      preview: "No repository loaded",
    };
  }

  const plan = buildCommitPlan({
    repoRoot: snapshot.repoRoot,
    head: snapshot.head,
    remotes: snapshot.remotes,
    blockers: snapshot.blockers,
    files: snapshot.files,
    selectedPaths: draft.paths,
    message: draft.message,
    when: draft.when,
    push: draft.push,
  });

  const warnings = plan.ok
    ? planWarnings({
        plan: plan.value,
        head: snapshot.head,
        files: snapshot.files,
        headCommitEpochSeconds: snapshot.headCommitEpochSeconds,
        nowEpochSeconds,
      })
    : [];

  let preview: string;
  if (plan.ok) {
    const effective = resolveEffectiveShell(draft.shell, env.shellSetting, env.detectedShell);
    if (effective !== "none") {
      const render = renderShell(plan.value, effective, {
        includeRepoDir: env.includeRepoDirInCopy,
      });
      if (render.ok) {
        preview = render.value.singleLine;
      } else if (render.error.code === "UNSAFE_CHARACTER") {
        preview = `Not allowed in ${effective} commands: ${render.error.character}. Use Run Now or another shell.`;
      } else {
        preview = `Command too long (${String(render.error.length)} / ${String(render.error.limit)} chars). Use Run Now or select fewer files.`;
      }
    } else {
      preview = "Select a shell";
    }
  } else {
    preview = plan.error.detail;
  }

  return { plan, warnings, preview };
}

export const initialEnv: HostEnv = {
  platform: "linux",
  detectedShell: "bash",
  shellSetting: "auto",
  includeRepoDirInCopy: true,
  sendToTerminalAvailable: true,
  workingHours: { start: "09:30", end: "18:30" },
  pushDefaultEnabled: false,
  autoRun: false,
  gitVersionOk: true,
};

export const initialState: DraftState = {
  env: initialEnv,
  repos: [],
  activeRepoId: "",
  snapshot: undefined,
  draft: createDefaultDraft("", undefined, initialEnv),
  offsetMode: "local",
  detachedHeadAcknowledged: false,
  filterText: "",
  inFlight: false,
  currentStep: undefined,
  lastResult: undefined,
  stalePathsNotice: undefined,
  plan: { ok: false, error: { code: "BLOCKED", detail: "Initializing..." } },
  warnings: [],
  preview: "Initializing...",
};

export function draftReducer(state: DraftState, action: DraftAction): DraftState {
  switch (action.type) {
    case "INIT": {
      const activeRepoId = action.activeRepoId ?? (action.repos[0]?.repoId ?? "");
      const snapshot = action.snapshot;
      const draft = createDefaultDraft(activeRepoId, snapshot, action.env);
      const derived = deriveDerivedState(snapshot, draft, action.env);

      return {
        ...state,
        env: action.env,
        repos: action.repos,
        activeRepoId,
        snapshot,
        draft,
        ...derived,
      };
    }

    case "SNAPSHOT": {
      if (state.activeRepoId !== "" && action.snapshot.repoId !== state.activeRepoId) {
        return state;
      }

      const activeRepoId = action.snapshot.repoId;
      const repos = state.repos.some((r) => r.repoId === activeRepoId)
        ? state.repos
        : [...state.repos, { repoId: activeRepoId, name: action.snapshot.name }];

      // Drop selected paths no longer present (§8.4), preserving valid preselected paths
      const currentSelected = state.draft.paths;
      const availableSet = new Set(action.snapshot.files.map((f) => f.path));
      const validPaths = currentSelected.filter((p) => availableSet.has(p));
      const droppedCount = currentSelected.length - validPaths.length;
      const staleNotice =
        droppedCount > 0
          ? `${String(droppedCount)} ${droppedCount === 1 ? "file" : "files"} no longer changed`
          : state.stalePathsNotice;

      const newDraft: CommitDraft = {
        ...state.draft,
        repoId: activeRepoId,
        revision: action.snapshot.revision,
        paths: validPaths,
        push: {
          ...state.draft.push,
          remote: state.draft.push.remote || resolveDefaultRemote(action.snapshot),
        },
      };

      const derived = deriveDerivedState(action.snapshot, newDraft, state.env);
      return {
        ...state,
        activeRepoId,
        repos,
        snapshot: action.snapshot,
        draft: newDraft,
        stalePathsNotice: staleNotice,
        ...derived,
      };
    }

    case "PRESELECT": {
      const activeRepoId = action.repoId;
      const repoChanged = activeRepoId !== state.activeRepoId;
      const snapshot = state.snapshot?.repoId === action.repoId ? state.snapshot : undefined;

      const repos = state.repos.some((r) => r.repoId === action.repoId)
        ? state.repos
        : [...state.repos, { repoId: action.repoId, name: action.repoId.split("/").pop() || action.repoId }];

      const newDraft: CommitDraft = {
        ...(repoChanged ? createDefaultDraft(action.repoId, snapshot, state.env) : state.draft),
        repoId: action.repoId,
        paths: action.paths,
      };
      const staleNotice =
        action.droppedCount > 0
          ? `${String(action.droppedCount)} ${action.droppedCount === 1 ? "file was" : "files were"} dropped from selection (different repo or unchanged)`
          : undefined;

      const derived = deriveDerivedState(snapshot, newDraft, state.env);
      return {
        ...state,
        activeRepoId,
        repos,
        snapshot,
        draft: newDraft,
        stalePathsNotice: staleNotice,
        ...(repoChanged ? { detachedHeadAcknowledged: false } : {}),
        ...derived,
      };
    }

    case "SET_REPO": {
      if (action.repoId === state.activeRepoId) return state;
      const newDraft = createDefaultDraft(action.repoId, undefined, state.env);
      const derived = deriveDerivedState(undefined, newDraft, state.env);
      return {
        ...state,
        activeRepoId: action.repoId,
        snapshot: undefined,
        draft: newDraft,
        stalePathsNotice: undefined,
        detachedHeadAcknowledged: false,
        ...derived,
      };
    }

    case "TOGGLE_PATH": {
      const exists = state.draft.paths.includes(action.path);
      const newPaths = exists
        ? state.draft.paths.filter((p) => p !== action.path)
        : [...state.draft.paths, action.path];
      const newDraft: CommitDraft = { ...state.draft, paths: newPaths };
      const derived = deriveDerivedState(state.snapshot, newDraft, state.env);
      return { ...state, draft: newDraft, ...derived };
    }

    case "SELECT_ALL_PATHS": {
      const newPaths = action.select ? (state.snapshot?.files.map((f) => f.path) ?? []) : [];
      const newDraft: CommitDraft = { ...state.draft, paths: newPaths };
      const derived = deriveDerivedState(state.snapshot, newDraft, state.env);
      return { ...state, draft: newDraft, ...derived };
    }

    case "SET_FILTER": {
      return { ...state, filterText: action.filterText };
    }

    case "SET_DATE": {
      const newLocal = {
        ...state.draft.when.local,
        year: action.year,
        month: action.month,
        day: action.day,
      };

      let newOffset = state.draft.when.offsetMinutes;
      if (state.offsetMode === "local") {
        const offsetRes = localOffsetMinutesAt(newLocal);
        if (offsetRes.ok) {
          newOffset = offsetRes.value;
        }
      }

      const newDraft: CommitDraft = {
        ...state.draft,
        when: { local: newLocal, offsetMinutes: newOffset },
      };
      const derived = deriveDerivedState(state.snapshot, newDraft, state.env);
      return { ...state, draft: newDraft, ...derived };
    }

    case "SET_TIME": {
      const newLocal = {
        ...state.draft.when.local,
        hour: action.hour,
        minute: action.minute,
        second: action.second,
      };

      let newOffset = state.draft.when.offsetMinutes;
      if (state.offsetMode === "local") {
        const offsetRes = localOffsetMinutesAt(newLocal);
        if (offsetRes.ok) {
          newOffset = offsetRes.value;
        }
      }

      const newDraft: CommitDraft = {
        ...state.draft,
        when: { local: newLocal, offsetMinutes: newOffset },
      };
      const derived = deriveDerivedState(state.snapshot, newDraft, state.env);
      return { ...state, draft: newDraft, ...derived };
    }

    case "SET_OFFSET_MODE": {
      let newOffset = state.draft.when.offsetMinutes;
      if (action.mode === "local") {
        const offsetRes = localOffsetMinutesAt(state.draft.when.local);
        if (offsetRes.ok) {
          newOffset = offsetRes.value;
        }
      } else if (action.offsetMinutes !== undefined) {
        newOffset = action.offsetMinutes;
      }
      const newDraft: CommitDraft = {
        ...state.draft,
        when: { ...state.draft.when, offsetMinutes: newOffset },
      };
      const derived = deriveDerivedState(state.snapshot, newDraft, state.env);
      return { ...state, offsetMode: action.mode, draft: newDraft, ...derived };
    }

    case "SET_OFFSET_MINUTES": {
      const newDraft: CommitDraft = {
        ...state.draft,
        when: { ...state.draft.when, offsetMinutes: action.offsetMinutes },
      };
      const derived = deriveDerivedState(state.snapshot, newDraft, state.env);
      return { ...state, offsetMode: "fixed", draft: newDraft, ...derived };
    }

    case "RANDOM_WORKING_HOURS": {
      const [startHStr, startMStr] = state.env.workingHours.start.split(":");
      const [endHStr, endMStr] = state.env.workingHours.end.split(":");
      const startH = parseInt(startHStr ?? "9", 10);
      const startM = parseInt(startMStr ?? "30", 10);
      const endH = parseInt(endHStr ?? "18", 10);
      const endM = parseInt(endMStr ?? "30", 10);

      const startMinutes = startH * 60 + startM;
      const endMinutes = endH * 60 + endM;

      const window = {
        startMinutes,
        endMinutes: endMinutes > startMinutes ? endMinutes : startMinutes + 60,
      };

      const picked = pickTimeInWindow(window, Math.random);
      const newLocal = {
        ...state.draft.when.local,
        hour: picked.hour,
        minute: picked.minute,
        second: picked.second,
      };

      let newOffset = state.draft.when.offsetMinutes;
      if (state.offsetMode === "local") {
        const offsetRes = localOffsetMinutesAt(newLocal);
        if (offsetRes.ok) {
          newOffset = offsetRes.value;
        }
      }

      const newDraft: CommitDraft = {
        ...state.draft,
        when: { local: newLocal, offsetMinutes: newOffset },
      };
      const derived = deriveDerivedState(state.snapshot, newDraft, state.env);
      return { ...state, draft: newDraft, ...derived };
    }

    case "SET_SUBJECT": {
      const newDraft: CommitDraft = {
        ...state.draft,
        message: { ...state.draft.message, subject: action.subject },
      };
      const derived = deriveDerivedState(state.snapshot, newDraft, state.env);
      return { ...state, draft: newDraft, ...derived };
    }

    case "SET_BODY": {
      const newDraft: CommitDraft = {
        ...state.draft,
        message: { ...state.draft.message, body: action.body },
      };
      const derived = deriveDerivedState(state.snapshot, newDraft, state.env);
      return { ...state, draft: newDraft, ...derived };
    }

    case "APPLY_PREFIX_CHIP": {
      const current = state.draft.message.subject;
      let newSubject: string;
      if (PREFIX_REGEX.test(current)) {
        newSubject = `${action.prefix} ${current.replace(PREFIX_REGEX, "")}`;
      } else {
        newSubject = current ? `${action.prefix} ${current}` : `${action.prefix} `;
      }

      const newDraft: CommitDraft = {
        ...state.draft,
        message: { ...state.draft.message, subject: newSubject },
      };
      const derived = deriveDerivedState(state.snapshot, newDraft, state.env);
      return { ...state, draft: newDraft, ...derived };
    }

    case "SET_PUSH_ENABLED": {
      const newDraft: CommitDraft = {
        ...state.draft,
        push: { ...state.draft.push, enabled: action.enabled },
      };
      const derived = deriveDerivedState(state.snapshot, newDraft, state.env);
      return { ...state, draft: newDraft, ...derived };
    }

    case "SET_PUSH_REMOTE": {
      const newDraft: CommitDraft = {
        ...state.draft,
        push: { ...state.draft.push, remote: action.remote },
      };
      const derived = deriveDerivedState(state.snapshot, newDraft, state.env);
      return { ...state, draft: newDraft, ...derived };
    }

    case "SET_SHELL": {
      const newDraft: CommitDraft = {
        ...state.draft,
        shell: action.shell,
      };
      const derived = deriveDerivedState(state.snapshot, newDraft, state.env);
      return { ...state, draft: newDraft, ...derived };
    }

    case "SET_DETACHED_ACK": {
      return { ...state, detachedHeadAcknowledged: action.acknowledged };
    }

    case "START_RUN": {
      return {
        ...state,
        inFlight: true,
        currentStep: action.step ?? "preflight",
        lastResult: undefined,
      };
    }

    case "PROGRESS": {
      return {
        ...state,
        currentStep: action.step,
      };
    }

    case "RESULT": {
      return {
        ...state,
        inFlight: false,
        lastResult: action.result,
      };
    }

    case "DISMISS_STALE_NOTICE": {
      return { ...state, stalePathsNotice: undefined };
    }

    default:
      return state;
  }
}
