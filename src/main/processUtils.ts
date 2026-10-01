import { spawn } from "node:child_process";

export interface ProcessResult {
  stdout: string;
  stderr: string;
}

export function runProcess(command: string, args: string[], signal?: AbortSignal): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Process cancelled.", "AbortError"));
      return;
    }
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let aborted = false;
    let onAbort: () => void = () => undefined;

    const settle = (callback: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      callback();
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    onAbort = (): void => {
      aborted = true;
      child.kill();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
    }

    child.on("error", (error) =>
      settle(() => reject(aborted ? new DOMException("Process cancelled.", "AbortError") : error))
    );
    child.on("close", (code) => {
      if (aborted) {
        settle(() => reject(new DOMException("Process cancelled.", "AbortError")));
        return;
      }
      if (code === 0) {
        settle(() => resolve({ stdout, stderr }));
      } else {
        settle(() => reject(new Error(stderr || `${command} exited with code ${code}`)));
      }
    });
  });
}
