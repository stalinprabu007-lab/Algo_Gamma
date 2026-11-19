import React, { useEffect, useState } from 'react';
import { Pause, Play, Download, Search } from 'lucide-react';
import { apiRequest } from '../api/client';
import { LogEntry } from '../types/trading';

export const LogsPage: React.FC = () => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [sources, setSources] = useState<string[]>([]);
  const [levelFilter, setLevelFilter] = useState<string>('ALL');
  const [sourceFilter, setSourceFilter] = useState<string>('ALL');
  const [search, setSearch] = useState<string>('');
  const [paused, setPaused] = useState<boolean>(false);

  const fetchLogs = async () => {
    const params = new URLSearchParams({
      level: levelFilter,
      source: sourceFilter,
      q: search,
    });
    const res = await apiRequest<{ logs: LogEntry[]; counts: Record<string, number>; sources: string[] }>(
      `/api/logs?${params.toString()}`
    );
    setLogs(res.logs);
    setCounts(res.counts);
    setSources(res.sources);
  };

  useEffect(() => {
    fetchLogs();
  }, [levelFilter, sourceFilter, search]);

  useEffect(() => {
    if (paused) return;
    const timer = setInterval(fetchLogs, 6000);
    return () => clearInterval(timer);
  }, [paused, levelFilter, sourceFilter, search]);

  const handleExport = () => {
    const text = logs
      .map((l) => `${l.timestamp_ist} [${l.level}] [${l.source}] ${l.message}`)
      .join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gammadesk_logs_${new Date().toISOString().slice(0, 10)}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const levels = ['ALL', 'INFO', 'SIGNAL', 'ORDER', 'EXIT', 'WARN', 'ERROR'] as const;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Logs</h1>
          <p className="mt-1 text-xs text-slate-400">
            Every broker handshake, signal, order, exit, and risk warning — newest first.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            className="flex items-center gap-1.5 rounded-lg border border-[#242A34] bg-[#111419] px-3 py-2 text-xs font-medium text-slate-200 hover:border-[#343C4A]"
          >
            {paused ? <Play className="h-3.5 w-3.5 text-emerald-400" /> : <Pause className="h-3.5 w-3.5 text-amber-400" />}
            <span>{paused ? 'Resume stream' : 'Pause stream'}</span>
          </button>
          <button
            type="button"
            onClick={handleExport}
            className="flex items-center gap-1.5 rounded-lg border border-[#242A34] bg-[#111419] px-3 py-2 text-xs font-medium text-slate-200 hover:border-[#343C4A]"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export</span>
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#1E232B] bg-[#111418] p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {levels.map((lvl) => (
            <button
              key={lvl}
              type="button"
              onClick={() => setLevelFilter(lvl)}
              className={`rounded-md px-2.5 py-1.5 font-mono text-xs font-medium transition-colors ${
                levelFilter === lvl
                  ? 'bg-[#1D232D] text-white border border-[#2F3746]'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {lvl}{' '}
              {lvl !== 'ALL' && (
                <span className="ml-1 text-slate-500">{counts[lvl] ?? 0}</span>
              )}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Filter logs by source"
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="rounded-lg border border-[#242A34] bg-[#0B0D11] px-3 py-1.5 text-xs text-slate-200 focus:border-amber-400 focus:outline-none"
          >
            <option value="ALL">All sources</option>
            {sources.map((src) => (
              <option key={src} value={src}>
                {src}
              </option>
            ))}
          </select>

          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search logs…"
              className="w-52 rounded-lg border border-[#242A34] bg-[#0B0D11] py-1.5 pl-8 pr-3 text-xs text-white placeholder:text-slate-600 focus:border-amber-400 focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Console Log Stream */}
      <div className="rounded-xl border border-[#1E232B] bg-[#0B0D11]">
        <div className="flex items-center justify-between border-b border-[#1A1F27] px-4 py-2.5 font-mono text-[11px] text-slate-400">
          <span>{paused ? 'paused' : 'streaming'} · {logs.length} lines</span>
          <span>IST</span>
        </div>
        <div className="max-h-[580px] divide-y divide-[#13171E] overflow-y-auto px-4 py-2 font-mono text-xs">
          {logs.length === 0 ? (
            <div className="py-10 text-center text-slate-500">No log entries match your current filter.</div>
          ) : (
            logs.map((log) => (
              <div key={log.id} className="flex flex-col gap-1 py-2.5 leading-relaxed sm:flex-row sm:items-start sm:gap-3 sm:py-2">
                <div className="flex items-center gap-2.5 shrink-0">
                  <span className="text-slate-500 tabular-nums">{log.timestamp_ist}</span>
                  <span
                    className={`w-13 font-semibold ${
                      log.level === 'EXIT'
                        ? 'text-emerald-400'
                        : log.level === 'ORDER'
                        ? 'text-amber-400'
                        : log.level === 'SIGNAL'
                        ? 'text-sky-400'
                        : log.level === 'ERROR'
                        ? 'text-rose-400'
                        : log.level === 'WARN'
                        ? 'text-orange-400'
                        : 'text-slate-400'
                    }`}
                  >
                    {log.level}
                  </span>
                  <span className="text-slate-500">[{log.source}]</span>
                </div>
                <span className="text-slate-200 break-words">{log.message}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
