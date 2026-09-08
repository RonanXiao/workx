import { useEffect, useMemo, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
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
  status?: unknown;
  cwd?: string;
  source?: string;
  projectId?: string | null;
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

interface ModelOption {
  id: string;
  model: string;
  displayName: string;
  isDefault: boolean;
  defaultReasoningEffort?: string;
  supportedReasoningEfforts?: Array<{
    reasoningEffort?: string;
    description?: string;
  }>;
}

interface ModelListResponse {
  data: ModelOption[];
}

interface FsEntry {
  fileName: string;
  isDirectory: boolean;
  isFile: boolean;
}

interface FsReadDirectoryResponse {
  entries: FsEntry[];
}

interface FsReadFileResponse {
  dataBase64: string;
}

interface PluginSummary {
  id: string;
  name: string;
  enabled: boolean;
  installed: boolean;
  source?: unknown;
  interface?: {
    displayName?: string | null;
    shortDescription?: string | null;
    category?: string | null;
    logoUrl?: string | null;
    logoUrlDark?: string | null;
    brandColor?: string | null;
    defaultPrompt?: string[] | null;
  } | null;
}

interface PluginMarketplace {
  name: string;
  interface?: { displayName?: string | null } | null;
  plugins: PluginSummary[];
}

interface PluginListResponse {
  marketplaces: PluginMarketplace[];
}

interface ProjectRoot {
  path: string;
}

interface WorkxProject {
  id: string;
  name: string;
  roots: ProjectRoot[];
  position: number;
  recencyAt?: number | null;
}

interface ProjectListResponse {
  data: WorkxProject[];
}

interface ScheduledTaskSummary {
  key: string;
  name: string;
  prompt: string;
  schedule?: unknown;
  marketplace?: string;
}

interface PluginReadResponse {
  plugin: {
    scheduledTasks?: ScheduledTaskSummary[] | null;
  };
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

function formatThreadStatus(status: unknown): string {
  if (typeof status === "string") return status;
  if (status && typeof status === "object") {
    const record = status as Record<string, unknown>;
    return typeof record.type === "string" ? record.type : "idle";
  }
  return "idle";
}

function projectNameFromCwd(cwd: string): string {
  const trimmed = cwd.replace(/[\\/]+$/, "");
  const parts = trimmed.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || cwd;
}

function formatTimeAgo(updatedAt?: number): string {
  if (!updatedAt) return "";
  const delta = Math.max(0, Date.now() / 1000 - updatedAt);
  if (delta < 60) return "now";
  if (delta < 3600) return `${Math.floor(delta / 60)}m`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h`;
  return `${Math.floor(delta / 86400)}d`;
}

function toolIcon(label?: string): string {
  if (!label) return "🧩";
  if (label.includes("command")) return "🖥️";
  if (label.includes("diff") || label.includes("file")) return "📝";
  if (label.includes("plan")) return "🗺️";
  if (label.includes("reasoning")) return "🧠";
  if (label.includes("mcp") || label.includes("tool")) return "🔧";
  return "🧩";
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

function parentDirectoryPath(path: string): string {
  const normalized = path.replace(/[\/]+$/, "");
  const separator = normalized.lastIndexOf("/");
  if (separator > 0) return normalized.slice(0, separator);
  const backslash = normalized.lastIndexOf("\\");
  if (backslash > 0) return normalized.slice(0, backslash);
  return normalized;
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
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [selectedEffort, setSelectedEffort] = useState<string | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    const stored = localStorage.getItem("workx-theme");
    return stored === "dark" ? "dark" : "light";
  });
  const [selectedProvider, setSelectedProvider] = useState<string>(() => localStorage.getItem("workx-provider") || "openai");
  const [plugins, setPlugins] = useState<PluginSummary[]>([]);
  const [pluginsLoading, setPluginsLoading] = useState(false);
  const [pluginSearch, setPluginSearch] = useState("");
  const [pluginCategory, setPluginCategory] = useState("All");
  const [scheduledTasks, setScheduledTasks] = useState<ScheduledTaskSummary[]>([]);
  const [projects, setProjects] = useState<WorkxProject[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [view, setView] = useState<"chat" | "plugins" | "scheduled">("chat");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [threadMenuId, setThreadMenuId] = useState<string | null>(null);
  const [brandMenuOpen, setBrandMenuOpen] = useState(false);
  const [alwaysAllow, setAlwaysAllow] = useState(false);
  const [mode, setMode] = useState<"chat" | "work">("chat");
  const [error, setError] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const [sending, setSending] = useState(false);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<"events" | "approvals" | "terminal" | "files" | "status">("events");
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [terminalProcessId, setTerminalProcessId] = useState<string | null>(null);
  const [terminalOutput, setTerminalOutput] = useState("");
  const [terminalInput, setTerminalInput] = useState("");
  const [terminalRunning, setTerminalRunning] = useState(false);
  const [currentDir, setCurrentDir] = useState<string | null>(null);
  const [directoryEntries, setDirectoryEntries] = useState<FsEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState<{ path: string; content: string } | null>(null);
  const [filesLoading, setFilesLoading] = useState(false);
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

  const projectGroups = useMemo(() => {
    if (projects.length > 0) {
      return projects
        .map((project) => ({
          project,
          count: threads.filter((thread) => thread.projectId === project.id).length,
          root: project.roots[0]?.path ?? "",
        }))
        .sort((a, b) => a.project.position - b.project.position);
    }

    const byCwd = new Map<string, { cwd: string; count: number; updatedAt: number }>();
    for (const thread of threads) {
      if (!thread.cwd) continue;
      const existing = byCwd.get(thread.cwd);
      byCwd.set(thread.cwd, {
        cwd: thread.cwd,
        count: (existing?.count ?? 0) + 1,
        updatedAt: Math.max(existing?.updatedAt ?? 0, thread.updatedAt ?? 0),
      });
    }
    return [...byCwd.values()].sort((a, b) => b.updatedAt - a.updatedAt).map((entry) => ({
      project: {
        id: `cwd:${entry.cwd}`,
        name: projectNameFromCwd(entry.cwd),
        roots: [{ path: entry.cwd }],
        position: 0,
      },
      count: entry.count,
      root: entry.cwd,
    }));
  }, [projects, threads]);

  const recents = useMemo(
    () =>
      [...visibleThreads].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)),
    [visibleThreads],
  );

  const pluginCategories = useMemo(() => {
    const set = new Set<string>();
    for (const plugin of plugins) {
      const category = plugin.interface?.category;
      if (category) set.add(category);
    }
    return ["All", ...Array.from(set).sort()];
  }, [plugins]);

  const filteredPlugins = useMemo(() => {
    const term = pluginSearch.trim().toLowerCase();
    return plugins.filter((plugin) => {
      const title = plugin.interface?.displayName || plugin.name;
      const desc = plugin.interface?.shortDescription || "";
      const matchesTerm = !term || title.toLowerCase().includes(term) || desc.toLowerCase().includes(term);
      const category = plugin.interface?.category;
      const matchesCategory = pluginCategory === "All" || category === pluginCategory;
      return matchesTerm && matchesCategory;
    });
  }, [plugins, pluginSearch, pluginCategory]);

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

  async function loadDirectory(path: string): Promise<void> {
    setFilesLoading(true);
    setError(null);
    try {
      const response = await client.request<FsReadDirectoryResponse>("fs/readDirectory", { path });
      setCurrentDir(path);
      setDirectoryEntries(response.entries.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.fileName.localeCompare(b.fileName);
      }));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setFilesLoading(false);
    }
  }

  async function openFile(path: string): Promise<void> {
    setError(null);
    try {
      const response = await client.request<FsReadFileResponse>("fs/readFile", { path });
      setSelectedFile({ path, content: base64ToString(response.dataBase64) });
    } catch (reason) {
      setError(String(reason));
    }
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
      setCurrentDir(list.data[0].cwd ?? null);
    }

    const modelList = await client.request<ModelListResponse>("model/list", { limit: 100 });
    setModels(modelList.data);
    const defaultModel =
      modelList.data.find((model) => model.isDefault) ??
      modelList.data[0];
    setSelectedModel((current) => current ?? defaultModel?.model ?? null);
    setSelectedEffort((current) =>
      current ?? defaultModel?.defaultReasoningEffort ?? null,
    );

    await loadProjects();
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
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("workx-theme", theme);
  }, [theme]);

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
        ...(selectedModel ? { model: selectedModel } : {}),
        ...(selectedProvider ? { modelProvider: selectedProvider } : {}),
        approvalPolicy: alwaysAllow ? "never" : "on-request",
      });
      setActiveThread(response.thread);
      setCurrentDir(response.thread.cwd ?? null);
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

  async function openFolder(): Promise<void> {
    setError(null);
    try {
      const selected = await openDialog({ directory: true, multiple: false });
      const cwd = Array.isArray(selected) ? selected[0] : selected;
      if (!cwd) return;

      const response = await client.request<ThreadStartResponse>("thread/start", {
        cwd,
        ...(selectedModel ? { model: selectedModel } : {}),
        ...(selectedProvider ? { modelProvider: selectedProvider } : {}),
        approvalPolicy: alwaysAllow ? "never" : "on-request",
      });
      setActiveThread(response.thread);
      setCurrentDir(response.thread.cwd ?? null);
      setThreads((current) => [
        response.thread,
        ...current.filter((thread) => thread.id !== response.thread.id),
      ]);
      pushEvent("system", "thread/start with folder", cwd);
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function startNewThread(): Promise<void> {
    setError(null);
    try {
      const response = await client.request<ThreadStartResponse>("thread/start", {
        ...(selectedModel ? { model: selectedModel } : {}),
        ...(selectedProvider ? { modelProvider: selectedProvider } : {}),
        approvalPolicy: alwaysAllow ? "never" : "on-request",
      });
      setActiveThread(response.thread);
      setCurrentDir(response.thread.cwd ?? null);
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
        const startResponse = await client.request<ThreadStartResponse>("thread/start", {
          ...(selectedModel ? { model: selectedModel } : {}),
          ...(selectedProvider ? { modelProvider: selectedProvider } : {}),
          approvalPolicy: alwaysAllow ? "never" : "on-request",
        });
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
        ...(selectedModel ? { model: selectedModel } : {}),
        ...(selectedEffort ? { effort: selectedEffort } : {}),
        approvalPolicy: alwaysAllow ? "never" : "on-request",
      });

      setActiveTurnId(response.turn.id);
      pushEvent("system", "turn/start", response.turn.id);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSending(false);
    }
  }

  async function loadProjects(): Promise<void> {
    try {
      const response = await client.request<ProjectListResponse>("project/list", { limit: 100 });
      setProjects(response.data);
    } catch {
      // project/list is experimental; fall back to cwd-based grouping below.
    }
  }

  async function loadPlugins(): Promise<void> {
    if (pluginsLoading) return;
    setPluginsLoading(true);
    setError(null);
    try {
      const response = await client.request<PluginListResponse>("plugin/list", {});
      const flattened = response.marketplaces.flatMap((marketplace) =>
        marketplace.plugins.map((plugin) => ({
          ...plugin,
          marketplace: marketplace.name,
          marketplacePath: ("path" in marketplace ? marketplace.path : undefined) as string | undefined,
        })),
      );
      setPlugins(flattened);
      if (flattened.length === 0) {
        pushEvent("system", "plugins", "No plugins found");
      }
    } catch (reason) {
      setError(String(reason));
    } finally {
      setPluginsLoading(false);
    }
  }

  async function loadScheduled(): Promise<void> {
    setError(null);
    try {
      const response = await client.request<PluginListResponse>("plugin/list", {});
      const tasks: ScheduledTaskSummary[] = [];
      for (const marketplace of response.marketplaces) {
        for (const plugin of marketplace.plugins) {
          try {
            const detail = await client.request<PluginReadResponse>("plugin/read", {
              pluginName: plugin.name,
              marketplacePath: ("path" in marketplace ? marketplace.path : undefined) ?? undefined,
              remoteMarketplaceName: undefined,
            });
            for (const task of detail.plugin.scheduledTasks ?? []) {
              tasks.push({ ...task, marketplace: marketplace.name });
            }
          } catch {
            // Remote plugins may not expose a local read path; skip.
          }
        }
      }
      setScheduledTasks(tasks);
    } catch (reason) {
      setError(String(reason));
    }
  }

  function saveSettings(): void {
    localStorage.setItem("workx-provider", selectedProvider);
    setSettingsOpen(false);
    pushEvent("system", "settings saved", `${selectedProvider} / ${selectedModel ?? ""}`);
  }

  function openRight(tab: typeof rightTab): void {
    setRightTab(tab);
    setRightOpen(true);
  }

  async function archiveThread(thread: Thread): Promise<void> {
    try {
      await client.request("thread/archive", { threadId: thread.id });
      setThreads((current) => current.filter((item) => item.id !== thread.id));
      if (activeThread?.id === thread.id) setActiveThread(null);
      setThreadMenuId(null);
      pushEvent("system", "thread/archive", thread.id);
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function deleteThread(thread: Thread): Promise<void> {
    try {
      await client.request("thread/delete", { threadId: thread.id });
      setThreads((current) => current.filter((item) => item.id !== thread.id));
      if (activeThread?.id === thread.id) setActiveThread(null);
      setThreadMenuId(null);
      pushEvent("system", "thread/delete", thread.id);
    } catch (reason) {
      setError(String(reason));
    }
  }

  function renderMessage(message: ConversationMessage) {
    const body = message.text || "(empty)";
    if (message.role === "user") {
      return (
        <div key={message.id} className="message user">
          <div className="user-bubble">{message.text || ""}</div>
        </div>
      );
    }
    if (message.role === "assistant") {
      return (
        <div key={message.id} className="message assistant">
          <div className="assistant-text">{body}</div>
          {message.status === "streaming" && <span className="streaming">streaming…</span>}
        </div>
      );
    }
    if (message.role === "tool") {
      return (
        <details key={message.id} className="message tool-card">
          <summary>
            <span className="tool-icon">{toolIcon(message.label)}</span>
            <span>{message.label || "Tool"}</span>
            <span className={`status-icon ${message.status}`} />
            <span className="muted">{message.status}</span>
          </summary>
          <pre>{body}</pre>
        </details>
      );
    }
    if (message.role === "system") {
      return (
        <details key={message.id} className="message system-card">
          <summary>
            <span className="tool-icon">{toolIcon(message.label)}</span>
            <span>{message.label || "Detail"}</span>
          </summary>
          <pre>{body}</pre>
        </details>
      );
    }
    return (
      <div key={message.id} className="message error">
        <pre>{body}</pre>
      </div>
    );
  }

  const activeTitle = activeThread?.name || activeThread?.preview || "New Workx chat";

  return (
    <main className={`app-shell ${sidebarCollapsed ? "collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-top">
          <button className="sidebar-collapse" title="Collapse sidebar">◀</button>
          <div className="brand-wrap">
            <button className="brand-button" onClick={() => setBrandMenuOpen((value) => !value)}>
              <span className="brand">Workx</span>
              <span className="brand-chevron">▾</span>
            </button>
            {brandMenuOpen && (
              <div className="brand-menu">
                <button
                  onClick={() => {
                    void startNewThread();
                    setBrandMenuOpen(false);
                  }}
                >
                  New chat
                </button>
                <button
                  onClick={() => {
                    void openFolder();
                    setBrandMenuOpen(false);
                  }}
                >
                  Open folder
                </button>
                <button
                  onClick={() => {
                    setSettingsOpen(true);
                    setBrandMenuOpen(false);
                  }}
                >
                  Settings
                </button>
                <button
                  onClick={() => {
                    setTheme(theme === "dark" ? "light" : "dark");
                    setBrandMenuOpen(false);
                  }}
                >
                  Switch to {theme === "dark" ? "light" : "dark"} theme
                </button>
              </div>
            )}
          </div>
        </div>

        <nav className="sidebar-nav">
          <button className="nav-item" onClick={startNewThread} disabled={booting}>
            <span className="nav-icon">✏️</span> New chat
          </button>
          <button
            className="nav-item"
            onClick={() => {
              setView("scheduled");
              void loadScheduled();
            }}
          >
            <span className="nav-icon">🕐</span> Scheduled
          </button>
          <button
            className="nav-item"
            onClick={() => {
              setView("plugins");
              void loadPlugins();
            }}
          >
            <span className="nav-icon">🧩</span> Plugins
          </button>
        </nav>

        <div className="sidebar-section">
          <div className="sidebar-section-title">Projects</div>
          {projectGroups.length === 0 && (
            <button className="section-item" onClick={() => void openFolder()} disabled={booting}>
              <span className="nav-icon">📁</span> Open folder
            </button>
          )}
          {projectGroups.map((group) => (
            <button
              key={group.project.id}
              className="section-item"
              onClick={() => {
                if (group.root) {
                  void loadDirectory(group.root);
                  openRight("files");
                }
              }}
            >
              <span className="nav-icon">📁</span>
              <span className="project-name">{group.project.name}</span>
              <span className="section-count">{group.count}</span>
            </button>
          ))}
        </div>

        <div className="sidebar-section chats">
          <div className="sidebar-section-title">
            <span>Recents</span>
            <button className="new-chat-small" onClick={startNewThread} disabled={booting}>＋</button>
          </div>
          <input
            className="search"
            placeholder="Search threads"
            disabled={booting}
            value={threadSearch}
            onChange={(event) => setThreadSearch(event.currentTarget.value)}
          />
          <div className="thread-list">
            {booting && <div className="muted">Starting Workx…</div>}
            {!booting && threads.length === 0 && <div className="muted">No threads yet</div>}
            {recents.map((thread) => (
              <div key={thread.id} className="thread-row">
                <button
                  className={`thread-item ${activeThread?.id === thread.id ? "active" : ""}`}
                  onClick={() => {
                    void selectThread(thread);
                    setThreadMenuId(null);
                  }}
                >
                  <span className="thread-title">{thread.name || thread.preview || "Untitled"}</span>
                  <span className="thread-meta">
                    {formatThreadStatus(thread.status)} · {thread.cwd || "no cwd"}
                  </span>
                  <span className="thread-time">{formatTimeAgo(thread.updatedAt)}</span>
                </button>
                <button
                  className="thread-menu-trigger"
                  title="More actions"
                  onClick={(event) => {
                    event.stopPropagation();
                    setThreadMenuId((current) => (current === thread.id ? null : thread.id));
                  }}
                >
                  ⋯
                </button>
                {threadMenuId === thread.id && (
                  <div className="thread-context-menu">
                    <button
                      onClick={() => {
                        if (thread.cwd) {
                          void loadDirectory(thread.cwd);
                          openRight("files");
                        }
                        setThreadMenuId(null);
                      }}
                    >
                      Open folder
                    </button>
                    <button onClick={() => void archiveThread(thread)}>Archive</button>
                    <button onClick={() => void deleteThread(thread)}>Delete</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="sidebar-bottom">
          <button
            className="settings-button"
            title="Settings"
            onClick={() => setSettingsOpen(true)}
          >
            ⚙️
          </button>
          <span className="muted">{theme === "dark" ? "Dark" : "Light"}</span>
          <div className={`status-dot ${status.running ? "online" : "offline"}`} />
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="topbar-title">{activeTitle}</div>
          <div className="topbar-right">
            <div className="mode-pill">
              <button className={mode === "chat" ? "active" : ""} onClick={() => setMode("chat")}>
                Chat
              </button>
              <button className={mode === "work" ? "active" : ""} onClick={() => setMode("work")}>
                Work
              </button>
            </div>
            <button
              className="icon-button"
              title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? "☀️" : "🌙"}
            </button>
            {activeTurnId && (
              <button className="icon-button" onClick={() => void interruptTurn()}>Stop</button>
            )}
            <button
              className="icon-button"
              title="Share thread"
              onClick={() => {
                if (activeThread) void navigator.clipboard.writeText(activeThread.id);
              }}
            >
              ↗ Share
            </button>
            <button
              className="icon-button"
              title="Collapse sidebar"
              onClick={() => setSidebarCollapsed((value) => !value)}
            >
              ⊞
            </button>
            <button className="icon-button" title="More" onClick={() => setSettingsOpen(true)}>
              ···
            </button>
            <button className="icon-button" onClick={() => openRight("events")}>Events</button>
            <button className="icon-button" onClick={() => openRight("approvals")}>
              Approvals{approvals.length > 0 ? ` (${approvals.length})` : ""}
            </button>
            <button className="icon-button" onClick={() => openRight("terminal")}>Term</button>
            <button className="icon-button" onClick={() => openRight("files")}>Files</button>
          </div>
        </header>

        <div className={rightOpen ? "content with-right" : "content"}>
          {view !== "chat" ? (
            <div className="page-view">
              <div className="page-header">
                <button onClick={() => setView("chat")}>← Back</button>
                <h2>{view === "plugins" ? "Plugins" : "Scheduled"}</h2>
              </div>
              {view === "plugins" && (
                <div className="plugins-pane full">
                  <div className="plugins-header">
                    <strong>All plugins</strong>
                    <span className="muted">{filteredPlugins.length} found</span>
                    <button onClick={() => void loadPlugins()} disabled={pluginsLoading}>
                      {pluginsLoading ? "Loading…" : "Refresh"}
                    </button>
                  </div>
                  <div className="plugins-toolbar">
                    <input
                      className="search"
                      placeholder="Search plugins"
                      value={pluginSearch}
                      onChange={(event) => setPluginSearch(event.currentTarget.value)}
                    />
                    <select
                      value={pluginCategory}
                      onChange={(event) => setPluginCategory(event.currentTarget.value)}
                    >
                      {pluginCategories.map((category) => (
                        <option key={category} value={category}>{category}</option>
                      ))}
                    </select>
                  </div>
                  {pluginsLoading && <div className="muted">Loading plugins…</div>}
                  {!pluginsLoading && filteredPlugins.length === 0 && <div className="muted">No plugins found</div>}
                  <div className="plugins-grid">
                    {filteredPlugins.map((plugin) => (
                      <div key={plugin.id} className="plugin-card">
                        <div className="plugin-icon">
                          {plugin.interface?.logoUrl || plugin.interface?.logoUrlDark ? (
                            <img src={plugin.interface.logoUrl || plugin.interface.logoUrlDark || ""} alt="" />
                          ) : (
                            "🧩"
                          )}
                        </div>
                        <div className="plugin-body">
                          <div className="plugin-title">{plugin.interface?.displayName || plugin.name}</div>
                          <div className="plugin-desc">{plugin.interface?.shortDescription || plugin.name}</div>
                          <div className="plugin-meta">
                            <span>{plugin.enabled ? "Enabled" : "Disabled"}</span>
                            <span>· {plugin.installed ? "Installed" : "Available"}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {view === "scheduled" && (
                <div className="scheduled-pane full">
                  <div className="plugins-header">
                    <strong>Scheduled tasks</strong>
                    <span className="muted">{scheduledTasks.length} tasks</span>
                    <button onClick={() => void loadScheduled()}>Refresh</button>
                  </div>
                  {scheduledTasks.length === 0 && (
                    <div className="muted">No scheduled tasks from installed plugins.</div>
                  )}
                  {scheduledTasks.map((task) => (
                    <div key={task.key} className="scheduled-card">
                      <div className="plugin-title">{task.name}</div>
                      <div className="plugin-desc">{task.prompt}</div>
                      <div className="plugin-meta">{JSON.stringify(task.schedule ?? "")}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
          <div className="chat-pane">
            <div className="chat-body">
              {error && <div className="error-banner">{error}</div>}
              {visibleMessages.length === 0 ? (
                <div className="thread-hero">
                  <div className="hero-logo">W</div>
                  <p className="hero-title">
                    {activeThread ? activeTitle : "What should we get done?"}
                  </p>
                  {activeThread && (
                    <p className="muted">
                      Thread {activeThread.id} · source {activeThread.source ?? "unknown"}
                    </p>
                  )}
                </div>
              ) : (
                <div className="message-list">
                  {visibleMessages.map((message) => renderMessage(message))}
                </div>
              )}
            </div>

            <div className="composer-stack">
              <button className="choose-project" onClick={() => void openFolder()} disabled={booting}>
                📁 Choose project
              </button>
              <form className="composer" onSubmit={sendMessage}>
                <button type="button" className="composer-plus" title="Attach a file" disabled={booting || sending}>
                  ＋
                </button>
                <textarea
                  value={input}
                  onChange={(event) => setInput(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void sendMessage();
                    }
                  }}
                  placeholder="Send a message…"
                  rows={1}
                  disabled={booting || sending}
                />
                <button
                  type="button"
                  className={`composer-approve ${alwaysAllow ? "full-access" : ""}`}
                  title="Toggle approval mode"
                  onClick={() => setAlwaysAllow((value) => !value)}
                >
                  {alwaysAllow ? "⛔ Full access" : "🧭 Ask for approval"}
                </button>
                <select
                  className="composer-model"
                  value={selectedModel ?? ""}
                  onChange={(event) => {
                    const model = models.find((item) => item.model === event.currentTarget.value);
                    setSelectedModel(event.currentTarget.value || null);
                    setSelectedEffort(model?.defaultReasoningEffort ?? null);
                  }}
                  disabled={booting || models.length === 0}
                >
                  {models.length === 0 && <option value="">Loading models…</option>}
                  {models.map((model) => (
                    <option key={model.id} value={model.model}>
                      {model.displayName || model.model}
                    </option>
                  ))}
                </select>
                <button className="composer-send" type="submit" disabled={booting || sending || !input.trim()}>
                  {sending ? "…" : "↑"}
                </button>
              </form>
            </div>
          </div>

          {rightOpen && (
            <aside className="right-pane">
              <div className="right-pane-header">
                <span className="right-pane-title">{rightTab}</span>
                <button className="icon-button" onClick={() => setRightOpen(false)}>×</button>
              </div>
              {rightTab === "events" && (
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
              )}
              {rightTab === "approvals" && (
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
                      {!approval.params.command && !approval.params.reason && <pre>{prettyJson(approval.params)}</pre>}
                      <div className="approval-actions">
                        {approval.method === "item/commandExecution/requestApproval" && (
                          <>
                            <button onClick={() => void resolveApproval(approval, { decision: "accept" })}>Accept</button>
                            <button onClick={() => void resolveApproval(approval, { decision: "acceptForSession" })}>Accept session</button>
                          </>
                        )}
                        {approval.method === "item/fileChange/requestApproval" && (
                          <>
                            <button onClick={() => void resolveApproval(approval, { decision: "accept" })}>Accept</button>
                            <button onClick={() => void resolveApproval(approval, { decision: "acceptForSession" })}>Accept session</button>
                          </>
                        )}
                        <button onClick={() => void resolveApproval(approval, { decision: "decline" })}>Decline</button>
                        <button onClick={() => void resolveApproval(approval, { decision: "cancel" })}>Cancel</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {rightTab === "terminal" && (
                <div className="terminal-pane">
                  <div className="terminal-toolbar">
                    <span className={terminalRunning ? "status-dot online" : "status-dot"} />
                    <span>{terminalRunning ? terminalProcessId : "terminal stopped"}</span>
                    <button onClick={() => void startTerminal()}>Start</button>
                    <button onClick={() => void stopTerminal()} disabled={!terminalRunning}>Stop</button>
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
                    <button type="submit" disabled={!terminalRunning || !terminalInput.trim()}>Run</button>
                  </form>
                </div>
              )}
              {rightTab === "files" && (
                <div className="files-pane">
                  <div className="files-toolbar">
                    <button
                      onClick={() => {
                        if (currentDir) void loadDirectory(parentDirectoryPath(currentDir));
                      }}
                      disabled={!currentDir || filesLoading}
                    >
                      Up
                    </button>
                    <span className="muted">{currentDir || "No folder open"}</span>
                  </div>
                  <div className="file-list">
                    {filesLoading && <div className="muted">Loading…</div>}
                    {!filesLoading && directoryEntries.map((entry) => (
                      <button
                        key={entry.fileName}
                        className="file-item"
                        onClick={() => {
                          if (!currentDir) return;
                          const path = `${currentDir.replace(/[\\/]+$/, "")}/${entry.fileName}`;
                          if (entry.isDirectory) void loadDirectory(path);
                          else void openFile(path);
                        }}
                      >
                        <span>{entry.isDirectory ? "📁" : "📄"}</span>
                        <span>{entry.fileName}</span>
                      </button>
                    ))}
                  </div>
                  {selectedFile && (
                    <div className="file-preview">
                      <div className="file-preview-head">
                        <strong>{selectedFile.path}</strong>
                        <button onClick={() => setSelectedFile(null)}>Close</button>
                      </div>
                      <pre>{selectedFile.content}</pre>
                    </div>
                  )}
                </div>
              )}
              {rightTab === "status" && (
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
          )}
            </>
          )}
        </div>
      </section>

      {settingsOpen && (
        <div className="settings-backdrop" onClick={() => setSettingsOpen(false)}>
          <div className="settings-dialog" onClick={(event) => event.stopPropagation()}>
            <h2>Settings</h2>
            <label className="settings-field">
              <span>Provider</span>
              <input
                list="provider-options"
                value={selectedProvider}
                onChange={(event) => setSelectedProvider(event.currentTarget.value)}
                placeholder="openai"
              />
              <datalist id="provider-options">
                <option value="openai" />
                <option value="anthropic" />
                <option value="google" />
                <option value="azure" />
                <option value="bedrock" />
                <option value="ollama" />
                <option value="lmstudio" />
              </datalist>
            </label>
            <label className="settings-field">
              <span>Model</span>
              <select
                value={selectedModel ?? ""}
                onChange={(event) => {
                  const model = models.find((item) => item.model === event.currentTarget.value);
                  setSelectedModel(event.currentTarget.value || null);
                  setSelectedEffort(model?.defaultReasoningEffort ?? null);
                }}
                disabled={booting || models.length === 0}
              >
                {models.length === 0 && <option value="">Loading models…</option>}
                {models.map((model) => (
                  <option key={model.id} value={model.model}>
                    {model.displayName || model.model}
                  </option>
                ))}
              </select>
            </label>
            <label className="settings-field">
              <span>Reasoning effort</span>
              <select
                value={selectedEffort ?? ""}
                onChange={(event) => setSelectedEffort(event.currentTarget.value || null)}
              >
                <option value="">Default</option>
                {(models.find((model) => model.model === selectedModel)?.supportedReasoningEfforts ?? []).map(
                  (option) => (
                    <option key={option.reasoningEffort ?? "default"} value={option.reasoningEffort ?? ""}>
                      {option.reasoningEffort || "default"}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label className="settings-field">
              <span>Theme</span>
              <button
                className="icon-button"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              >
                {theme === "dark" ? "☀️ Light" : "🌙 Dark"}
              </button>
            </label>
            <div className="settings-actions">
              <button onClick={() => setSettingsOpen(false)}>Cancel</button>
              <button onClick={saveSettings}>Save</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
export default App;
