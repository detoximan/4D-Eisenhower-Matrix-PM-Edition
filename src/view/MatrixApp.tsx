import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { App, EventRef } from 'obsidian';
import type { ObsidianTaskRepo } from '../obsidian-adapter/ObsidianTaskRepo.ts';
import type { Quadrant, Task } from '../core/types.ts';
import { QUADRANTS } from '../core/types.ts';
import {
  extractAllContextTags,
  formatDateISO,
  makeCompareTask,
  matchesFilter,
} from '../core/taskUtils.ts';
import { Matrix } from '../components/Matrix.tsx';
import { FilterBar } from '../components/FilterBar.tsx';
import { DateNav } from '../components/DateNav.tsx';
import type EisenhowerMatrixPlugin from '../../main.ts';

type Props = {
  app: App;
  repo: ObsidianTaskRepo;
  plugin: EisenhowerMatrixPlugin;
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

  // === Persisted settings (kopie do React state, sync přes plugin.saveSettings) ===
  const [selectedTags, setSelectedTags] = useState<string[]>(plugin.settings.selectedTags);
  const [collapsed, setCollapsed] = useState<Record<Quadrant, boolean>>(
    plugin.settings.collapsedQuadrants,
  );
  const [showCompleted, setShowCompleted] = useState<boolean>(plugin.settings.showCompleted);
  const [dayChangedBanner, setDayChangedBanner] = useState<string | null>(() => {
    const last = plugin.settings.lastOpenedDate;
    return last && last !== today ? last : null;
  });

  // Po otevření view zaznamenej dnešek jako last opened (pokud uživatel banner odbavil
  // nebo banner vůbec neexistuje). Aby přežil reload, zapíšeme až po acknowledge.
  useEffect(() => {
    if (dayChangedBanner === null) {
      plugin.settings.lastOpenedDate = today;
      void plugin.saveSettings();
    }
  }, [today, dayChangedBanner, plugin]);

  // === Persist on change ===
  useEffect(() => {
    plugin.settings.selectedTags = selectedTags;
    void plugin.saveSettings();
  }, [selectedTags, plugin]);

  useEffect(() => {
    plugin.settings.collapsedQuadrants = collapsed;
    void plugin.saveSettings();
  }, [collapsed, plugin]);

  useEffect(() => {
    plugin.settings.showCompleted = showCompleted;
    void plugin.saveSettings();
  }, [showCompleted, plugin]);

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

  // Live sync — Obsidian Vault events
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

  // === Derived state ===
  const visibleTasks = useMemo(
    () =>
      tasks.filter((t) => {
        if (!matchesFilter(t, selectedTags)) return false;
        if (showCompleted) return true;
        return !t.checked;
      }),
    [tasks, selectedTags, showCompleted],
  );

  const sortedVisibleTasks = useMemo(
    () => [...visibleTasks].sort(makeCompareTask(today)),
    [visibleTasks, today],
  );

  const availableTags = useMemo(
    () => extractAllContextTags(tasks.filter((t) => showCompleted || !t.checked)),
    [tasks, showCompleted],
  );

  const totalUnfiltered = useMemo(
    () => tasks.filter((t) => showCompleted || !t.checked).length,
    [tasks, showCompleted],
  );

  // === Handlers ===
  const toggleTag = useCallback((tag: string) => {
    setSelectedTags((prev) =>
      prev.some((t) => t.toLowerCase() === tag.toLowerCase())
        ? prev.filter((t) => t.toLowerCase() !== tag.toLowerCase())
        : [...prev, tag],
    );
  }, []);

  const clearTags = useCallback(() => setSelectedTags([]), []);

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

  const acknowledgeDayChange = useCallback(
    (jumpToToday: boolean) => {
      if (jumpToToday) setDate(today);
      plugin.settings.lastOpenedDate = today;
      void plugin.saveSettings();
      setDayChangedBanner(null);
    },
    [today, plugin],
  );

  const isPastOrFuture = date !== today;

  return (
    <div className="em-app">
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
          <button
            type="button"
            onClick={anyCollapsed ? expandAll : collapseAll}
            className="em-btn-link"
          >
            {anyCollapsed ? 'Rozbalit vše' : 'Sbalit vše'}
          </button>
          <label className="em-toggle">
            <input
              type="checkbox"
              checked={showCompleted}
              onChange={(e) => setShowCompleted(e.target.checked)}
            />
            <span>Hotové</span>
          </label>
        </div>
      </header>

      <p className="em-subtitle">
        {formatCzechDate(date)}
        {isPastOrFuture && <span className="em-warn"> (ne dnešek)</span>}
        {loading && <span className="em-loading"> · načítám…</span>}
        {!loading && (
          <span className="em-stats">
            {' '}· {tasks.length} tasků · skenováno {scannedFiles} souborů
          </span>
        )}
      </p>

      {dayChangedBanner && (
        <div className="em-banner em-banner-warn">
          <span>
            Od posledního otevření (<strong>{dayChangedBanner}</strong>) je nový den.
            Přepnout na dnešek (<strong>{today}</strong>)?
          </span>
          <div className="em-banner-actions">
            <button
              type="button"
              onClick={() => acknowledgeDayChange(true)}
              className="em-btn-primary"
            >
              Přepnout
            </button>
            <button
              type="button"
              onClick={() => acknowledgeDayChange(false)}
              className="em-btn-secondary"
            >
              Zůstat
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="em-error" role="alert">
          Chyba: {error}
        </div>
      )}

      {!todayFileExists && !loading && (
        <div className="em-info">
          Pro {date} zatím neexistuje daily note.
        </div>
      )}

      <FilterBar
        availableTags={availableTags}
        selectedTags={selectedTags}
        onToggle={toggleTag}
        onClear={clearTags}
        totalCount={totalUnfiltered}
        filteredCount={sortedVisibleTasks.length}
      />

      <Matrix
        tasks={sortedVisibleTasks}
        today={today}
        collapsed={collapsed}
        onToggleCollapsed={toggleQuadrantCollapsed}
      />
    </div>
  );
}

function formatCzechDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const days = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'];
  const months = [
    'ledna', 'února', 'března', 'dubna', 'května', 'června',
    'července', 'srpna', 'září', 'října', 'listopadu', 'prosince',
  ];
  return `${days[date.getDay()]} ${d}. ${months[m - 1]} ${y}`;
}
