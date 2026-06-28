import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'obsidian';
import type { App, EventRef, PaneType } from 'obsidian';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type Modifier,
} from '@dnd-kit/core';
import type { ObsidianTaskRepo } from '../obsidian-adapter/ObsidianTaskRepo.ts';
import { showError } from '../obsidian-adapter/toast.ts';
import type { Priority, Quadrant, Task } from '../core/types.ts';
import { QUADRANTS, isClosedStatus } from '../core/types.ts';
import {
  extractAllContextTags,
  findSubtaskBlockRange,
  findRootTask,
  canReorder,
  formatDateISO,
  makeCompareTask,
  matchesDueFilter,
  matchesFilter,
  UNTAGGED_FILTER,
  type DueFilter,
  type SortMode,
} from '../core/taskUtils.ts';
import { Matrix } from '../components/Matrix.tsx';
import { KanbanView } from '../components/KanbanView.tsx';
import { FilterBar } from '../components/FilterBar.tsx';
import { DateNav } from '../components/DateNav.tsx';
import { TaskCardOverlay, GRACE_MS } from '../components/TaskCard.tsx';
import { TagSuggest } from '../components/TagSuggest.ts';
import type EisenhowerMatrixPlugin from '../../main.ts';

type Props = {
  app: App;
  repo: ObsidianTaskRepo;
  plugin: EisenhowerMatrixPlugin;
};

function taskKey(sourceFile: string, lineIndex: number): string {
  return `${sourceFile}:${lineIndex}`;
}

// Canonical status char of the Kanban column a given status belongs to.
// Mirrors columnKeyForStatus in KanbanView (forwarded > lives in Scheduled,
// canceled - lives in Done).
function kanbanColumnStatus(s: string): string {
  if (s === '/') return '/';
  if (s === '<' || s === '>') return '<';
  if (s.toLowerCase() === 'x' || s === '-') return 'x';
  return ' ';
}

/**
 * Z events všech typů (Mouse/Pointer/Touch) vytáhne clientX/Y. Default dnd-kit
 * to neumí univerzálně, takže si to spočítáme sami.
 */
function getEventCoordinates(event: Event): { x: number; y: number } | null {
  if (event instanceof MouseEvent) {
    return { x: event.clientX, y: event.clientY };
  }
  if (typeof TouchEvent !== 'undefined' && event instanceof TouchEvent) {
    const touch = event.touches[0] ?? event.changedTouches[0];
    if (touch) return { x: touch.clientX, y: touch.clientY };
  }
  // Fallback pro PointerEvent a jiné (mají clientX/Y)
  if ('clientX' in event && 'clientY' in event) {
    const ev = event as { clientX: number; clientY: number };
    return { x: ev.clientX, y: ev.clientY };
  }
  return null;
}

/**
 * Modifier pro DragOverlay — drží STŘED overlay přímo pod kurzorem,
 * bez ohledu na to, kde uživatel kliknul na originální kartu.
 *
 * Standardní chování dnd-kit: top-left overlay = top-left source. Pokud
 * uživatel kliknul na levý horní roh karty, vypadalo to OK; pokud kliknul
 * na střed, vypadalo to že overlay „odskočil" doprava dolů.
 */
const snapCenterToCursor: Modifier = ({
  activatorEvent,
  draggingNodeRect,
  transform,
}) => {
  if (!draggingNodeRect || !activatorEvent) return transform;
  const coords = getEventCoordinates(activatorEvent);
  if (!coords) return transform;
  const offsetX = coords.x - draggingNodeRect.left;
  const offsetY = coords.y - draggingNodeRect.top;
  return {
    ...transform,
    x: transform.x + offsetX - draggingNodeRect.width / 2,
    y: transform.y + offsetY - draggingNodeRect.height / 2,
  };
};

/**
 * Collision detection — pointerWithin (kurzor jako autorita) má přednost.
 * Pokud kurzor není přímo nad žádným droppable (např. kvůli scroll, malé
 * obrazovce), fallback na rectIntersection (bbox overlay vs droppable).
 */
const cursorFirstCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) return pointerCollisions;
  return rectIntersection(args);
};

