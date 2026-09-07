import { useEffect, useRef, useState } from "react";
import {
  AppServerClient,
  type AppServerStatus,
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

function App() {
  const [client] = useState(() => new AppServerClient());
  const [status, setStatus] = useState<AppServerStatus>({ running: false, binary: null });
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThread, setActiveThread] = useState<Thread | null>(null);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const [sending, setSending] = useState(false);
  const [rightTab, setRightTab] = useState<"events" | "status">("events");
  const eventId = useRef(0);

  function pushEvent(
    kind: EventKind,
    title: string,
    detail = "",
  ): void {
    const id = ++eventId.current;
    setEvents((current) => [{ id, kind, title, detail, time: formatTime(new Date()) }, ...current].slice(0, 200));
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
      capabilities: {},
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
        pushEvent("notification", message.method, prettyJson(message.params));
        return;
      }

      if (message.id !== undefined) {
        pushEvent("response", `response ${message.id}`, prettyJson(message.result));
      }
    });
  }, [client]);

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

      const response = await client.request<TurnStartResponse>("turn/start", {
        threadId: thread.id,
        input: [{ type: "text", text }],
      });

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
          <input className="search" placeholder="Search threads" disabled={booting} />
        </div>

        <div className="thread-list">
          {booting && <div className="muted">Starting Workx…</div>}
          {!booting && threads.length === 0 && <div className="muted">No threads yet</div>}
          {threads.map((thread) => (
            <button
              key={thread.id}
              className={`thread-item ${activeThread?.id === thread.id ? "active" : ""}`}
              onClick={() => setActiveThread(thread)}
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
            <button
              onClick={() => setRightTab(rightTab === "events" ? "status" : "events")}
            >
              {rightTab === "events" ? "Status" : "Events"}
            </button>
          </div>
        </header>

        <div className="content">
          <div className="chat-pane">
            <div className="chat-body">
              {error && <div className="error-banner">{error}</div>}
              {activeThread ? (
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
              <button className={rightTab === "status" ? "active" : ""} onClick={() => setRightTab("status")}>
                Status
              </button>
            </div>

            {rightTab === "events" ? (
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
