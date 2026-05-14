import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { App, EventRef } from 'obsidian';
import type { ObsidianTaskRepo } from '../obsidian-adapter/ObsidianTaskRepo.ts';
import type { Task } from '../core/types.ts';
import { formatDateISO, makeCompareTask } from '../core/taskUtils.ts';
import { Matrix } from '../components/Matrix.tsx';

type Props = {
  app: App;
  repo: ObsidianTaskRepo;
};

export function MatrixApp({ app, repo }: Props) {
  const today = useMemo(() => formatDateISO(new Date()), []);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [todayFileExists, setTodayFileExists] = useState(false);
  const [scannedFiles, setScannedFiles] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetchTimerRef = useRef<number | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const result = await repo.getMatrixTasks(today);
      setTasks(result.tasks);
      setTodayFileExists(result.todayFileExists);
      setScannedFiles(result.scannedFiles);
      setError(null);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setLoading(false);
    }
  }, [repo, today]);

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

  const sortedTasks = useMemo(() => {
    return [...tasks].sort(makeCompareTask(today));
  }, [tasks, today]);

  return (
    <div className="em-app">
      <header className="em-header">
        <h2 className="em-title">Eisenhower Matrix</h2>
        <div className="em-meta">
          <span>{formatCzechDate(today)}</span>
          {loading && <span className="em-loading">načítám…</span>}
          {!loading && (
            <span className="em-stats">
              {tasks.length} tasků · skenováno {scannedFiles} souborů
            </span>
          )}
        </div>
      </header>

      {error && (
        <div className="em-error" role="alert">
          Chyba: {error}
        </div>
      )}

      {!todayFileExists && !loading && (
        <div className="em-info">
          Pro dnešek ({today}) zatím neexistuje daily note.
        </div>
      )}

      <Matrix tasks={sortedTasks} today={today} />
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
