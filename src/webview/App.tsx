import { useReducer, useEffect, useRef } from "preact/hooks";
import { draftReducer, initialState } from "./draftReducer";
import { getVsCodeApi } from "./vscodeApi";
import { PROTOCOL_VERSION } from "../shared/protocol";
import type { HostToWebview } from "../shared/protocol";
import { RepoPicker } from "./components/RepoPicker";
import { FileList } from "./components/FileList";
import { DateTimeFields } from "./components/DateTimeFields";
import { MessageFields } from "./components/MessageFields";
import { PushFields } from "./components/PushFields";
import { CommandPreview } from "./components/CommandPreview";
import { ActionBar } from "./components/ActionBar";

let nextRequestId = 1;

export function App() {
  const [state, dispatch] = useReducer(draftReducer, initialState);
  const activeRequestIdRef = useRef<string | undefined>(undefined);
  const vscode = getVsCodeApi();

  useEffect(() => {
    // Send ready handshake to host
    vscode.postMessage({ type: "ready", protocolVersion: PROTOCOL_VERSION });

    const handleMessage = (event: MessageEvent<unknown>) => {
      const data = event.data;
      if (!data || typeof data !== "object") return;
      const msg = data as HostToWebview;

      switch (msg.type) {
        case "init":
          dispatch({
            type: "INIT",
            env: msg.env,
            repos: msg.repos,
            ...(msg.activeRepoId ? { activeRepoId: msg.activeRepoId } : {}),
            ...(msg.snapshot ? { snapshot: msg.snapshot } : {}),
          });
          break;
        case "snapshot":
          dispatch({ type: "SNAPSHOT", snapshot: msg.snapshot });
          break;
        case "preselect":
          dispatch({
            type: "PRESELECT",
            repoId: msg.repoId,
            paths: msg.paths,
            droppedCount: msg.droppedCount,
          });
          break;
        case "progress":
          if (msg.requestId === activeRequestIdRef.current) {
            dispatch({ type: "PROGRESS", step: msg.step, status: msg.status });
          }
          break;
        case "result":
          if (msg.requestId === activeRequestIdRef.current) {
            activeRequestIdRef.current = undefined;
            dispatch({ type: "RESULT", result: msg.result });
          }
          break;
      }
    };

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, []);

  // State persistence via vscode.setState
  useEffect(() => {
    if (state.activeRepoId) {
      vscode.setState(state.draft);
    }
  }, [state.draft, state.activeRepoId]);

  const handleCommit = () => {
    const requestId = `req-${String(nextRequestId++)}`;
    activeRequestIdRef.current = requestId;
    dispatch({ type: "START_RUN", step: "preflight" });
    vscode.postMessage({ type: "run", requestId, draft: state.draft });
  };

  const handleCopy = () => {
    const requestId = `req-${String(nextRequestId++)}`;
    activeRequestIdRef.current = requestId;
    vscode.postMessage({ type: "copy", requestId, draft: state.draft });
  };

  const handleSendToTerminal = () => {
    const requestId = `req-${String(nextRequestId++)}`;
    activeRequestIdRef.current = requestId;
    vscode.postMessage({ type: "sendToTerminal", requestId, draft: state.draft });
  };

  const handleCancel = () => {
    if (activeRequestIdRef.current) {
      vscode.postMessage({ type: "cancel", requestId: activeRequestIdRef.current });
    }
  };

  const blockers = state.snapshot?.blockers ?? [];
  const isDetached = state.snapshot?.head.kind === "detached";

  return (
    <div class="app-container">
      {/* Stale Paths Notice */}
      {state.stalePathsNotice && (
        <div class="banner banner-info">
          <span class="banner-text">{state.stalePathsNotice}</span>
          <button
            type="button"
            class="banner-close"
            onClick={() => {
              dispatch({ type: "DISMISS_STALE_NOTICE" });
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* Blockers Banner */}
      {blockers.length > 0 && (
        <div class="banner banner-error">
          <span class="banner-text">
            Operation blocked: repository has active {blockers.join(", ")}.
          </span>
        </div>
      )}

      {/* Repo Picker (when > 1 repo) */}
      <RepoPicker
        repos={state.repos}
        activeRepoId={state.activeRepoId}
        onSelectRepo={(repoId) => {
          dispatch({ type: "SET_REPO", repoId });
          vscode.postMessage({ type: "selectRepo", repoId });
        }}
      />

      {/* Changed Files */}
      <FileList
        files={state.snapshot?.files ?? []}
        selectedPaths={state.draft.paths}
        filterText={state.filterText}
        onTogglePath={(path) => {
          dispatch({ type: "TOGGLE_PATH", path });
        }}
        onSelectAll={(select) => {
          dispatch({ type: "SELECT_ALL_PATHS", select });
        }}
        onFilterChange={(filterText) => {
          dispatch({ type: "SET_FILTER", filterText });
        }}
      />

      {/* Date & Time Fields */}
      <DateTimeFields
        local={state.draft.when.local}
        offsetMinutes={state.draft.when.offsetMinutes}
        offsetMode={state.offsetMode}
        workingHours={state.env.workingHours}
        onSetDate={(year, month, day) => {
          dispatch({ type: "SET_DATE", year, month, day });
        }}
        onSetTime={(hour, minute, second) => {
          dispatch({ type: "SET_TIME", hour, minute, second });
        }}
        onSetOffsetMode={(mode, offsetMinutes) => {
          dispatch({
            type: "SET_OFFSET_MODE",
            mode,
            ...(offsetMinutes !== undefined ? { offsetMinutes } : {}),
          });
        }}
        onSetOffsetMinutes={(offsetMinutes) => {
          dispatch({ type: "SET_OFFSET_MINUTES", offsetMinutes });
        }}
        onRandomWorkingHours={() => {
          dispatch({ type: "RANDOM_WORKING_HOURS" });
        }}
      />

      {/* Commit Message & Chips */}
      <MessageFields
        subject={state.draft.message.subject}
        body={state.draft.message.body}
        onSetSubject={(subject) => {
          dispatch({ type: "SET_SUBJECT", subject });
        }}
        onSetBody={(body) => {
          dispatch({ type: "SET_BODY", body });
        }}
        onApplyPrefixChip={(prefix) => {
          dispatch({ type: "APPLY_PREFIX_CHIP", prefix });
        }}
      />

      {/* Push options */}
      <PushFields
        enabled={state.draft.push.enabled}
        remote={state.draft.push.remote}
        remotes={state.snapshot?.remotes ?? []}
        disabled={isDetached}
        onSetPushEnabled={(enabled) => {
          dispatch({ type: "SET_PUSH_ENABLED", enabled });
        }}
        onSetPushRemote={(remote) => {
          dispatch({ type: "SET_PUSH_REMOTE", remote });
        }}
      />

      {/* Command Preview */}
      <CommandPreview
        shell={state.draft.shell}
        preview={state.preview}
        onSetShell={(shell) => {
          dispatch({ type: "SET_SHELL", shell });
        }}
      />

      {/* Action Bar */}
      <ActionBar
        plan={state.plan}
        warnings={state.warnings}
        selectedCount={state.draft.paths.length}
        isDetached={isDetached}
        detachedAck={state.detachedHeadAcknowledged}
        env={state.env}
        draftShell={state.draft.shell}
        inFlight={state.inFlight}
        currentStep={state.currentStep}
        lastResult={state.lastResult}
        onCommit={handleCommit}
        onCopy={handleCopy}
        onSendToTerminal={handleSendToTerminal}
        onCancel={handleCancel}
        onSetDetachedAck={(acknowledged) => {
          dispatch({ type: "SET_DETACHED_ACK", acknowledged });
        }}
      />
    </div>
  );
}
