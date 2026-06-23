// ─────────────────────────────────────────────────────────────────────────────
// SCORM player. Installs the SCORM runtime API on `window` (so the content,
// loaded in an iframe from OUR origin, can discover it via window.parent), backs
// the CMI data model with our REST API (PostgreSQL), and reports completion +
// score up to the course progress system.
//
// Supports SCORM 1.2 (window.API / LMS* methods) and SCORM 2004
// (window.API_1484_11 / Initialize, GetValue, …).
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { contentService } from '../services/contentService';
import { UserProfile, ScormPackageInfo } from '../types';

interface ScormPlayerProps {
  packageId: string;
  user: UserProfile;
  // Called whenever the package reports completion/pass, with a 0–100 score.
  onComplete?: (score: number | null, passed: boolean) => void;
}

declare global {
  interface Window { API?: any; API_1484_11?: any; }
}

export default function ScormPlayer({ packageId, user, onComplete }: ScormPlayerProps) {
  const [info, setInfo] = useState<ScormPackageInfo | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [fs, setFs] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const dataRef = useRef<Record<string, string>>({});
  const dirtyRef = useRef(false);
  const completedFiredRef = useRef(false);

  // Persist CMI to the backend (debounced for frequent SetValue calls).
  const saveTimer = useRef<number | null>(null);
  const flush = async () => {
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    try { await contentService.saveScormCmi(packageId, dataRef.current); } catch {}
  };
  const scheduleSave = () => {
    dirtyRef.current = true;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(flush, 1500);
  };

  // Inspect the model and fire onComplete once status reaches completed/passed.
  const checkCompletion = (version: '1.2' | '2004') => {
    const d = dataRef.current;
    let passed = false;
    let score: number | null = null;
    if (version === '1.2') {
      const status = d['cmi.core.lesson_status'] || '';
      passed = status === 'passed' || status === 'completed';
      const raw = d['cmi.core.score.raw'];
      if (raw !== undefined && raw !== '') score = Number(raw);
    } else {
      const completion = d['cmi.completion_status'] || '';
      const success = d['cmi.success_status'] || '';
      passed = success === 'passed' || completion === 'completed';
      if (d['cmi.score.raw']) score = Number(d['cmi.score.raw']);
      else if (d['cmi.score.scaled']) score = Math.round(Number(d['cmi.score.scaled']) * 100);
    }
    if (passed && !completedFiredRef.current) {
      completedFiredRef.current = true;
      onComplete?.(Number.isFinite(score as number) ? score : null, true);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pkg = await contentService.getScormPackage(packageId);
      if (!pkg) { setError('SCORM-пакет не найден'); return; }
      const stored = await contentService.getScormCmi(packageId);
      if (cancelled) return;

      const version = pkg.version;
      const d: Record<string, string> = { ...stored };

      // Seed required read-only / default fields the content expects.
      const studentName = user.name || 'Учащийся';
      if (version === '1.2') {
        const resume = Object.keys(stored).length > 0;
        d['cmi.core.student_id'] ??= user.id;
        d['cmi.core.student_name'] ??= studentName;
        d['cmi.core.lesson_status'] ??= 'not attempted';
        d['cmi.core.entry'] = resume ? 'resume' : 'ab-initio';
        d['cmi.core.credit'] ??= 'credit';
        d['cmi.core.lesson_mode'] ??= 'normal';
        d['cmi.core.total_time'] ??= '0000:00:00';
        d['cmi.core.lesson_location'] ??= '';
        d['cmi.suspend_data'] ??= '';
        d['cmi.launch_data'] ??= '';
        d['cmi.core._children'] ??= 'student_id,student_name,lesson_location,credit,lesson_status,entry,score,total_time,lesson_mode,exit,session_time';
        d['cmi.core.score._children'] ??= 'raw,min,max';
      } else {
        const resume = Object.keys(stored).length > 0;
        d['cmi.learner_id'] ??= user.id;
        d['cmi.learner_name'] ??= studentName;
        d['cmi.completion_status'] ??= 'unknown';
        d['cmi.success_status'] ??= 'unknown';
        d['cmi.entry'] = resume ? 'resume' : 'ab-initio';
        d['cmi.credit'] ??= 'credit';
        d['cmi.mode'] ??= 'normal';
        d['cmi.location'] ??= '';
        d['cmi.suspend_data'] ??= '';
        d['cmi.total_time'] ??= 'PT0H0M0S';
        d['cmi.launch_data'] ??= '';
      }
      dataRef.current = d;

      let lastError = '0';
      const get = (key: string) => {
        lastError = '0';
        const v = dataRef.current[key];
        return v === undefined ? '' : String(v);
      };
      const set = (key: string, value: string) => {
        lastError = '0';
        dataRef.current[key] = String(value);
        scheduleSave();
        checkCompletion(version);
        return 'true';
      };
      const commit = () => { flush(); return 'true'; };

      if (version === '1.2') {
        window.API = {
          LMSInitialize: () => 'true',
          LMSFinish: () => { flush(); checkCompletion('1.2'); return 'true'; },
          LMSGetValue: get,
          LMSSetValue: set,
          LMSCommit: commit,
          LMSGetLastError: () => lastError,
          LMSGetErrorString: () => '',
          LMSGetDiagnostic: () => '',
        };
      } else {
        window.API_1484_11 = {
          Initialize: () => 'true',
          Terminate: () => { flush(); checkCompletion('2004'); return 'true'; },
          GetValue: get,
          SetValue: set,
          Commit: commit,
          GetLastError: () => lastError,
          GetErrorString: () => '',
          GetDiagnostic: () => '',
        };
      }

      setInfo(pkg);
      setReady(true);
    })().catch((e) => !cancelled && setError(e?.message || 'Ошибка загрузки SCORM'));

    return () => {
      cancelled = true;
      flush();
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      // Remove the API so it can't leak to the next lesson/package.
      try { delete window.API; delete window.API_1484_11; } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packageId]);

  // Keep the React `fs` flag in sync with native fullscreen + allow Esc to exit.
  useEffect(() => {
    const onFsChange = () => { if (!document.fullscreenElement) setFs(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFs(false); };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  // Toggle fullscreen WITHOUT remounting the iframe (would reset the SCORM session):
  // we only restyle the same wrapper. Also try the native Fullscreen API on top.
  const toggleFs = () => {
    const el = containerRef.current;
    if (!fs) {
      setFs(true);
      el?.requestFullscreen?.().catch(() => {}); // best-effort true fullscreen
    } else {
      setFs(false);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    }
  };

  if (error) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[#F5F7FA] p-6 text-center">
        <p className="text-sm font-bold text-red-600">{error}</p>
      </div>
    );
  }

  if (!ready || !info) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[#F5F7FA]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-4 border-[#002D57]/20 border-t-[#002D57] rounded-full animate-spin" />
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Загрузка SCORM…</p>
        </div>
      </div>
    );
  }

  // encodeURI keeps slashes/query but escapes spaces & non-ASCII in the path.
  const src = `/api/scorm/${encodeURIComponent(packageId)}/content/${encodeURI(info.launchHref)}`;
  return (
    <div ref={containerRef} className={fs ? 'fixed inset-0 z-[9999] bg-white' : 'absolute inset-0'}>
      <iframe
        src={src}
        className="w-full h-full border-none bg-white"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
        allowFullScreen
        title={info.title || 'SCORM'}
      />
      <button
        onClick={toggleFs}
        title={fs ? 'Свернуть' : 'На весь экран'}
        className="absolute bottom-3 right-3 z-20 flex items-center gap-1.5 pl-2.5 pr-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wide shadow-lg transition-all active:scale-95 bg-[#002D57]/90 hover:bg-[#002D57] text-white border border-white/10"
      >
        {fs ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        <span>{fs ? 'Свернуть' : 'Полный экран'}</span>
      </button>
    </div>
  );
}
