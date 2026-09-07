import { useEffect, useMemo, useRef, useState } from "react";
import {
  AppServerClient,
  type AppServerStatus,
  type JsonRpcId,
  type JsonRpcResponse,
} from "./lib/appServer";
import "./App.css";

interface Thread {
  id: string;
  name?: string | null;
  preview?: string;
  updatedAt?: number;
  status?: string;
  cwd?: string;
  source?: string;
  turns?: TurnHistory[];
}

interface TurnHistory {
  id: string;
  status?: string;
  items?: ThreadItemRecord[];
}

interface ThreadItemRecord {
  type: string;
  id?: string;
  text?: string;
  command?: string;
  aggregatedOutput?: string;
  content?: Array<{ type?: string; text?: string; url?: string }>;
  summary?: string[];
}

interface ThreadListResponse {
  data: Thread[];
  nextCursor?: string | null;
}

interface ThreadStartResponse {
  thread: Thread;
  model: string;
  modelProvider: string;
  cwd: string;
}

interface ThreadResumeResponse {
  thread: Thread;
  model: string;
  modelProvider: string;
  cwd: string;
}

interface TurnStartResponse {
  turn: {
    id: string;
    status?: string;
  };
}

interface InitializeResponse {
  userAgent: string;
  workxHome: string;
  platformFamily: string;
  platformOs: string;
}

type MessageRole = "user" | "assistant" | "tool" | "system" | "error";
type MessageStatus = "streaming" | "done" | "error";

interface PendingApproval {
  id: JsonRpcId;
  method: string;
  params: Record<string, any>;
  time: string;
}

interface ConversationMessage {
  id: string;
  threadId: string;
  turnId?: string;
  itemId?: string;
  role: MessageRole;
  text: string;
  status: MessageStatus;
  label?: string;
}

type EventKind = "notification" | "response" | "error" | "system";

interface EventRecord {
  id: number;
  kind: EventKind;
  time: string;
  title: string;
  detail: string;
}

