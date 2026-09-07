import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type JsonRpcId = string | number;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc?: "2.0";
  id?: JsonRpcId;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
  method?: string;
  params?: unknown;
}

export interface AppServerStatus {
  running: boolean;
  binary: string | null;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeout: ReturnType<typeof setTimeout> | undefined;
}

export class AppServerClient {
  private pending = new Map<string, PendingRequest>();
  private listeners = new Set<(message: JsonRpcResponse) => void>();
  private unlisteners: UnlistenFn[] = [];
  private nextId = 0;

  async start(): Promise<AppServerStatus> {
    await this.stopListening();
    await this.listen();
    return invoke<AppServerStatus>("app_server_start");
  }

  async stop(): Promise<AppServerStatus> {
    await this.stopListening();
    return invoke<AppServerStatus>("app_server_stop");
  }

  async status(): Promise<AppServerStatus> {
    return invoke<AppServerStatus>("app_server_status");
  }

  request<T = unknown>(
    method: string,
    params?: unknown,
    timeoutMs = 30_000,
  ): Promise<T> {
    const id = `req-${++this.nextId}`;
    const message: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    return new Promise<T>((resolve, reject) => {
      const timeout =
        timeoutMs <= 0
          ? undefined
          : setTimeout(() => {
              this.pending.delete(id);
              reject(new Error(`Request ${method} timed out`));
            }, timeoutMs);

      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject: (error) => reject(error),
        timeout,
      });

      invoke("app_server_write", {
        payload: JSON.stringify(message),
      }).catch((error) => {
        if (timeout) clearTimeout(timeout);
        this.pending.delete(id);
        reject(new Error(String(error)));
      });
    });
  }

  async respondToServerRequest(id: JsonRpcId, result: unknown): Promise<void> {
    await invoke("app_server_write", {
      payload: JSON.stringify({ jsonrpc: "2.0", id, result }),
    });
  }

  async rejectServerRequest(
    id: JsonRpcId,
    code = -32000,
    message = "Request rejected",
  ): Promise<void> {
    await invoke("app_server_write", {
      payload: JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }),
    });
  }

  async notify(method: string, params?: unknown): Promise<void> {
    const message = {
      jsonrpc: "2.0" as const,
      method,
      params,
    };
    await invoke("app_server_write", {
      payload: JSON.stringify(message),
    });
  }

  onMessage(listener: (message: JsonRpcResponse) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async listen(): Promise<void> {
    const messageUnlisten = await listen<string>("app-server://message", (event) => {
      this.handleLine(event.payload);
    });

    const stderrUnlisten = await listen<string>("app-server://stderr", (event) => {
      this.listeners.forEach((listener) => listener({ error: { code: -1, message: event.payload } }));
    });

    const exitUnlisten = await listen<{ code: number | null }>("app-server://exit", (event) => {
      this.rejectAll(new Error(`Workx app server exited (code ${event.payload.code ?? "unknown"})`));
    });

    this.unlisteners = [messageUnlisten, stderrUnlisten, exitUnlisten];
  }

  private async stopListening(): Promise<void> {
    const unlisteners = this.unlisteners.splice(0);
    for (const unlisten of unlisteners) {
      unlisten();
    }
  }

  private handleLine(line: string): void {
    let message: JsonRpcResponse;
    try {
      message = JSON.parse(line) as JsonRpcResponse;
    } catch {
      this.listeners.forEach((listener) =>
        listener({ error: { code: -32700, message: `Invalid JSON-RPC payload: ${line}` } }),
      );
      return;
    }

    const isServerRequest =
      message.id !== undefined &&
      message.method !== undefined &&
      message.result === undefined &&
      message.error === undefined;

    if (message.id !== undefined && !isServerRequest) {
      const id = String(message.id);
      const pending = this.pending.get(id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pending.delete(id);
        if (message.error) {
          pending.reject(new Error(message.error.message));
        } else {
          pending.resolve(message.result);
        }
      }
    }

    this.listeners.forEach((listener) => listener(message));
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      if (pending.timeout) clearTimeout(pending.timeout);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}