export function MatrixApp({ app, repo, plugin }: Props) {
  const today = useMemo(() => formatDateISO(new Date()), []);
  const [date, setDate] = useState<string>(today);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [todayFileExists, setTodayFileExists] = useState(false);
  const [scannedFiles, setScannedFiles] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [existingDates, setExistingDates] = useState<Set<string>>(() => new Set());

  // Settings (persisted)
  const [selectedTags, setSelectedTags] = useState<string[]>(plugin.settings.selectedTags);
  const [dueFilter, setDueFilter] = useState<DueFilter>(plugin.settings.dueFilter);
  const [collapsed, setCollapsed] = useState<Record<Quadrant, boolean>>(
    plugin.settings.collapsedQuadrants,
  );
  const [showCompleted, setShowCompleted] = useState<boolean>(plugin.settings.showCompleted);
  const [headerCollapsed, setHeaderCollapsed] = useState<boolean>(
    plugin.settings.headerCollapsed,
  );
  const [compactMode, setCompactMode] = useState<boolean>(plugin.settings.compactMode);
  const [kanbanQuadrant, setKanbanQuadrant] = useState<Quadrant | null>(
    plugin.settings.kanbanQuadrant,
  );
  const [sortMode, setSortMode] = useState<SortMode>(plugin.settings.sortMode);
  const [collapsedParents, setCollapsedParents] = useState<Set<string>>(() => new Set());
  const [dayChangedBanner, setDayChangedBanner] = useState<string | null>(() => {
    const last = plugin.settings.lastOpenedDate;
    return last && last !== today ? last : null;
  });

  // Grace period: map key (sourceFile:lineIndex) -> expiresAt timestamp
  const [graceMap, setGraceMap] = useState<Map<string, number>>(() => new Map());
  const [, setTick] = useState(0);

  // Update last opened
  useEffect(() => {
    if (dayChangedBanner === null) {
      plugin.settings.lastOpenedDate = today;
      void plugin.saveSettings();
    }
  }, [today, dayChangedBanner, plugin]);

  useEffect(() => {
    plugin.settings.selectedTags = selectedTags;
    void plugin.saveSettings();
  }, [selectedTags, plugin]);

  useEffect(() => {
    plugin.settings.dueFilter = dueFilter;
    void plugin.saveSettings();
  }, [dueFilter, plugin]);

  useEffect(() => {
    plugin.settings.collapsedQuadrants = collapsed;
    void plugin.saveSettings();
  }, [collapsed, plugin]);

  useEffect(() => {
    plugin.settings.showCompleted = showCompleted;
    void plugin.saveSettings();
  }, [showCompleted, plugin]);

  useEffect(() => {
    plugin.settings.headerCollapsed = headerCollapsed;
    void plugin.saveSettings();
  }, [headerCollapsed, plugin]);

  useEffect(() => {
    plugin.settings.compactMode = compactMode;
    void plugin.saveSettings();
  }, [compactMode, plugin]);

  useEffect(() => {
    plugin.settings.kanbanQuadrant = kanbanQuadrant;
    void plugin.saveSettings();
  }, [kanbanQuadrant, plugin]);

  useEffect(() => {
    plugin.settings.sortMode = sortMode;
    void plugin.saveSettings();
  }, [sortMode, plugin]);

  // === Data fetching ===
  const refetchTimerRef = useRef<number | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const result = await repo.getMatrixTasks(date);
      setTasks(result.tasks);
      setTodayFileExists(result.todayFileExists);
      setScannedFiles(result.scannedFiles);
      setExistingDates(repo.getExistingDailyDates());
      setError(null);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setLoading(false);
    }
  }, [repo, date]);

  const scheduleRefetch = useCallback(() => {
    if (refetchTimerRef.current) window.clearTimeout(refetchTimerRef.current);
    refetchTimerRef.current = window.setTimeout(() => {
      void refetch();
      refetchTimerRef.current = null;
    }, 200);
  }, [refetch]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Live sync
  useEffect(() => {
    const refs: EventRef[] = [];
    refs.push(app.vault.on('modify', scheduleRefetch));
    refs.push(app.vault.on('create', scheduleRefetch));
    refs.push(app.vault.on('delete', scheduleRefetch));
    refs.push(app.vault.on('rename', scheduleRefetch));
    return () => {
      for (const ref of refs) app.vault.offref(ref);
      if (refetchTimerRef.current) window.clearTimeout(refetchTimerRef.current);
    };
  }, [app, scheduleRefetch]);

  // Grace period interval — clean expired keys + re-render
  useEffect(() => {
    if (graceMap.size === 0) return;
    const interval = window.setInterval(() => {
      const now = Date.now();
      let mutated = false;
      setGraceMap((prev) => {
        const next = new Map(prev);
        for (const [k, exp] of next) {
          if (exp <= now) {
            next.delete(k);
            mutated = true;
          }
        }
        return mutated ? next : prev;
      });
      setTick((t) => t + 1);
    }, 250);
    return () => window.clearInterval(interval);
  }, [graceMap.size]);

  // === Local optimistic mutations ===
  // Optimisticky nastav status tasku + zařiď grace pro "closed" stavy
  // ([x] done a [-] canceled). Voláno z toggle (klik na box) i setStatus
  // (menu "Mark as …") — oba sdílejí stejné chování undo-grace.
  const applyLocalStatus = useCallback(
    (sourceFile: string, lineIndex: number, newStatus: string) => {
      const key = taskKey(sourceFile, lineIndex);
      const isChecked = newStatus.toLowerCase() === 'x';
      const isClosed = isClosedStatus(newStatus);
      setTasks((prev) =>
        prev.map((t) =>
          t.sourceFile === sourceFile && t.lineIndex === lineIndex
            ? {
                ...t,
                status: newStatus,
                checked: isChecked,
                doneDate: isChecked ? today : undefined,
              }
            : t,
        ),
      );
      if (isClosed) {
        setGraceMap((prev) => {
          const next = new Map(prev);
          next.set(key, Date.now() + GRACE_MS);
          return next;
        });
      } else {
        setGraceMap((prev) => {
          if (!prev.has(key)) return prev;
          const next = new Map(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [today],
  );

  // === Write callbacks ===
  const handleToggle = useCallback(
    async (task: Task) => {
      // Z [x]/[-] zpátky na [ ], jinak na [x] — zrcadlí toggleLine v core.
      const newStatus = isClosedStatus(task.status) ? ' ' : 'x';
      applyLocalStatus(task.sourceFile, task.lineIndex, newStatus);
      try {
        await repo.toggleTask(task.sourceFile, task.lineIndex, today);
      } catch (e) {
        applyLocalStatus(task.sourceFile, task.lineIndex, task.status);
        showError(`Toggle failed: ${String((e as Error).message ?? e)}`);
      }
    },
    [repo, today, applyLocalStatus],
  );

  const handleSetDueDate = useCallback(
    async (task: Task, newDueDate: string | null) => {
      try {
        await repo.setDueDate(task.sourceFile, task.lineIndex, newDueDate);
      } catch (e) {
        showError(`Changing due date failed: ${String((e as Error).message ?? e)}`);
      }
    },
    [repo],
  );

  const handleSetStatus = useCallback(
    async (task: Task, newStatus: string) => {
      const previousStatus = task.status;
      // Stejný optimistic flow jako u toggle — pro [x]/[-] nastartuje
      // 3s grace s undo, ostatní stavy se promítnou rovnou.
      applyLocalStatus(task.sourceFile, task.lineIndex, newStatus);
      try {
        await repo.setStatus(task.sourceFile, task.lineIndex, newStatus, today);
      } catch (e) {
        applyLocalStatus(task.sourceFile, task.lineIndex, previousStatus);
        showError(`Changing status failed: ${String((e as Error).message ?? e)}`);
      }
    },
    [repo, today, applyLocalStatus],
  );

  const handleUpdate = useCallback(
    async (
      task: Task,
      text: string,
      contextTags: string[],
      options: { dueDate: string | null; priority: Priority | null },
    ) => {
      try {
        await repo.updateTask(task.sourceFile, task.lineIndex, text, contextTags, options);
      } catch (e) {
        showError(`Save failed: ${String((e as Error).message ?? e)}`);
        throw e;
      }
    },
    [repo],
  );

  const handleAdd = useCallback(
    async (input: {
      text: string;
      quadrant: Quadrant;
      dueDate: string | null;
      priority: Priority | null;
      status?: string;
    }) => {
      try {
        await repo.addTask(
          date,
          input.text,
          input.quadrant,
          input.dueDate,
          input.priority,
          input.status ?? ' ',
        );
      } catch (e) {
        showError(`Adding task failed: ${String((e as Error).message ?? e)}`);
        throw e;
      }
    },
    [repo, date],
  );

  const handleOpenSource = useCallback(
    (task: Task, mode: PaneType | boolean = false) => {
      const file = app.vault.getFileByPath(task.sourceFile);
      if (!file) {
        showError(`File not found: ${task.sourceFile}`);
        return;
      }
      const leaf = app.workspace.getLeaf(mode);
      void leaf.openFile(file, {
        active: true,
        eState: { line: task.lineIndex },
      });
    },
    [app],
  );

  // === Derived state ===
  const visibleTasks = useMemo(
    () => {
      // First pass: filter root tasks and subtasks with their own tags
      const passed = new Set<number>();
      for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];
        if (!matchesFilter(t, selectedTags)) continue;
        if (!matchesDueFilter(t, dueFilter, today, date)) continue;
        if (!showCompleted) {
          if (isClosedStatus(t.status) && !graceMap.has(taskKey(t.sourceFile, t.lineIndex))) continue;
        }
        passed.add(i);
      }

      // Second pass: include subtasks whose parent passed the filter
      for (let i = 0; i < tasks.length; i++) {
        if (passed.has(i)) continue;
        const t = tasks[i];
        if (t.parentIndex !== undefined && passed.has(t.parentIndex)) {
          // Inherit due date filter from parent (subtask may not have its own dueDate)
          if (!showCompleted && isClosedStatus(t.status) && !graceMap.has(taskKey(t.sourceFile, t.lineIndex))) continue;
          passed.add(i);
        }
      }

      return tasks.filter((_, i) => passed.has(i));
    },
    [tasks, selectedTags, dueFilter, today, date, showCompleted, graceMap],
  );

  // Rank each root task within its OWN quadrant for its project, ordered by the
  // task's position in the project file. Ranks restart at 1 for every
  // (quadrant, project) pair, so numbering is per-quadrant (not project-wide)
  // and stays aligned across projects when interleaving.
  const quadrantProjectRank = useMemo(() => {
    const groups = new Map<string, Task[]>();
    for (const t of visibleTasks) {
      if (t.indent !== 0) continue;
      if (t.projectKey === undefined) continue;
      const groupKey = `${t.quadrant}|${t.projectKey}`;
      let arr = groups.get(groupKey);
      if (!arr) {
        arr = [];
        groups.set(groupKey, arr);
      }
      arr.push(t);
    }
    const ranks = new Map<string, number>();
    for (const arr of groups.values()) {
      arr.sort((a, b) => (a.projectLinkLine ?? 0) - (b.projectLinkLine ?? 0));
      arr.forEach((t, i) => ranks.set(taskKey(t.sourceFile, t.lineIndex), i + 1));
    }
    return ranks;
  }, [visibleTasks]);

  const sortedVisibleTasks = useMemo(
    () => {
      const arr = [...visibleTasks];
      const autoCompare = makeCompareTask(today, tasks);
      arr.sort((a, b) => {
        const aRoot = findRootTask(a, tasks);
        const bRoot = findRootTask(b, tasks);
        // Keep each subtask directly under its own root.
        if (aRoot === bRoot) {
          if (a.indent === 0 && b.indent > 0) return -1;
          if (b.indent === 0 && a.indent > 0) return 1;
          return a.lineIndex - b.lineIndex;
        }
        // Primary order for ROOT tasks: their rank WITHIN their own quadrant for
        // their project (1,2,3\u2026 restarting per quadrant per project). Puts all
        // rank-1 tasks first, then rank-2, etc., aligned across projects, the
        // same in auto and manual modes.
        const ar = quadrantProjectRank.get(taskKey(aRoot.sourceFile, aRoot.lineIndex));
        const br = quadrantProjectRank.get(taskKey(bRoot.sourceFile, bRoot.lineIndex));
        if (ar !== undefined && br !== undefined) {
          if (ar !== br) return ar - br;
        } else if (ar !== undefined) {
          return -1;
        } else if (br !== undefined) {
          return 1;
        }
        // Same rank, or tasks without a project: fall back to the sort mode.
        if (sortMode === 'manual') {
          if (aRoot.sourceFile !== bRoot.sourceFile) {
            return aRoot.sourceFile.localeCompare(bRoot.sourceFile);
          }
          return aRoot.lineIndex - bRoot.lineIndex;
        }
        return autoCompare(aRoot, bRoot);
      });
      return arr;
    },
    [visibleTasks, today, tasks, sortMode, quadrantProjectRank],
  );

  const availableTags = useMemo(
    () =>
      extractAllContextTags(
        tasks.filter((t) => showCompleted || !isClosedStatus(t.status)),
      ),
    [tasks, showCompleted],
  );

  // Live ref na seznam tagů pro autocomplete v add/edit formech.
  // Ref místo state aby se TagSuggest nemusel re-instantovat když se tagy mění.
  const availableTagNamesRef = useRef<string[]>([]);
  availableTagNamesRef.current = availableTags
    .filter((t) => t.tag !== UNTAGGED_FILTER)
    .map((t) => t.tag);

  const createTagSuggest = useCallback(
    (inputEl: HTMLInputElement) => {
      new TagSuggest(app, inputEl, () => availableTagNamesRef.current);
    },
    [app],
  );

  const totalUnfiltered = useMemo(
    () => tasks.filter((t) => showCompleted || !isClosedStatus(t.status)).length,
    [tasks, showCompleted],
  );

  // === UI handlers ===
  const toggleTag = useCallback((tag: string) => {
    setSelectedTags((prev) =>
      prev.some((t) => t.toLowerCase() === tag.toLowerCase())
        ? prev.filter((t) => t.toLowerCase() !== tag.toLowerCase())
        : [...prev, tag],
    );
  }, []);

  const clearFilters = useCallback(() => {
    setSelectedTags([]);
    setDueFilter('none');
  }, []);

  const toggleDueFilter = useCallback((f: DueFilter) => {
    setDueFilter((prev) => (prev === f ? 'none' : f));
  }, []);

  const toggleQuadrantCollapsed = useCallback((q: Quadrant) => {
    setCollapsed((prev) => ({ ...prev, [q]: !prev[q] }));
  }, []);

  const anyCollapsed = Object.values(collapsed).some(Boolean);

  const collapseAll = useCallback(() => {
    setCollapsed(
      Object.fromEntries(QUADRANTS.map((q) => [q, true])) as Record<Quadrant, boolean>,
    );
  }, []);

  const expandAll = useCallback(() => {
    setCollapsed(
      Object.fromEntries(QUADRANTS.map((q) => [q, false])) as Record<Quadrant, boolean>,
    );
  }, []);

  // === Subtask (parent) collapse — lifted here so one global control and each
  // quadrant's button share a single source of truth across the whole matrix. ===
  const toggleParentCollapse = useCallback((key: string) => {
    setCollapsedParents((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const collapseTaskKeys = useCallback((keys: string[]) => {
    setCollapsedParents((prev) => {
      if (keys.length === 0) return prev;
      const next = new Set(prev);
      for (const k of keys) next.add(k);
      return next;
    });
  }, []);

  const expandTaskKeys = useCallback((keys: string[]) => {
    setCollapsedParents((prev) => {
      if (keys.length === 0) return prev;
      const next = new Set(prev);
      for (const k of keys) next.delete(k);
      return next;
    });
  }, []);

  // All root tasks (anywhere in the matrix) that actually have subtasks.
  const collapsibleParentKeys = useMemo(() => {
    const rootKeyByFile = new Map<string, string>();
    for (const t of sortedVisibleTasks) {
      if (t.indent === 0) rootKeyByFile.set(t.sourceFile, taskKey(t.sourceFile, t.lineIndex));
    }
    const set = new Set<string>();
    for (const t of sortedVisibleTasks) {
      if (t.indent > 0) {
        const rk = rootKeyByFile.get(t.sourceFile);
        if (rk) set.add(rk);
      }
    }
    return [...set];
  }, [sortedVisibleTasks]);

  const allTasksCollapsed =
    collapsibleParentKeys.length > 0 &&
    collapsibleParentKeys.every((k) => collapsedParents.has(k));

  const collapseAllTasks = useCallback(() => {
    collapseTaskKeys(collapsibleParentKeys);
  }, [collapseTaskKeys, collapsibleParentKeys]);

  const expandAllTasks = useCallback(() => {
    setCollapsedParents(new Set());
  }, []);

  // Kanban: klik na ikonu zvoleného kvadrantu vypne (zpět na mřížku),
  // klik na jiný kvadrant prohodí fokus.
  const toggleKanban = useCallback((q: Quadrant) => {
    setKanbanQuadrant((prev) => (prev === q ? null : q));
  }, []);

  const acknowledgeDayChange = useCallback(
    (jumpToToday: boolean) => {
      if (jumpToToday) setDate(today);
      plugin.settings.lastOpenedDate = today;
      void plugin.saveSettings();
      setDayChangedBanner(null);
    },
    [today, plugin],
  );

  // === Drag & drop ===
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  );
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  const onDragStart = useCallback(
    (e: DragStartEvent) => {
      const id = String(e.active.id);
      const t = tasks.find((x) => taskKey(x.sourceFile, x.lineIndex) === id);
      setActiveTask(t ?? null);
    },
    [tasks],
  );

  // Přesun tasku do jiného kvadrantu — sdíleno mezi drag-end a context menu.
  const handleMove = useCallback(
    async (task: Task, targetQuadrant: Quadrant) => {
      if (task.quadrant === targetQuadrant) return;
      const id = taskKey(task.sourceFile, task.lineIndex);

      // Optimistic update
      setTasks((prev) =>
        prev.map((t) =>
          taskKey(t.sourceFile, t.lineIndex) === id
            ? { ...t, quadrant: targetQuadrant }
            : t,
        ),
      );

      try {
        await repo.moveTask(task.sourceFile, task.lineIndex, targetQuadrant);
      } catch (err) {
        // rollback
        setTasks((prev) =>
          prev.map((t) => (taskKey(t.sourceFile, t.lineIndex) === id ? task : t)),
        );
        showError(`Move failed: ${String((err as Error).message ?? err)}`);
      }
    },
    [repo],
  );

  // Kanban drop ze spodního kvadrantu do status-sloupce: kvadrant + status najednou.
  const handleMoveAndSetStatus = useCallback(
    async (task: Task, targetQuadrant: Quadrant, newStatus: string) => {
      const id = taskKey(task.sourceFile, task.lineIndex);
      applyLocalStatus(task.sourceFile, task.lineIndex, newStatus);
      setTasks((prev) =>
        prev.map((t) =>
          taskKey(t.sourceFile, t.lineIndex) === id ? { ...t, quadrant: targetQuadrant } : t,
        ),
      );
      try {
        await repo.moveAndSetStatus(
          task.sourceFile,
          task.lineIndex,
          targetQuadrant,
          newStatus,
          today,
        );
      } catch (err) {
        applyLocalStatus(task.sourceFile, task.lineIndex, task.status);
        setTasks((prev) =>
          prev.map((t) => (taskKey(t.sourceFile, t.lineIndex) === id ? task : t)),
        );
        showError(`Move failed: ${String((err as Error).message ?? err)}`);
      }
    },
    [repo, today, applyLocalStatus],
  );

  // Reorder task block (manual sort mode): move task+subtasks to new position
  const handleReorder = useCallback(
    async (
      sourceFile: string,
      sourceStart: number,
      sourceEnd: number,
      targetLine: number,
    ) => {
      try {
        await repo.reorderTaskBlock(sourceFile, sourceStart, sourceEnd, targetLine);
      } catch (err) {
        showError(`Reorder failed: ${String((err as Error).message ?? err)}`);
      }
    },
    [repo],
  );

  // Reorder a parent/root task: persist its new position into the project file.
  const handleReorderProject = useCallback(
    async (projectFile: string, sourceLine: number, targetLine: number) => {
      try {
        await repo.reorderProjectLink(projectFile, sourceLine, targetLine);
      } catch (err) {
        showError(`Reorder failed: ${String((err as Error).message ?? err)}`);
      }
    },
    [repo],
  );

  const onDragEnd = useCallback(
    async (e: DragEndEvent) => {
      setActiveTask(null);
      if (!e.over) return;

      const draggedId = String(e.active.id);
      const overId = String(e.over.id);
      if (draggedId === overId) return;

      const dragged = tasks.find((t) => taskKey(t.sourceFile, t.lineIndex) === draggedId);
      if (!dragged) return;

      // Kanban status-sloupec → změna checkboxu (+ případně kvadrantu).
      if (overId.startsWith('kanban-status:')) {
        const statusChar = overId.slice('kanban-status:'.length);
        if (kanbanQuadrant && dragged.quadrant !== kanbanQuadrant) {
          await handleMoveAndSetStatus(dragged, kanbanQuadrant, statusChar);
        } else if (dragged.status !== statusChar) {
          await handleSetStatus(dragged, statusChar);
        }
        return;
      }

      // Kanban: a full status column hides its drop area behind cards, so a
      // drop often lands ON a card. If that card is in the focused (main)
      // quadrant, treat it as a drop into that card's status column.
      if (kanbanQuadrant) {
        const overTaskK = tasks.find((t) => taskKey(t.sourceFile, t.lineIndex) === overId);
        if (overTaskK && overTaskK.quadrant === kanbanQuadrant) {
          const targetStatus = kanbanColumnStatus(overTaskK.status);
          if (dragged.quadrant !== kanbanQuadrant) {
            await handleMoveAndSetStatus(dragged, kanbanQuadrant, targetStatus);
          } else if (dragged.status !== targetStatus) {
            await handleSetStatus(dragged, targetStatus);
          }
          return;
        }
      }

      // Drop on another task card (not a quadrant droppable).
      if (!QUADRANTS.includes(overId as Quadrant)) {
        const overTask = tasks.find((t) => taskKey(t.sourceFile, t.lineIndex) === overId);
        if (overTask) {
          // Different quadrant -> move the task to that quadrant.
          if (overTask.quadrant !== dragged.quadrant) {
            await handleMove(dragged, overTask.quadrant);
            return;
          }
          // Same quadrant -> reorder.
          if (dragged.indent === 0 && overTask.indent === 0) {
            // Root/parent tasks: persist order into the shared project file.
            if (
              dragged.projectKey &&
              dragged.projectKey === overTask.projectKey &&
              dragged.projectLinkLine !== undefined &&
              overTask.projectLinkLine !== undefined
            ) {
              const srcLine = dragged.projectLinkLine;
              const tgtLine = overTask.projectLinkLine;
              const targetLine = srcLine < tgtLine ? tgtLine + 1 : tgtLine;
              if (sortMode !== 'manual') setSortMode('manual');
              await handleReorderProject(dragged.projectKey, srcLine, targetLine);
            }
            // No shared project file -> order can't be persisted; do nothing.
            return;
          }
          // Subtasks: reorder within their parent (in the task file).
          if (canReorder(dragged, overTask, tasks)) {
            const [srcStart, srcEnd] = findSubtaskBlockRange(dragged, tasks);
            const [tgtStart, tgtEnd] = findSubtaskBlockRange(overTask, tasks);
            const targetLine = srcStart < tgtStart ? tgtEnd + 1 : tgtStart;
            // Manual reordering only makes sense in manual sort mode -
            // switch automatically so the new order is not re-sorted away.
            if (sortMode !== 'manual') setSortMode('manual');
            await handleReorder(dragged.sourceFile, srcStart, srcEnd, targetLine);
            return;
          }
          // Same quadrant but cannot reorder -> nothing to do.
          return;
        }
      }

      // Drop on quadrant droppable → change quadrant.
      if (QUADRANTS.includes(overId as Quadrant)) {
        await handleMove(dragged, overId as Quadrant);
      }
    },
    [tasks, handleMove, handleSetStatus, handleMoveAndSetStatus, handleReorder, handleReorderProject, kanbanQuadrant, sortMode, setSortMode],
  );

  const isPastOrFuture = date !== today;
  // Kanban je dostupný i na mobilu/tabletu. Přesun mezi status-sloupci tam
  // nejde dragem (touch-drag je v Obsidian webview nespolehlivý) — řeší se přes
  // kontextové menu karty „Mark as…", stejně jako přesun mezi kvadranty.
  const effectiveKanban = kanbanQuadrant;

  // Ovládání zobrazení (Collapse all / Done / Compact) — sdílené mezi
  // rozbalenou i sbalenou hlavičkou, ať jsou ty přepínače dostupné i
  // když je hlavička sbalená (uživatel je chce mít po ruce vždy).
  const viewControls = (
    <>
      <button
        type="button"
        onClick={anyCollapsed ? expandAll : collapseAll}
        className="em-btn-link"
      >
        {anyCollapsed ? 'Expand all' : 'Collapse all'}
      </button>
      <button
        type="button"
        onClick={allTasksCollapsed ? expandAllTasks : collapseAllTasks}
        className="em-btn-link"
        title={allTasksCollapsed ? 'Expand all subtasks everywhere' : 'Collapse all subtasks everywhere'}
      >
        {allTasksCollapsed ? '▶ Expand all tasks' : '▼ Collapse all tasks'}
      </button>
      <label className="em-toggle">
        <input
          type="checkbox"
          checked={showCompleted}
          onChange={(e) => setShowCompleted(e.target.checked)}
        />
        <span>Done</span>
      </label>
      <label className="em-toggle" title="Compact 2-line task cards">
        <input
          type="checkbox"
          checked={compactMode}
          onChange={(e) => setCompactMode(e.target.checked)}
        />
        <span>Compact</span>
      </label>
      <button
        type="button"
        onClick={() => setSortMode((prev) => (prev === 'auto' ? 'manual' : 'auto'))}
        className={`em-btn-link ${sortMode === 'manual' ? 'em-sort-manual' : ''}`}
        title={sortMode === 'auto' ? 'Auto sort (priority/due) — click for manual order' : 'Manual order (file) — click for auto sort'}
      >
        {sortMode === 'auto' ? '⬆⬇ Auto' : '☰ Manual'}
      </button>
    </>
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={cursorFirstCollisionDetection}
      onDragStart={onDragStart}
      onDragEnd={(e) => void onDragEnd(e)}
    >
      <div className="em-app">
        {headerCollapsed ? (
          <div className="em-app-header em-app-header-compact">
            <span className="em-compact-info">⚡ {totalUnfiltered} tasks</span>
            <div className="em-header-right">
              {viewControls}
              <button
                type="button"
                onClick={() => setHeaderCollapsed(false)}
                className="em-header-collapse-btn"
                title="Expand header"
                aria-label="Expand header"
              >
                ▼
              </button>
            </div>
          </div>
        ) : (
        <div className="em-app-header">
        <header className="em-header">
          <div className="em-header-left">
            <h2 className="em-title">Eisenhower Matrix</h2>
            <DateNav
              date={date}
              today={today}
              existingDates={existingDates}
              onChange={setDate}
            />
          </div>
          <div className="em-header-right">
            {viewControls}
            <button
              type="button"
              onClick={() => setHeaderCollapsed(true)}
              className="em-header-collapse-btn"
              title="Collapse the whole header (frees up space)"
              aria-label="Collapse header"
            >
              ▲
            </button>
          </div>
        </header>

        <p className="em-subtitle">
          {formatDisplayDate(date)}
          {isPastOrFuture && <span className="em-warn"> (not today)</span>}
          {loading && <span className="em-loading"> · loading…</span>}
          {!loading && (
            <span className="em-stats">
              {' '}· {totalUnfiltered} tasks · {scannedFiles} files scanned
            </span>
          )}
        </p>

        {dayChangedBanner && (
          <div className="em-banner em-banner-warn">
            <span>
              A new day has started since you last opened this (
              <strong>{dayChangedBanner}</strong>). Switch to today (
              <strong>{today}</strong>)?
            </span>
            <div className="em-banner-actions">
              <button
                type="button"
                onClick={() => acknowledgeDayChange(true)}
                className="em-btn-primary"
              >
                Switch
              </button>
              <button
                type="button"
                onClick={() => acknowledgeDayChange(false)}
                className="em-btn-secondary"
              >
                Stay
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="em-error" role="alert">
            Error: {error}
          </div>
        )}

        {!todayFileExists && !loading && (
          <div className="em-info">
            No daily note exists for {date} yet. Add the first task via <code>+</code>{' '}
            in any quadrant — the file is created automatically.
          </div>
        )}

        <FilterBar
          availableTags={availableTags}
          selectedTags={selectedTags}
          dueFilter={dueFilter}
          selectedDate={date}
          onToggle={toggleTag}
          onDueFilter={toggleDueFilter}
          onClear={clearFilters}
          totalCount={totalUnfiltered}
          filteredCount={sortedVisibleTasks.length}
        />
        </div>
        )}

        <div className="em-app-body">
        {effectiveKanban ? (
          <KanbanView
            collapsedParents={collapsedParents}
            onToggleParentCollapse={toggleParentCollapse}
            onCollapseTasks={collapseTaskKeys}
            onExpandTasks={expandTaskKeys}
            kanbanQuadrant={effectiveKanban}
            tasks={sortedVisibleTasks}
            today={today}
            collapsed={collapsed}
            graceMap={graceMap}
            compact={compactMode}
            sortMode={sortMode}
            activeTaskId={
              activeTask ? taskKey(activeTask.sourceFile, activeTask.lineIndex) : null
            }
            onToggleKanban={toggleKanban}
            onToggleCollapsed={toggleQuadrantCollapsed}
            onToggleTask={(t) => void handleToggle(t)}
            onSetStatus={handleSetStatus}
            onSetDueDate={handleSetDueDate}
            onUpdateTask={handleUpdate}
            onAddTask={handleAdd}
            onOpenSource={handleOpenSource}
            onMoveQuadrant={(t, q) => void handleMove(t, q)}
            createTagSuggest={createTagSuggest}
          />
        ) : (
          <Matrix
            collapsedParents={collapsedParents}
            onToggleParentCollapse={toggleParentCollapse}
            onCollapseTasks={collapseTaskKeys}
            onExpandTasks={expandTaskKeys}
            tasks={sortedVisibleTasks}
            today={today}
            collapsed={collapsed}
            graceMap={graceMap}
            compact={compactMode}
            sortMode={sortMode}
            activeTaskId={
              activeTask ? taskKey(activeTask.sourceFile, activeTask.lineIndex) : null
            }
            kanbanQuadrant={effectiveKanban}
            onToggleKanban={toggleKanban}
            onToggleCollapsed={toggleQuadrantCollapsed}
            onToggleTask={(t) => void handleToggle(t)}
            onSetStatus={handleSetStatus}
            onSetDueDate={handleSetDueDate}
            onUpdateTask={handleUpdate}
            onAddTask={handleAdd}
            onOpenSource={handleOpenSource}
            onMoveQuadrant={(t, q) => void handleMove(t, q)}
            createTagSuggest={createTagSuggest}
          />
        )}
        </div>
      </div>
      {/* DragOverlay jen na desktopu — na mobilu se posouvá originální karta
          (position:fixed overlay je na Obsidian mobile nespolehlivý). */}
      <DragOverlay dropAnimation={null} modifiers={[snapCenterToCursor]}>
        {activeTask && !Platform.isMobile ? <TaskCardOverlay task={activeTask} /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function formatDisplayDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return `${days[date.getDay()]} ${d} ${months[m - 1]} ${y}`;
}