function prettyJson(value: unknown): string {
  if (value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function bytesToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToString(value: string): string {
  try {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return value;
  }
}

function interactiveShellArgv(): string[] {
  const isWindows = navigator.platform.toLowerCase().includes("win");
  return isWindows ? ["powershell.exe", "-NoLogo"] : ["/bin/zsh", "-l"];
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" ? (value as Record<string, any>) : {};
}

function contentText(content: ThreadItemRecord["content"] | undefined): string {
  if (!content) return "";
  return content
    .map((part) => part.text || part.url || "")
    .filter(Boolean)
    .join("\n");
}

function historyMessages(threadId: string, turns: TurnHistory[]): ConversationMessage[] {
  const result: ConversationMessage[] = [];

  for (const turn of turns) {
    for (const item of turn.items ?? []) {
      const id = item.id ?? `${turn.id}:${item.type}`;
      switch (item.type) {
        case "userMessage":
          result.push({
            id: `history:${id}`,
            threadId,
            turnId: turn.id,
            role: "user",
            status: "done",
            text: contentText(item.content) || "(message)",
          });
          break;
        case "agentMessage":
          result.push({
            id: `history:${id}`,
            threadId,
            turnId: turn.id,
            role: "assistant",
            status: "done",
            text: item.text || "",
          });
          break;
        case "reasoning":
          result.push({
            id: `history:${id}`,
            threadId,
            turnId: turn.id,
            role: "system",
            status: "done",
            text: (item.summary ?? []).join("\n"),
            label: "reasoning",
          });
          break;
        case "commandExecution":
          result.push({
            id: `history:${id}`,
            threadId,
            turnId: turn.id,
            role: "tool",
            status: "done",
            text: [item.command, item.aggregatedOutput].filter(Boolean).join("\n"),
            label: "command",
          });
          break;
        case "plan":
          result.push({
            id: `history:${id}`,
            threadId,
            turnId: turn.id,
            role: "system",
            status: "done",
            text: item.text || "",
            label: "plan",
          });
          break;
        case "fileChange":
          result.push({
            id: `history:${id}`,
            threadId,
            turnId: turn.id,
            role: "tool",
            status: "done",
            text: "",
            label: "file change",
          });
          break;
        default:
          result.push({
            id: `history:${id}`,
            threadId,
            turnId: turn.id,
            role: "tool",
            status: "done",
            text: item.text || "",
            label: item.type,
          });
      }
    }
  }

  return result;
}

function App() {
  const [client] = useState(() => new AppServerClient());
  const [status, setStatus] = useState<AppServerStatus>({ running: false, binary: null });
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThread, setActiveThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [input, setInput] = useState("");
  const [threadSearch, setThreadSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const [sending, setSending] = useState(false);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<"events" | "approvals" | "terminal" | "status">("events");
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [terminalProcessId, setTerminalProcessId] = useState<string | null>(null);
  const [terminalOutput, setTerminalOutput] = useState("");
  const [terminalInput, setTerminalInput] = useState("");
  const [terminalRunning, setTerminalRunning] = useState(false);
  const eventId = useRef(0);

  const visibleMessages = useMemo(
    () => messages.filter((message) => message.threadId === activeThread?.id),
    [activeThread?.id, messages],
  );

  const visibleThreads = useMemo(() => {
    const term = threadSearch.trim().toLowerCase();
    if (!term) return threads;
    return threads.filter((thread) => {
      const title = thread.name || thread.preview || "Untitled";
      return title.toLowerCase().includes(term) || thread.id.toLowerCase().includes(term);
    });
  }, [threadSearch, threads]);

  function pushEvent(
    kind: EventKind,
    title: string,
    detail = "",
  ): void {
    const id = ++eventId.current;
    setEvents((current) => [{ id, kind, title, detail, time: formatTime(new Date()) }, ...current].slice(0, 200));
  }

  function upsertMessage(
    id: string,
    update: (current: ConversationMessage | undefined) => ConversationMessage,
  ): void {
    setMessages((current) => {
      const index = current.findIndex((message) => message.id === id);
      if (index === -1) {
        return [update(undefined), ...current];
      }
      const next = [...current];
      next[index] = update(next[index]);
      return next;
    });
  }

  function handleServerRequest(message: JsonRpcResponse): void {
    if (message.id === undefined || !message.method) return;
    const request: PendingApproval = {
      id: message.id,
      method: message.method,
      params: asRecord(message.params),
      time: formatTime(new Date()),
    };
    setApprovals((current) => [request, ...current.filter((item) => String(item.id) !== String(request.id))]);
    setRightTab("approvals");
  }

  async function resolveApproval(request: PendingApproval, result: unknown): Promise<void> {
    try {
      await client.respondToServerRequest(request.id, result);
      setApprovals((current) => current.filter((item) => String(item.id) !== String(request.id)));
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function startTerminal(): Promise<void> {
    if (terminalRunning) return;
    const processId = `workx-terminal-${Date.now()}`;
    setTerminalProcessId(processId);
    setTerminalOutput("");
    setTerminalRunning(true);
    setRightTab("terminal");
    setError(null);

    try {
      await client.request("command/exec", {
        command: interactiveShellArgv(),
        processId,
        tty: true,
        streamStdin: true,
        streamStdoutStderr: true,
      }, 0);
    } catch (reason) {
      setTerminalRunning(false);
      setError(String(reason));
    }
  }

  async function writeTerminalInput(): Promise<void> {
    const text = terminalInput;
    if (!text || !terminalProcessId) return;
    setTerminalInput("");
    setTerminalOutput((current) => `${current}${text}\n`);
    try {
      await client.request("command/exec/write", {
        processId: terminalProcessId,
        deltaBase64: bytesToBase64(`${text}\n`),
        closeStdin: false,
      });
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function stopTerminal(): Promise<void> {
    if (!terminalProcessId) return;
    try {
      await client.request("command/exec/terminate", {
        processId: terminalProcessId,
      });
    } catch {
      // The process may already have exited.
    }
    setTerminalRunning(false);
    setTerminalProcessId(null);
  }

  function handleNotification(method: string, params: unknown): void {
    const record = asRecord(params);
    const threadId = typeof record.threadId === "string" ? record.threadId : "";
    const turnId = typeof record.turnId === "string" ? record.turnId : undefined;
    const itemId = typeof record.itemId === "string" ? record.itemId : undefined;

    switch (method) {
      case "item/agentMessage/delta":
        if (threadId && itemId && typeof record.delta === "string") {
          upsertMessage(`assistant:${itemId}`, (current) => ({
            id: `assistant:${itemId}`,
            threadId,
            turnId,
            itemId,
            role: "assistant",
            status: "streaming",
            text: `${current?.text ?? ""}${record.delta}`,
            label: "agent message",
          }));
        }
        break;

      case "item/reasoning/textDelta":
        if (threadId && itemId && typeof record.delta === "string") {
          upsertMessage(`reasoning:${itemId}`, (current) => ({
            id: `reasoning:${itemId}`,
            threadId,
            turnId,
            itemId,
            role: "system",
            status: "streaming",
            text: `${current?.text ?? ""}${record.delta}`,
            label: "reasoning",
          }));
        }
        break;

      case "item/commandExecution/outputDelta":
        if (threadId && itemId && typeof record.delta === "string") {
          upsertMessage(`command:${itemId}`, (current) => ({
            id: `command:${itemId}`,
            threadId,
            turnId,
            itemId,
            role: "tool",
            status: "streaming",
            text: `${current?.text ?? ""}${record.delta}`,
            label: "command output",
          }));
        }
        break;

      case "command/exec/outputDelta":
        if (record.processId === terminalProcessId && typeof record.deltaBase64 === "string") {
          setTerminalOutput((current) => current + base64ToString(record.deltaBase64));
        }
        break;

      case "turn/diff/updated":
        if (threadId && typeof record.diff === "string") {
          upsertMessage(`diff:${record.turnId ?? "current"}`, () => ({
            id: `diff:${record.turnId ?? "current"}`,
            threadId,
            turnId: record.turnId ?? turnId,
            role: "tool",
            status: "streaming",
            text: record.diff,
            label: "diff",
          }));
        }
        break;

      case "turn/plan/updated":
        if (threadId) {
          const plan = Array.isArray(record.plan)
            ? record.plan.map((step: Record<string, any>) => step.step).join("\n")
            : prettyJson(record.plan);
          upsertMessage(`plan:${record.turnId ?? "current"}`, () => ({
            id: `plan:${record.turnId ?? "current"}`,
            threadId,
            turnId: record.turnId ?? turnId,
            role: "system",
            status: "streaming",
            text: plan,
            label: "plan",
          }));
        }
        break;

      case "item/completed":
        if (threadId && itemId) {
          upsertMessage(`assistant:${itemId}`, (current) =>
            current
              ? { ...current, status: "done" }
              : {
                  id: `assistant:${itemId}`,
                  threadId,
                  turnId,
                  itemId,
                  role: "assistant",
                  status: "done",
                  text: "",
                  label: "item completed",
                },
          );
        }
        break;

      case "turn/completed":
        if (threadId && turnId) {
          setMessages((current) =>
            current.map((message) =>
              message.threadId === threadId && message.turnId === turnId
                ? { ...message, status: "done" }
                : message,
            ),
          );
          setActiveTurnId((current) => (current === turnId ? null : current));
        }
        break;

      case "thread/name/updated":
        if (typeof record.threadId === "string" && typeof record.name === "string") {
          setThreads((current) =>
            current.map((thread) =>
              thread.id === record.threadId ? { ...thread, name: record.name } : thread,
            ),
          );
          setActiveThread((current) => {
            if (!current || current.id !== record.threadId) return current;
            return { ...current, name: String(record.name) };
          });
        }
        break;

      case "thread/status/changed":
        if (typeof record.threadId === "string" && typeof record.status === "string") {
          setThreads((current) =>
            current.map((thread) =>
              thread.id === record.threadId ? { ...thread, status: record.status } : thread,
            ),
          );
        }
        break;

      case "error":
        if (threadId) {
          const errorRecord = asRecord(record.error);
          upsertMessage(`error:${turnId ?? "current"}`, () => ({
            id: `error:${turnId ?? "current"}`,
            threadId,
            turnId,
            role: "error",
            status: "error",
            text: typeof errorRecord.message === "string" ? errorRecord.message : prettyJson(record.error),
            label: "error",
          }));
        }
        break;

      default:
        break;
    }
  }

  async function initializeClient(): Promise<void> {
    const nextStatus = await client.start();
    setStatus(nextStatus);
    pushEvent("system", "app-server started", nextStatus.binary ?? "unknown binary");

    const initialized = await client.request<InitializeResponse>("initialize", {
      clientInfo: {
        name: "workx-desktop",
        version: "0.1.0",
      },
      capabilities: { experimentalApi: true },
    });
    await client.notify("initialized");

    pushEvent(
      "system",
      "initialized",
      `${initialized.userAgent} on ${initialized.platformOs}`,
    );

    const list = await client.request<ThreadListResponse>("thread/list", { limit: 100 });
    setThreads(list.data);
    if (list.data.length > 0 && !activeThread) {
      setActiveThread(list.data[0]);
    }
  }

  useEffect(() => {
    let mounted = true;

    initializeClient()
      .catch((reason) => {
        if (mounted) setError(String(reason));
      })
      .finally(() => {
        if (mounted) setBooting(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    return client.onMessage((message: JsonRpcResponse) => {
      if (message.error) {
        pushEvent("error", `app-server: ${message.error.message}`, prettyJson(message.error.data));
        return;
      }

      if (message.method) {
        if (
          message.id !== undefined &&
          message.result === undefined &&
          message.error === undefined
        ) {
          pushEvent("notification", `server request: ${message.method}`, prettyJson(message.params));
          handleServerRequest(message);
          return;
        }

        pushEvent("notification", message.method, prettyJson(message.params));
        handleNotification(message.method, message.params);
        return;
      }

      if (message.id !== undefined) {
        pushEvent("response", `response ${message.id}`, prettyJson(message.result));
      }
    });
  }, [client]);

  async function interruptTurn(): Promise<void> {
    if (!activeThread || !activeTurnId) return;
    try {
      await client.request("turn/interrupt", {
        threadId: activeThread.id,
        turnId: activeTurnId,
      });
      setActiveTurnId(null);
      pushEvent("system", "turn/interrupt", activeTurnId);
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function selectThread(thread: Thread): Promise<void> {
    setActiveThread(thread);
    setError(null);
    try {
      const response = await client.request<ThreadResumeResponse>("thread/resume", {
        threadId: thread.id,
      });
      setActiveThread(response.thread);
      setThreads((current) =>
        current.map((item) => (item.id === response.thread.id ? response.thread : item)),
      );
      setMessages((current) => [
        ...current.filter((message) => message.threadId !== thread.id),
        ...historyMessages(thread.id, response.thread.turns ?? []),
      ]);
      pushEvent("system", "thread/resume", thread.id);
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function startNewThread(): Promise<void> {
    setError(null);
    try {
      const response = await client.request<ThreadStartResponse>("thread/start", {});
      setActiveThread(response.thread);
      setThreads((current) => [
        response.thread,
        ...current.filter((thread) => thread.id !== response.thread.id),
      ]);
      pushEvent("system", "thread/start", response.thread.id);
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function sendMessage(event?: React.FormEvent): Promise<void> {
    event?.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    setInput("");
    setSending(true);
    setError(null);

    try {
      let thread = activeThread;
      if (!thread) {
        const startResponse = await client.request<ThreadStartResponse>("thread/start", {});
        thread = startResponse.thread;
        setActiveThread(thread);
        setThreads((current) => [
          thread as Thread,
          ...current.filter((item) => item.id !== thread?.id),
        ]);
      }

      const userMessage: ConversationMessage = {
        id: `user:${Date.now()}`,
        threadId: thread.id,
        role: "user",
        status: "done",
        text,
      };
      setMessages((current) => [...current, userMessage]);

      const response = await client.request<TurnStartResponse>("turn/start", {
        threadId: thread.id,
        input: [{ type: "text", text }],
      });

      setActiveTurnId(response.turn.id);
      pushEvent("system", "turn/start", response.turn.id);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSending(false);
    }
  }

  const activeTitle = activeThread?.name || activeThread?.preview || "New Workx chat";

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-header">
          <button className="new-chat" onClick={startNewThread} disabled={booting}>
            + New chat
          </button>
          <input
            className="search"
            placeholder="Search threads"
            disabled={booting}
            value={threadSearch}
            onChange={(event) => setThreadSearch(event.currentTarget.value)}
          />
        </div>

        <div className="thread-list">
          {booting && <div className="muted">Starting Workx…</div>}
          {!booting && threads.length === 0 && <div className="muted">No threads yet</div>}
          {visibleThreads.map((thread) => (
            <button
              key={thread.id}
              className={`thread-item ${activeThread?.id === thread.id ? "active" : ""}`}
              onClick={() => void selectThread(thread)}
            >
              <span className="thread-title">{thread.name || thread.preview || "Untitled"}</span>
              <span className="thread-meta">
                {thread.status ?? "idle"} · {thread.cwd || "no cwd"}
              </span>
            </button>
          ))}
        </div>

        <div className="sidebar-footer">
          <div className={`status-dot ${status.running ? "online" : "offline"}`} />
          <span className="muted">{status.running ? "app-server connected" : "app-server offline"}</span>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="topbar-title">{activeTitle}</div>
          <div className="topbar-actions">
            <button onClick={startNewThread} disabled={booting}>New</button>
            <button onClick={() => setRightTab("approvals")}>
              Approvals{approvals.length > 0 ? ` (${approvals.length})` : ""}
            </button>
            <button onClick={() => void startTerminal()}>Terminal</button>
            {activeTurnId && (
              <button onClick={() => void interruptTurn()} disabled={sending}>
                Stop
              </button>
            )}
          </div>
        </header>

        <div className="content">
          <div className="chat-pane">
            <div className="chat-body">
              {error && <div className="error-banner">{error}</div>}
              {visibleMessages.length === 0 ? (
                activeThread ? (
                  <div className="thread-summary">
                    <h1>{activeTitle}</h1>
                    <p className="muted">
                      Thread {activeThread.id} · source {activeThread.source ?? "unknown"}
                    </p>
                  </div>
                ) : (
                  <div className="empty-state">
                    <h1>Workx Desktop</h1>
                    <p className="muted">
                      Start a chat to inspect, edit, and run code in this workspace.
                    </p>
                  </div>
                )
              ) : (
                <div className="message-list">
                  {visibleMessages.map((message) => (
                    <div key={message.id} className={`message ${message.role} ${message.status}`}>
                      <div className="message-head">
                        <strong>{message.role}</strong>
                        {message.label && <span>{message.label}</span>}
                        {message.status === "streaming" && <span className="streaming">streaming…</span>}
                      </div>
                      <pre>{message.text || "(empty)"}</pre>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <form className="composer" onSubmit={sendMessage}>
              <textarea
                value={input}
                onChange={(event) => setInput(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
                placeholder="Ask Workx to do something…"
                rows={3}
                disabled={booting || sending}
              />
              <button type="submit" disabled={booting || sending || !input.trim()}>
                {sending ? "Sending…" : "Send"}
              </button>
            </form>
          </div>

          <aside className="right-pane">
            <div className="right-tabs">
              <button className={rightTab === "events" ? "active" : ""} onClick={() => setRightTab("events")}>
                Events
              </button>
              <button className={rightTab === "approvals" ? "active" : ""} onClick={() => setRightTab("approvals")}>
                Approvals
              </button>
              <button className={rightTab === "terminal" ? "active" : ""} onClick={() => void startTerminal()}>
                Terminal
              </button>
              <button className={rightTab === "status" ? "active" : ""} onClick={() => setRightTab("status")}>
                Status
              </button>
            </div>

            {rightTab === "approvals" ? (
              <div className="approval-list">
                {approvals.length === 0 && <div className="muted">No pending approvals</div>}
                {approvals.map((approval) => (
                  <div key={String(approval.id)} className="approval-card">
                    <div className="approval-head">
                      <span>{approval.time}</span>
                      <strong>{approval.method}</strong>
                    </div>
                    {approval.params.command && <pre>{approval.params.command}</pre>}
                    {approval.params.reason && <p className="muted">{approval.params.reason}</p>}
                    {!approval.params.command && !approval.params.reason && (
                      <pre>{prettyJson(approval.params)}</pre>
                    )}
                    <div className="approval-actions">
                      {approval.method === "item/commandExecution/requestApproval" && (
                        <>
                          <button onClick={() => void resolveApproval(approval, { decision: "accept" })}>
                            Accept
                          </button>
                          <button onClick={() => void resolveApproval(approval, { decision: "acceptForSession" })}>
                            Accept session
                          </button>
                        </>
                      )}
                      {approval.method === "item/fileChange/requestApproval" && (
                        <>
                          <button onClick={() => void resolveApproval(approval, { decision: "accept" })}>
                            Accept
                          </button>
                          <button onClick={() => void resolveApproval(approval, { decision: "acceptForSession" })}>
                            Accept session
                          </button>
                        </>
                      )}
                      <button onClick={() => void resolveApproval(approval, { decision: "decline" })}>
                        Decline
                      </button>
                      <button onClick={() => void resolveApproval(approval, { decision: "cancel" })}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : rightTab === "terminal" ? (
              <div className="terminal-pane">
                <div className="terminal-toolbar">
                  <span className={terminalRunning ? "status-dot online" : "status-dot"} />
                  <span>{terminalRunning ? terminalProcessId : "terminal stopped"}</span>
                  <button onClick={() => void stopTerminal()} disabled={!terminalRunning}>
                    Stop
                  </button>
                </div>
                <pre className="terminal-output">{terminalOutput || "Terminal ready. Type a command."}</pre>
                <form
                  className="terminal-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void writeTerminalInput();
                  }}
                >
                  <input
                    value={terminalInput}
                    onChange={(event) => setTerminalInput(event.currentTarget.value)}
                    disabled={!terminalRunning}
                    placeholder={terminalRunning ? "$ command" : "Start a terminal first"}
                  />
                  <button type="submit" disabled={!terminalRunning || !terminalInput.trim()}>
                    Run
                  </button>
                </form>
              </div>
            ) : rightTab === "events" ? (
              <div className="event-list">
                {events.length === 0 && <div className="muted">Waiting for app-server events…</div>}
                {events.map((item) => (
                  <div key={item.id} className={`event-item ${item.kind}`}>
                    <div className="event-head">
                      <span>{item.time}</span>
                      <strong>{item.title}</strong>
                    </div>
                    {item.detail && <pre>{item.detail}</pre>}
                  </div>
                ))}
              </div>
            ) : (
              <div className="status-pane">
                <h2>Connection</h2>
                <p>
                  <span className={`status-dot ${status.running ? "online" : "offline"}`} />
                  {status.running ? "Running" : "Offline"}
                </p>
                <p className="muted">{status.binary || "binary path unavailable"}</p>

                <h2>Error</h2>
                <p className={error ? "error-text" : "muted"}>{error || "None"}</p>
              </div>
            )}
          </aside>
        </div>
      </section>
    </main>
  );
}

export default App;
