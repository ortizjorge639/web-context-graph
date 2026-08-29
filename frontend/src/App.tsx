import { useEffect, useMemo, useRef, useState } from "react";
import { Onboarding } from "./Onboarding";
import { ThreadView } from "./ThreadView";
import { GraphView } from "./GraphView";
import { FilesExplorer } from "./FilesExplorer";
import type { FileSelection } from "./FilesExplorer";
import { FileViewer } from "./FileViewer";
import {
  createThread,
  deleteThread,
  ensureTutorial,
  getGraph,
  getThreadFiles,
  getVaultFile,
  getTutorialStatus,
  listThreads,
  reorderThreads,
  refreshVaultIndex,
  updateThread,
} from "./api";
import type { GraphData, ThreadSummary, VaultFiles } from "./api";
import {
  CloseIcon,
  ChevronIcon,
  ContactIcon,
  EditIcon,
  FilesIcon,
  GraphIcon,
  MoreIcon,
  PanelIcon,
  PinIcon,
  PlusIcon,
  ProductMark,
  SearchIcon,
  SettingsIcon,
  SparkIcon,
  ThreadIcon,
  TrashIcon,
  UserIcon,
} from "./Icons";
import "./theme.css";

type View = "onboarding" | "thread" | "graph" | "file";
type SidebarMode = "conversations" | "files";
type Appearance = "light" | "dark" | "system";
type GraphEntryData = {
  graph: GraphData;
};

const ONBOARDING_SEEN_KEY = "wcg_onboarding_seen";
const SIDEBAR_DENSITY_KEY = "wcg_sidebar_density";
const APPEARANCE_KEY = "wcg_appearance";

