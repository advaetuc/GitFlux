import type { WebviewToHost } from "../shared/protocol";

interface VsCodeApi<T> {
  getState(): T | undefined;
  setState(state: T): T;
  postMessage(message: WebviewToHost): void;
}

declare function acquireVsCodeApi<T>(): VsCodeApi<T>;

let apiInstance: VsCodeApi<unknown> | undefined;

export function getVsCodeApi<T = unknown>(): VsCodeApi<T> {
  if (!apiInstance) {
    apiInstance =
      typeof acquireVsCodeApi === "function"
        ? acquireVsCodeApi()
        : {
            getState: () => undefined,
            setState: (s) => s,
            postMessage: () => {},
          };
  }
  return apiInstance as VsCodeApi<T>;
}