function App() {
  const [view, setView] = useState<View>(() =>
    window.localStorage.getItem(ONBOARDING_SEEN_KEY) ? "thread" : "onboarding"
  );
  const [threadId, setThreadId] = useState<string | null>(null);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [newThreadTitle, setNewThreadTitle] = useState("");
  const [createError, setCreateError] = useState("");
  const [tutorialReset, setTutorialReset] = useState(false);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [protectedTutorialBranches, setProtectedTutorialBranches] = useState(0);
  const [replayError, setReplayError] = useState("");
  const [graphEntryData, setGraphEntryData] = useState<GraphEntryData | null>(null);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("conversations");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [vault, setVault] = useState<VaultFiles | null>(null);
  const [selectedFile, setSelectedFile] = useState<FileSelection | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const fileRequestId = useRef(0);
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set());
  const [collapsedThreads, setCollapsedThreads] = useState<Set<string>>(new Set());
  const [branchKickoff, setBranchKickoff] = useState<{ threadId: string; message: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [openThreadMenu, setOpenThreadMenu] = useState<string | null>(null);
  const [editingThread, setEditingThread] = useState<ThreadSummary | null>(null);
  const [editedTitle, setEditedTitle] = useState("");
  const [deletingThread, setDeletingThread] = useState<ThreadSummary | null>(null);
  const [draggedThreadId, setDraggedThreadId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showContact, setShowContact] = useState(false);
  const [sidebarDensity, setSidebarDensity] = useState<"comfortable" | "compact">(
    () => window.localStorage.getItem(SIDEBAR_DENSITY_KEY) === "compact" ? "compact" : "comfortable",
  );
  const [appearance, setAppearance] = useState<Appearance>(() => {
    const saved = window.localStorage.getItem(APPEARANCE_KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  });
  const [systemDark, setSystemDark] = useState(false);
  const bootstrapRef = useRef<Promise<ThreadSummary[]> | null>(null);
  const threadsById = useMemo(
    () => new Map(threads.map((thread) => [thread.id, thread])),
    [threads],
  );
  const childThreads = useMemo(() => {
    const children = new Map<string, ThreadSummary[]>();
    for (const thread of threads) {
      const parentId = thread.forked_from?.thread_id;
      if (!parentId) continue;
      children.set(parentId, [...(children.get(parentId) ?? []), thread]);
    }
    return children;
  }, [threads]);
  const rootThreads = useMemo(
    () => threads.filter((thread) => (
      !thread.forked_from || !threadsById.has(thread.forked_from.thread_id)
    )),
    [threads, threadsById],
  );
  const pinnedRoots = useMemo(
    () => rootThreads.filter((thread) => thread.pinned),
    [rootThreads],
  );
  const unpinnedRoots = useMemo(
    () => rootThreads.filter((thread) => !thread.pinned),
    [rootThreads],
  );
  const activeAncestorIds = useMemo(() => {
    const ancestors = new Set<string>();
    let thread = threadId ? threadsById.get(threadId) : undefined;
    while (thread?.forked_from) {
      ancestors.add(thread.forked_from.thread_id);
      thread = threadsById.get(thread.forked_from.thread_id);
    }
    return ancestors;
  }, [threadId, threadsById]);

  useEffect(() => {
    if (view !== "onboarding" && !bootstrapRef.current) {
      bootstrapRef.current = listThreads().then(async (existing) => {
        if (existing.length > 0) return existing;
        const created = await createThread("Untitled thread");
        return [created];
      });
      bootstrapRef.current.then((availableThreads) => {
        setThreads(availableThreads);
        setThreadId((current) => current ?? availableThreads[0].id);
      });
    }
  }, [view]);

  useEffect(() => {
    if (view === "onboarding") return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void listThreads(searchQuery)
        .then((results) => {
          if (!cancelled) setThreads(results);
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setReplayError(error instanceof Error ? error.message : "Could not search conversations.");
          }
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchQuery, view]);

  useEffect(() => {
    if (!window.matchMedia) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setSystemDark(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  function openMainView(nextView: "thread" | "graph") {
    window.localStorage.setItem(ONBOARDING_SEEN_KEY, "1");
    if (nextView !== "graph") setGraphEntryData(null);
    setSelectedFile(null);
    setView(nextView);
  }

  async function completeOnboarding({ animated }: { animated: boolean }) {
    const prepareWorkspace = async () => {
      const tutorial = await ensureTutorial(tutorialReset);
      if (!tutorial.final_thread_id) {
        throw new Error("The tutorial graph did not include a final thread.");
      }
      const [availableThreads, graph, vault] = await Promise.all([
        listThreads(),
        getGraph(),
        getThreadFiles(tutorial.final_thread_id),
      ]);
      return { availableThreads, finalThreadId: tutorial.final_thread_id, graph, vault };
    };
    const [{ availableThreads, finalThreadId, graph, vault }] = await Promise.all([
      prepareWorkspace(),
      animated
        ? new Promise((resolve) => window.setTimeout(resolve, 480))
        : Promise.resolve(),
    ]);
    setThreads(availableThreads);
    setThreadId(finalThreadId);
    setGraphEntryData({ graph });
    setVault(vault);
    window.localStorage.setItem(ONBOARDING_SEEN_KEY, "1");
    setTutorialReset(false);
    setView("graph");
  }

  async function refreshThreads() {
    const availableThreads = await listThreads(searchQuery);
    setThreads(availableThreads);
  }

  async function refreshGraphIfOpen() {
    if (view !== "graph") return;
    try {
      setGraphEntryData({ graph: await getGraph() });
    } catch (error) {
      setReplayError(error instanceof Error ? error.message : "Could not refresh the conversation map.");
    }
  }

  function openThread(id: string) {
    const ancestors = new Set<string>();
    let thread = threadsById.get(id);
    while (thread?.forked_from) {
      ancestors.add(thread.forked_from.thread_id);
      thread = threadsById.get(thread.forked_from.thread_id);
    }
    setExpandedThreads((current) => new Set([...current, ...ancestors]));
    setCollapsedThreads((current) => {
      const next = new Set(current);
      for (const ancestor of ancestors) next.delete(ancestor);
      return next;
    });
    setBranchKickoff(null);
    setOpenThreadMenu(null);
    setThreadId(id);
    setSidebarMode("conversations");
    openMainView("thread");
    void refreshThreads();
  }

  function openForkedThread(id: string, initialMessage: string) {
    openThread(id);
    setBranchKickoff({ threadId: id, message: initialMessage });
  }

  function toggleThread(threadId: string) {
    const isExpanded = (
      expandedThreads.has(threadId)
      || (activeAncestorIds.has(threadId) && !collapsedThreads.has(threadId))
    );
    setExpandedThreads((current) => {
      const next = new Set(current);
      if (isExpanded) next.delete(threadId);
      else next.add(threadId);
      return next;
    });
    setCollapsedThreads((current) => {
      const next = new Set(current);
      if (isExpanded) next.add(threadId);
      else next.delete(threadId);
      return next;
    });
  }

  async function togglePinned(thread: ThreadSummary) {
    setOpenThreadMenu(null);
    try {
      await updateThread(thread.id, { pinned: !thread.pinned });
      await refreshThreads();
    } catch (error) {
      setReplayError(error instanceof Error ? error.message : "Could not update this conversation.");
    }
  }

  function beginRename(thread: ThreadSummary) {
    setOpenThreadMenu(null);
    setEditingThread(thread);
    setEditedTitle(thread.title);
  }

  async function submitRename(event: React.FormEvent) {
    event.preventDefault();
    if (!editingThread || !editedTitle.trim()) return;
    try {
      const updated = await updateThread(editingThread.id, { title: editedTitle.trim() });
      setEditingThread(null);
      setVault((current) => current ? {
        ...current,
        threads: current.threads.map((thread) => (
          thread.id === updated.id ? { ...thread, title: updated.title } : thread
        )),
      } : current);
      setSelectedFile((current) => (
        current?.thread?.id === updated.id
          ? { ...current, thread: { ...current.thread, title: updated.title } }
          : current
      ));
      await Promise.all([refreshThreads(), refreshGraphIfOpen()]);
    } catch (error) {
      setReplayError(error instanceof Error ? error.message : "Could not rename this conversation.");
    }
  }

  async function confirmDeleteThread() {
    if (!deletingThread) return;
    try {
      const result = await deleteThread(deletingThread.id);
      const deleted = new Set(result.deleted_ids);
      const remaining = threads.filter((thread) => !deleted.has(thread.id));
      setThreads(remaining);
      setVault((current) => current ? {
        ...current,
        threads: current.threads.filter((thread) => !deleted.has(thread.id)),
      } : current);
      if (selectedFile?.thread && deleted.has(selectedFile.thread.id)) {
        setSelectedFile(null);
        setView("thread");
      }
      setDeletingThread(null);
      if (threadId && deleted.has(threadId)) {
        setSearchQuery("");
        const nextId = result.parent_id && !deleted.has(result.parent_id)
          ? result.parent_id
          : remaining[0]?.id;
        setThreadId(nextId ?? null);
      }
      await refreshGraphIfOpen();
    } catch (error) {
      setReplayError(error instanceof Error ? error.message : "Could not delete this conversation.");
    }
  }

  async function dropRootBefore(targetId: string) {
    if (!draggedThreadId || draggedThreadId === targetId) return;
    const orderedIds = unpinnedRoots.map((thread) => thread.id);
    const fromIndex = orderedIds.indexOf(draggedThreadId);
    const targetIndex = orderedIds.indexOf(targetId);
    if (fromIndex < 0 || targetIndex < 0) return;
    orderedIds.splice(fromIndex, 1);
    orderedIds.splice(targetIndex, 0, draggedThreadId);
    setDraggedThreadId(null);
    try {
      await reorderThreads(orderedIds);
      await refreshThreads();
    } catch (error) {
      setReplayError(error instanceof Error ? error.message : "Could not reorder conversations.");
    }
  }

  function descendantCount(threadId: string): number {
    return (childThreads.get(threadId) ?? []).reduce(
      (total, child) => total + 1 + descendantCount(child.id),
      0,
    );
  }

  function renderThreadNode(thread: ThreadSummary, depth = 0): React.ReactNode {
    const children = childThreads.get(thread.id) ?? [];
    const isExpanded = (
      expandedThreads.has(thread.id)
      || (activeAncestorIds.has(thread.id) && !collapsedThreads.has(thread.id))
    );
    const canReorder = depth === 0 && !thread.forked_from && !thread.pinned && !searchQuery.trim();
    return (
      <div
        className={`thread-tree-node${draggedThreadId === thread.id ? " dragging" : ""}`}
        key={thread.id}
        style={{ paddingLeft: depth > 0 ? 14 : 0 }}
        draggable={canReorder}
        onDragStart={() => canReorder && setDraggedThreadId(thread.id)}
        onDragEnd={() => setDraggedThreadId(null)}
        onDragOver={(event) => canReorder && event.preventDefault()}
        onDrop={() => canReorder && void dropRootBefore(thread.id)}
      >
        <div className="thread-tree-row">
          {children.length > 0 ? (
            <button
              className="thread-disclosure"
              onClick={() => toggleThread(thread.id)}
              aria-label={`${isExpanded ? "Collapse" : "Expand"} ${thread.title}`}
              aria-expanded={isExpanded}
            >
              <ChevronIcon className={isExpanded ? "expanded" : ""} />
            </button>
          ) : <span className="thread-disclosure-spacer" />}
          <div className="thread-item-shell">
            <button
              className={thread.id === threadId ? "thread-item active" : "thread-item"}
              onClick={() => openThread(thread.id)}
              aria-current={thread.id === threadId ? "page" : undefined}
            >
              <span className="thread-status" />
              <span className="thread-item-copy">
                <strong>{thread.title}</strong>
                <small>{children.length > 0 ? `${children.length} ${children.length === 1 ? "branch" : "branches"}` : thread.status}</small>
              </span>
            </button>
            <button
              className="thread-menu-trigger"
              onClick={() => setOpenThreadMenu((current) => current === thread.id ? null : thread.id)}
              aria-label={`Actions for ${thread.title}`}
              aria-expanded={openThreadMenu === thread.id}
            >
              <MoreIcon />
            </button>
            {openThreadMenu === thread.id && (
              <div className="thread-menu">
                {!thread.forked_from && (
                  <button onClick={() => void togglePinned(thread)}>
                    <PinIcon />
                    <span>{thread.pinned ? "Unpin" : "Pin"}</span>
                  </button>
                )}
                <button onClick={() => beginRename(thread)}>
                  <EditIcon />
                  <span>Rename</span>
                </button>
                <button className="danger" onClick={() => {
                  setOpenThreadMenu(null);
                  setDeletingThread(thread);
                }}>
                  <TrashIcon />
                  <span>Delete</span>
                </button>
              </div>
            )}
          </div>
        </div>
        {children.length > 0 && isExpanded && (
          <div className="thread-children">
            {children.map((child) => renderThreadNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  }

  function beginCreateThread() {
    setOpenThreadMenu(null);
    setShowContact(false);
    setNewThreadTitle("");
    setCreateError("");
    setIsCreating(true);
  }

  async function refreshVault() {
    const activeId = threadId ?? threads[0]?.id;
    if (!activeId) return;
    try {
      await refreshVaultIndex();
      setVault(await getThreadFiles(activeId));
    } catch (error) {
      setReplayError(error instanceof Error ? error.message : "Could not read the local vault.");
    }
  }

  async function showFiles() {
    setSidebarCollapsed(false);
    setSidebarMode("files");
    if (view === "file") setView("thread");
    await refreshVault();
  }

  async function selectFile(selection: FileSelection) {
    const path = selection.file.path;
    const requestId = ++fileRequestId.current;
    setSelectedFile(selection);
    setFileLoading(true);
    setView("file");
    try {
      const file = await getVaultFile(path);
      if (fileRequestId.current !== requestId) return;
      setSelectedFile((current) => (
        current?.file.path === path ? { ...selection, file } : current
      ));
    } catch (error) {
      if (fileRequestId.current !== requestId) return;
      setReplayError(error instanceof Error ? error.message : "Could not load this file.");
    } finally {
      if (fileRequestId.current === requestId) setFileLoading(false);
    }
  }

  async function beginReplay() {
    setReplayError("");
    try {
      const tutorial = await getTutorialStatus();
      if (tutorial.exists && tutorial.modified) {
        setProtectedTutorialBranches(tutorial.protected_thread_ids.length);
        setShowResetDialog(true);
        return;
      }
      setTutorialReset(false);
      setView("onboarding");
    } catch (error) {
      setReplayError(error instanceof Error ? error.message : "Could not inspect the tutorial graph.");
    }
  }

  function replayTutorial(reset: boolean) {
    setTutorialReset(reset);
    setShowResetDialog(false);
    setView("onboarding");
  }

  async function submitNewThread(event: React.FormEvent) {
    event.preventDefault();
    const title = newThreadTitle.trim();
    if (!title) {
      setCreateError("Give this conversation a short title.");
      return;
    }
    try {
      const created = await createThread(title);
      setThreads((current) => [created, ...current]);
      setThreadId(created.id);
      setIsCreating(false);
      openMainView("thread");
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Could not create the conversation.");
    }
  }

  if (view === "onboarding") {
    return <Onboarding onComplete={completeOnboarding} />;
  }

  return (
    <main
      className={[
        "app-shell",
        graphEntryData && view === "graph" ? "app-arriving" : "",
        sidebarCollapsed ? "sidebar-collapsed" : "",
        sidebarDensity === "compact" ? "sidebar-compact-density" : "",
        appearance === "dark" || (appearance === "system" && systemDark) ? "theme-dark" : "theme-light",
      ].filter(Boolean).join(" ")}
    >
      <aside className="app-sidebar">
        <div className="sidebar-brand">
          <span className="sidebar-mark"><ProductMark /></span>
          <div className="sidebar-brand-copy">
            <strong>Lineage App</strong>
            <span>Knowledge you own</span>
          </div>
          <button
            className="sidebar-collapse"
            onClick={() => {
              setSidebarCollapsed((current) => !current);
              setShowContact(false);
              setOpenThreadMenu(null);
            }}
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <PanelIcon />
          </button>
        </div>

        <nav className="view-switcher" aria-label="Workspace views">
          <button
            className={sidebarMode === "conversations" && view === "thread" ? "active" : ""}
            onClick={() => {
              setSidebarMode("conversations");
              openMainView("thread");
            }}
            aria-current={sidebarMode === "conversations" && view === "thread" ? "page" : undefined}
            aria-label="Thread"
          >
            <ThreadIcon />
            <span className="sidebar-label">Thread</span>
          </button>
          <button
            className={sidebarMode === "conversations" && view === "graph" ? "active" : ""}
            onClick={() => {
              setSidebarMode("conversations");
              openMainView("graph");
            }}
            aria-current={sidebarMode === "conversations" && view === "graph" ? "page" : undefined}
            aria-label="Map"
          >
            <GraphIcon />
            <span className="sidebar-label">Map</span>
          </button>
          <button
            className={sidebarMode === "files" ? "active" : ""}
            onClick={() => void showFiles()}
            aria-current={sidebarMode === "files" ? "page" : undefined}
            aria-label="Files"
            title="Files"
          >
            <FilesIcon />
            <span className="sidebar-label">Files</span>
          </button>
        </nav>

        {sidebarMode === "conversations" && (
          <div className="conversation-tools">
            <label className="conversation-search">
              <SearchIcon />
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search conversations"
                aria-label="Search conversations"
              />
            </label>
            <button className="new-thread-button" onClick={beginCreateThread} title="New conversation">
              <PlusIcon />
              <span className="sidebar-label">New conversation</span>
            </button>
          </div>
        )}

        {sidebarMode === "conversations" ? <div className="thread-section">
          <div className="thread-list">
            {searchQuery.trim() && (
              <div className="section-heading"><span>Search results</span></div>
            )}
            {pinnedRoots.length > 0 && !searchQuery.trim() && (
              <div className="section-heading"><span>Pinned</span></div>
            )}
            {pinnedRoots.map((thread) => renderThreadNode(thread))}
            {unpinnedRoots.length > 0 && !searchQuery.trim() && (
              <div className="section-heading"><span>Conversations</span></div>
            )}
            {unpinnedRoots.map((thread) => renderThreadNode(thread))}
            {rootThreads.length === 0 && (
              <div className="thread-search-empty">No conversations found.</div>
            )}
          </div>
        </div> : (
          <div className="thread-section files-section">
            <div className="section-heading"><span>Local vault</span></div>
            <FilesExplorer
              activeThreadId={threadId}
              selectedPath={selectedFile?.file.path ?? null}
              vault={vault}
              onSelect={(selection) => void selectFile(selection)}
              onOpenThread={openThread}
              onRenameThread={(id) => {
                const thread = threads.find((candidate) => candidate.id === id);
                if (thread) beginRename(thread);
              }}
              onDeleteThread={(id) => {
                const thread = threads.find((candidate) => candidate.id === id);
                if (thread) setDeletingThread(thread);
              }}
              onRefresh={() => void refreshVault()}
            />
          </div>
        )}

        <div className="sidebar-footer">
          <button onClick={() => {
            setShowSettings(true);
            setOpenThreadMenu(null);
            setShowContact(false);
          }} title="Settings">
            <SettingsIcon />
            <span className="sidebar-label">Settings</span>
          </button>
          <div className="contact-wrap">
            <button onClick={() => {
              setShowContact((current) => !current);
              setOpenThreadMenu(null);
            }} title="Contact">
              <ContactIcon />
              <span className="sidebar-label">Contact</span>
            </button>
            {showContact && (
              <div className="contact-menu">
                <a href="https://x.com/jojiguy639" target="_blank" rel="noreferrer">X · @jojiguy639</a>
                <a href="https://www.linkedin.com/in/jorgeortizflores" target="_blank" rel="noreferrer">LinkedIn · Jorge Ortiz Flores</a>
              </div>
            )}
          </div>
          <div className="sidebar-profile" title="Jorge Ortiz">
            <span><UserIcon /></span>
            <div className="sidebar-label">
              <strong>Jorge Ortiz</strong>
              <small>@jojiguy639</small>
            </div>
          </div>
        </div>
        {replayError && <div className="sidebar-error" role="alert">{replayError}</div>}
      </aside>

      <section className="app-workspace">
        <div className="mobile-toolbar">
          <span className="sidebar-mark"><ProductMark /></span>
          <select
            aria-label="Current thread"
            value={threadId ?? ""}
            onChange={(event) => openThread(event.target.value)}
            disabled={threads.length === 0}
          >
            {threads.length === 0 && <option value="">Loading conversations</option>}
            {threads.map((thread) => (
              <option key={thread.id} value={thread.id}>{thread.title}</option>
            ))}
          </select>
          <button onClick={beginCreateThread} aria-label="New conversation"><PlusIcon /></button>
          <button onClick={() => setShowSettings(true)} aria-label="Open settings"><SettingsIcon /></button>
        </div>

        {view === "thread" && threadId && (
          <ThreadView
            key={threadId}
            threadId={threadId}
            onForked={openForkedThread}
            initialMessage={branchKickoff?.threadId === threadId ? branchKickoff.message : undefined}
            onInitialMessageConsumed={() => setBranchKickoff(null)}
            onReforked={(replacementId) => openThread(replacementId)}
          />
        )}
        {view === "thread" && !threadId && (
          <div className="workspace-loading empty-workspace">
            <span className="loading-mark"><ProductMark /></span>
            <strong>No conversations yet</strong>
            <p>Create a conversation to start building your graph.</p>
            <button onClick={beginCreateThread}>New conversation</button>
          </div>
        )}
        {view === "graph" && (
          <GraphView
            activeThreadId={threadId}
            initialGraph={graphEntryData?.graph}
            onOpenThread={openThread}
          />
        )}
        {view === "file" && selectedFile && (
          <FileViewer
            key={selectedFile.file.path}
            selection={selectedFile}
            vault={vault}
            loading={fileLoading}
            onOpenThread={openThread}
          />
        )}
        {sidebarMode === "files" && view !== "file" && (
          <div className="mobile-files-view">
            <div className="mobile-files-header">
              <span className="eyebrow">Local vault</span>
              <h1>Files</h1>
              <p>Your complete conversation graph as local Markdown.</p>
            </div>
            <FilesExplorer
              activeThreadId={threadId}
              selectedPath={selectedFile?.file.path ?? null}
              vault={vault}
              onSelect={(selection) => void selectFile(selection)}
              onOpenThread={openThread}
              onRenameThread={(id) => {
                const thread = threads.find((candidate) => candidate.id === id);
                if (thread) beginRename(thread);
              }}
              onDeleteThread={(id) => {
                const thread = threads.find((candidate) => candidate.id === id);
                if (thread) setDeletingThread(thread);
              }}
              onRefresh={() => void refreshVault()}
            />
          </div>
        )}

        <nav className="mobile-view-switcher" aria-label="Mobile workspace views">
          <button
            className={sidebarMode === "conversations" && view === "thread" ? "active" : ""}
            onClick={() => {
              setSidebarMode("conversations");
              openMainView("thread");
            }}
          >
            <ThreadIcon />
            <span>Thread</span>
          </button>
          <button
            className={sidebarMode === "conversations" && view === "graph" ? "active" : ""}
            onClick={() => {
              setSidebarMode("conversations");
              openMainView("graph");
            }}
          >
            <GraphIcon />
            <span>Map</span>
          </button>
          <button
            className={sidebarMode === "files" ? "active" : ""}
            onClick={() => void showFiles()}
          >
            <FilesIcon />
            <span>Files</span>
          </button>
        </nav>
      </section>

      {isCreating && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={() => setIsCreating(false)}>
          <form
            className="app-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-thread-heading"
            onSubmit={submitNewThread}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="dialog-close"
              onClick={() => setIsCreating(false)}
              aria-label="Close"
            >
              <CloseIcon />
            </button>
            <span className="dialog-icon"><SparkIcon /></span>
            <span className="dialog-kicker">A fresh direction</span>
            <h2 id="new-thread-heading">Start a conversation</h2>
            <p>Name the question, idea, or decision you want to explore.</p>
            <label>
              <span>Conversation title</span>
              <input
                autoFocus
                value={newThreadTitle}
                onChange={(event) => setNewThreadTitle(event.target.value)}
                placeholder="e.g. Shape the first release"
              />
            </label>
            {createError && <div className="dialog-error" role="alert">{createError}</div>}
            <div className="dialog-actions">
              <button type="button" className="button-quiet" onClick={() => setIsCreating(false)}>
                Cancel
              </button>
              <button type="submit" className="button-dark">
                Create conversation
              </button>
            </div>
          </form>
        </div>
      )}

      {editingThread && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={() => setEditingThread(null)}>
          <form className="app-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-thread-heading" onSubmit={submitRename} onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className="dialog-close" onClick={() => setEditingThread(null)} aria-label="Close"><CloseIcon /></button>
            <span className="dialog-icon"><EditIcon /></span>
            <span className="dialog-kicker">Conversation settings</span>
            <h2 id="rename-thread-heading">Rename conversation</h2>
            <label>
              <span>Title</span>
              <input autoFocus value={editedTitle} onChange={(event) => setEditedTitle(event.target.value)} />
            </label>
            <div className="dialog-actions">
              <button type="button" className="button-quiet" onClick={() => setEditingThread(null)}>Cancel</button>
              <button type="submit" className="button-dark" disabled={!editedTitle.trim()}>Save</button>
            </div>
          </form>
        </div>
      )}

      {deletingThread && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={() => setDeletingThread(null)}>
          <div className="app-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-thread-heading" onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className="dialog-close" onClick={() => setDeletingThread(null)} aria-label="Close"><CloseIcon /></button>
            <span className="dialog-icon danger"><TrashIcon /></span>
            <span className="dialog-kicker">Permanent action</span>
            <h2 id="delete-thread-heading">Delete this conversation?</h2>
            <p>
              “{deletingThread.title}”{(deletingThread.descendant_count ?? descendantCount(deletingThread.id)) > 0
                ? ` and ${deletingThread.descendant_count ?? descendantCount(deletingThread.id)} nested ${(deletingThread.descendant_count ?? descendantCount(deletingThread.id)) === 1 ? "branch" : "branches"}`
                : ""} will be removed from the vault.
            </p>
            <div className="dialog-actions">
              <button type="button" className="button-quiet" onClick={() => setDeletingThread(null)}>Cancel</button>
              <button type="button" className="button-danger" onClick={() => void confirmDeleteThread()}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={() => setShowSettings(false)}>
          <div className="app-dialog settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-heading" onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className="dialog-close" onClick={() => setShowSettings(false)} aria-label="Close"><CloseIcon /></button>
            <span className="dialog-icon"><SettingsIcon /></span>
            <span className="dialog-kicker">Workspace</span>
            <h2 id="settings-heading">Settings</h2>
            <div className="settings-row">
              <div><strong>Appearance</strong><span>Match your workspace or system.</span></div>
              <div className="settings-segmented">
                {(["light", "dark", "system"] as const).map((option) => (
                  <button
                    key={option}
                    className={appearance === option ? "active" : ""}
                    onClick={() => {
                      setAppearance(option);
                      window.localStorage.setItem(APPEARANCE_KEY, option);
                    }}
                  >
                    {option[0].toUpperCase() + option.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div className="settings-row">
              <div><strong>Sidebar density</strong><span>Adjust conversation spacing.</span></div>
              <div className="settings-segmented">
                {(["comfortable", "compact"] as const).map((density) => (
                  <button
                    key={density}
                    className={sidebarDensity === density ? "active" : ""}
                    onClick={() => {
                      setSidebarDensity(density);
                      window.localStorage.setItem(SIDEBAR_DENSITY_KEY, density);
                    }}
                  >
                    {density[0].toUpperCase() + density.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div className="settings-row">
              <div><strong>Default local vault</strong><span>Conversation data remains on the host machine.</span></div>
              <code>~/web-context-graph-data</code>
            </div>
            <div className="settings-row settings-contact">
              <div><strong>Open source</strong><span>Copyright 2026 Jorge Ortiz Flores. AGPL-3.0-or-later.</span></div>
              <div>
                <a href="https://github.com/ortizjorge639/web-context-graph" target="_blank" rel="noreferrer">Source</a>
                <a href="https://github.com/ortizjorge639/web-context-graph/blob/main/LICENSE" target="_blank" rel="noreferrer">License</a>
              </div>
            </div>
            <div className="settings-row settings-contact">
              <div><strong>Contact</strong><span>Questions, feedback, or collaboration.</span></div>
              <div>
                <a href="https://x.com/jojiguy639" target="_blank" rel="noreferrer">X</a>
                <a href="https://www.linkedin.com/in/jorgeortizflores" target="_blank" rel="noreferrer">LinkedIn</a>
              </div>
            </div>
            <button className="settings-replay" onClick={() => {
              setShowSettings(false);
              void beginReplay();
            }}>
              <SparkIcon />
              Replay introduction
            </button>
          </div>
        </div>
      )}

      {showResetDialog && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={() => setShowResetDialog(false)}>
          <div
            className="app-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-tutorial-heading"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="dialog-close"
              onClick={() => setShowResetDialog(false)}
              aria-label="Close"
            >
              <CloseIcon />
            </button>
            <span className="dialog-icon"><SparkIcon /></span>
            <span className="dialog-kicker">
              {protectedTutorialBranches ? "Branches protected" : "Tutorial changed"}
            </span>
            <h2 id="reset-tutorial-heading">
              {protectedTutorialBranches ? "Replay without losing work" : "Keep your edits?"}
            </h2>
            <p>
              {protectedTutorialBranches
                ? `${protectedTutorialBranches} user ${protectedTutorialBranches === 1 ? "branch depends" : "branches depend"} on this tutorial. Replay preserves that work; reset is unavailable until those branches are removed.`
                : "You changed the tutorial graph. Replay can preserve it or restore its original files."}
            </p>
            <div className="dialog-actions tutorial-reset-actions">
              <button className="button-quiet" onClick={() => replayTutorial(false)}>
                {protectedTutorialBranches ? "Replay safely" : "Keep my changes"}
              </button>
              {!protectedTutorialBranches && (
                <button className="button-dark" onClick={() => replayTutorial(true)}>
                  Reset tutorial
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
