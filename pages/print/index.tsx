import { useEffect, useMemo, useRef, useState } from 'react';
import Header from '../../components/Header';
import StudentPicker from '../../components/StudentPicker';
import StickyBar from '../../components/StickyBar';
import BusyOverlay from '../../components/BusyOverlay';
import useAuthGuard from '../../hooks/useAuthGuard';
import type { PronounSet } from '../../lib/tokens';
import {
  CatalogItem,
  TreeFile,
  TreeNode,
  buildCatalogTree,
  getFolderLabel,
  getNode,
  isStandardYearLabel,
  listChildNames,
  sortFilesForDisplay,
} from '../../lib/catalog';

type PrintMeta = {
  student: string;
  tutor?: string;
  campusName?: string;
  campusKey?: string;
  folder?: string;
  year?: string;
  subject?: string;
  topic?: string;
  strand?: string;
  printer?: string;
};

type PrintContext = {
  year: string;
  subject: string;
  topic: string;
  strand: string;
  folder: string;
  path: string[];
};

type PrintFailure = Error & {
  raw?: any;
  printedCount?: number;
  failedItem?: TreeFile;
  results?: Array<{ id: number; ok: boolean; raw?: any }>;
};

function getStoredValue(key: string, fallback = '') {
  try {
    if (typeof window === 'undefined') return fallback;
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function getTutorName() {
  return getStoredValue('st_tutor', '');
}

function getCampusName() {
  return getStoredValue('st_campus', process.env.NEXT_PUBLIC_CAMPUS_NAME || 'Success Tutoring Parramatta');
}

function getCampusKey() {
  return getStoredValue('st_campus_id', 'parramatta');
}

function uniqueNonEmpty(values: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = (value || '').trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function getFileDisplayName(file: TreeFile) {
  return file._nameLabel || file.name || file.item_name || file.fileName.replace(/\.[^/.]+$/, '').trim();
}

function getFileTypeLabel(file: TreeFile) {
  return file._typeLabel || file.type || file.item_type || 'File';
}

function deriveTopicFromPath(pathSegments: string[]) {
  const cleaned = (pathSegments || []).filter(Boolean);
  if (!cleaned.length) return '';

  if (isStandardYearLabel(cleaned[0])) {
    if (cleaned.length >= 4) return (cleaned[3] || '').trim();
    return (cleaned[cleaned.length - 1] || '').trim();
  }

  return (cleaned[cleaned.length - 1] || '').trim();
}

function normalizeCatalogPath(pathSegments: string[]) {
  const cleaned = (pathSegments || []).filter(Boolean);
  if (cleaned[0]?.toLowerCase() === 'content') return cleaned.slice(1);
  return cleaned;
}

function pickFirstNonEmpty(...values: Array<string | undefined>) {
  for (const value of values) {
    const trimmed = (value || '').trim();
    if (trimmed) return trimmed;
  }
  return '';
}

function deriveContextFromPath(pathSegments: string[], item?: CatalogItem): PrintContext {
  const cleaned = normalizeCatalogPath(pathSegments);
  const folder = getFolderLabel(cleaned);
  const year = pickFirstNonEmpty(item?.year, cleaned[0]);
  const subjectFromItem = (item?.subject || '').trim();
  const looksLikeRealSubject = subjectFromItem && subjectFromItem.toLowerCase() !== 'content';
  const subject = looksLikeRealSubject ? subjectFromItem : pickFirstNonEmpty(cleaned[1]);
  const pathTopic = deriveTopicFromPath(cleaned);
  const itemTopic = (item?.topic || '').trim();
  const topic = itemTopic && itemTopic.toLowerCase() !== year.toLowerCase() ? itemTopic : pathTopic;

  return {
    year,
    subject,
    topic,
    strand: (cleaned[2] || '').trim(),
    folder,
    path: cleaned,
  };
}

function pickCommon(values: string[], fallback = '') {
  const unique = uniqueNonEmpty(values);
  return unique.length === 1 ? unique[0] : fallback;
}

function deriveContextFromItems(pathSegments: string[], items: TreeFile[]): PrintContext {
  const base = deriveContextFromPath(pathSegments);
  const normalizedYear = (base.year || '').trim().toLowerCase();
  const topicFromItems = pickCommon(
    items
      .map((item) => (item.topic || '').trim())
      .filter((topic) => topic && topic.toLowerCase() !== normalizedYear),
    base.topic,
  );

  return {
    year: pickCommon(items.map((item) => item.year || ''), base.year),
    subject: pickCommon(
      items
        .map((item) => (item.subject || '').trim())
        .filter((subject) => subject && subject.toLowerCase() !== 'content'),
      base.subject,
    ),
    topic: topicFromItems,
    strand: base.strand,
    folder: base.folder,
    path: base.path,
  };
}

export default function PrintPage() {
  useAuthGuard();

  const [status, setStatus] = useState('Checking…');
  const [printerName, setPrinterName] = useState('');
  const [qty, setQty] = useState(1);
  const [student, setStudent] = useState('');
  const [, setPronouns] = useState<PronounSet>('');
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [msg, setMsg] = useState('');
  const [navPath, setNavPath] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [busyTitle, setBusyTitle] = useState<string>('Working…');
  const [busySubtitle, setBusySubtitle] = useState<string>('');
  const [needStudent, setNeedStudent] = useState(false);

  const topRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef<HTMLDivElement>(null);

  const scrollTop = () => topRef.current?.scrollIntoView({ behavior: 'smooth' });
  const scrollSelection = () => selectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  async function refresh() {
    setMsg('');
    try {
      const healthRes = await fetch('/api/print-proxy?action=health');
      const health = await healthRes.json().catch(() => ({}));
      if (!healthRes.ok || !health?.ok) throw new Error(health?.error || 'Not connected');

      const resolvedPrinter = health?.printer || health?.printerName || '';
      setPrinterName(resolvedPrinter);
      setStatus(`Connected${resolvedPrinter ? ` · ${resolvedPrinter}` : ''}`);

      const catalogRes = await fetch('/api/print-proxy?action=catalog');
      const catalogJson = await catalogRes.json().catch(() => ({}));
      if (!catalogRes.ok) throw new Error(catalogJson?.error || 'Failed to load print catalog');
      setCatalog(catalogJson?.items || []);
    } catch {
      setStatus('Not Connected');
      setPrinterName('');
      setCatalog([]);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const tree: TreeNode = useMemo(() => buildCatalogTree(catalog), [catalog]);
  const node = useMemo(() => getNode(tree, navPath), [tree, navPath]);
  const childNames = useMemo(() => listChildNames(node), [node]);
  const rootLabel = navPath[0] || '';
  const standardOrdering = isStandardYearLabel(rootLabel);
  const files = useMemo(() => sortFilesForDisplay(node.files || [], standardOrdering), [node.files, standardOrdering]);
  const currentContext = useMemo(() => deriveContextFromItems(navPath, files), [navPath, files]);
  const printerReady = status.startsWith('Connected');
  const isLeafFolderSelection = navPath.length > 0 && childNames.length === 0 && files.length > 0;

  const dropdownLevels = useMemo(() => {
    const levels: { label: string; options: string[]; value: string }[] = [];

    const labelForDepth = (depth: number) => {
      if (depth === 0) return 'Year / Program';
      if (depth === 1) return 'Subject / Folder';
      if (depth === 2) return 'Strand / Folder';
      return 'Folder';
    };

    let cursor: TreeNode = tree;
    for (let depth = 0; depth < 12; depth++) {
      const children = Array.from(cursor.children.values());
      const options = children.map((child) => child.name).sort((a, b) => a.localeCompare(b));
      if (!options.length) break;
      const value = navPath[depth] || '';
      levels.push({ label: labelForDepth(depth), options, value });
      if (!value) break;
      const next = children.find((child) => child.name === value);
      if (!next) break;
      cursor = next;
    }

    return levels;
  }, [tree, navPath]);

  const setDropdownAt = (depth: number, value: string) => {
    setMsg('');
    setNavPath((prev) => {
      const next = prev.slice(0, depth);
      if (value) next[depth] = value;
      return next;
    });
  };

  function clearAll() {
    setNavPath([]);
    setQty(1);
    setMsg('');
    setNeedStudent(false);
    setBusySubtitle('');
    scrollTop();
  }

  function goBack() {
    setMsg('');
    setNavPath((prev) => prev.slice(0, Math.max(0, prev.length - 1)));
  }

  async function logPrint(payload: Record<string, any>) {
    try {
      await fetch('/api/log-print', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {
      // Logging should never block printing.
    }
  }

  function buildBaseMeta(context: PrintContext): PrintMeta {
    return {
      student,
      tutor: getTutorName(),
      campusName: getCampusName(),
      campusKey: getCampusKey(),
      folder: context.folder,
      year: context.year,
      subject: context.subject,
      topic: context.topic,
      strand: context.strand,
      printer: printerName,
    };
  }

  async function sendSinglePrintRequest(file: TreeFile, meta: PrintMeta) {
    const normalizedPath = normalizeCatalogPath(file.folderSegments);
    const response = await fetch('/api/print-proxy?action=print', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        material_id: file.id,
        qty,
        meta,
        path: normalizedPath,
        folder: getFolderLabel(normalizedPath),
        year: meta.year,
        subject: meta.subject,
        topic: meta.topic,
        type: getFileDisplayName(file),
        item_name: getFileDisplayName(file),
      }),
    });

    const json = await response.json().catch(() => ({}));
    if (!response.ok || !json?.ok) {
      const error = new Error(json?.error || 'Print failed') as PrintFailure;
      error.raw = json;
      throw error;
    }
    return json;
  }

  async function printSequentially(items: TreeFile[], meta: PrintMeta) {
    const results: Array<{ id: number; ok: boolean; raw?: any }> = [];

    for (let index = 0; index < items.length; index++) {
      const file = items[index];
      setBusySubtitle(`Printing ${index + 1} of ${items.length}: ${getFileDisplayName(file)}`);
      try {
        const raw = await sendSinglePrintRequest(file, meta);
        results.push({ id: file.id, ok: true, raw });
      } catch (error: any) {
        const wrapped = new Error(error?.message || 'Print failed') as PrintFailure;
        wrapped.raw = error?.raw;
        wrapped.printedCount = results.length;
        wrapped.failedItem = file;
        wrapped.results = results;
        throw wrapped;
      }
    }

    return { ok: true, mode: 'sequential-fallback', printedCount: results.length, results };
  }

  function buildSingleLogPayload(file: TreeFile, context: PrintContext, ok: boolean, extra?: Record<string, any>) {
    const itemName = getFileDisplayName(file);
    return {
      when: new Date().toISOString(),
      kind: 'print',
      student,
      tutor: getTutorName(),
      campusName: getCampusName(),
      campusKey: getCampusKey(),
      year: context.year,
      subject: context.subject,
      topic: context.topic,
      strand: context.strand,
      folder: context.folder,
      path: context.path,
      type: itemName,
      types: itemName,
      type_label: getFileTypeLabel(file),
      type_labels: [getFileTypeLabel(file)],
      item_name: itemName,
      item_names: [itemName],
      material_id: file.id,
      material_ids: [file.id],
      qty,
      printer: printerName,
      ok,
      ...extra,
    };
  }

  function buildTopicLogPayload(items: TreeFile[], context: PrintContext, ok: boolean, extra?: Record<string, any>) {
    const names = items.map((file) => getFileDisplayName(file));
    return {
      when: new Date().toISOString(),
      kind: 'print-topic',
      student,
      tutor: getTutorName(),
      campusName: getCampusName(),
      campusKey: getCampusKey(),
      year: context.year,
      subject: context.subject,
      topic: context.topic,
      strand: context.strand,
      folder: context.folder,
      path: context.path,
      type: names.length === 1 ? names[0] : '',
      types: names,
      type_labels: items.map((file) => getFileTypeLabel(file)),
      item_names: names,
      material_ids: items.map((file) => file.id),
      qty,
      printer: printerName,
      ok,
      total_count: items.length,
      ...extra,
    };
  }

  async function printOne(file: TreeFile) {
    if (!student) {
      setNeedStudent(true);
      return;
    }
    if (!isLeafFolderSelection) {
      setMsg('Open a final content folder before printing.');
      return;
    }

    const context = deriveContextFromPath(file.folderSegments, file);
    const meta = buildBaseMeta(context);

    setBusy(true);
    setBusyTitle('Sending to printer');
    setBusySubtitle(getFileDisplayName(file));
    setMsg('');

    try {
      await sendSinglePrintRequest(file, meta);
      await logPrint(buildSingleLogPayload(file, context, true, { backend_mode: 'single' }));
      setMsg('Sent to printer.');
    } catch (error: any) {
      await logPrint(buildSingleLogPayload(file, context, false, { backend_mode: 'single', error: error?.message || 'Print failed', raw: error?.raw || null }));
      setMsg(error?.message || 'Print failed');
    } finally {
      setBusy(false);
      setBusySubtitle('');
    }
  }

  async function printFolderAll() {
    if (!student) {
      setNeedStudent(true);
      return;
    }
    if (!isLeafFolderSelection) {
      setMsg('Open a final content folder before printing.');
      return;
    }
    if (!files.length) return;

    const context = deriveContextFromItems(navPath, files);
    const meta = buildBaseMeta(context);

    setBusy(true);
    setBusyTitle('Sending folder to printer');
    setBusySubtitle('Preparing files…');
    setMsg('');

    try {
      setBusySubtitle('Printing files one by one…');
      const raw = await printSequentially(files, meta);

      await logPrint(
        buildTopicLogPayload(files, context, true, {
          backend_mode: raw?.mode || 'sequential-fallback',
          printed_count: files.length,
        }),
      );
      setMsg(`Folder sent to printer (${files.length} file${files.length === 1 ? '' : 's'}).`);
    } catch (error: any) {
      const printedCount = Number(error?.printedCount || 0) || 0;
      await logPrint(
        buildTopicLogPayload(files, context, false, {
          backend_mode: 'sequential-fallback',
          printed_count: printedCount,
          error: error?.message || 'Print failed',
          failed_material_id: error?.failedItem?.id || null,
          failed_item_name: error?.failedItem ? getFileDisplayName(error.failedItem) : '',
          raw: error?.raw || null,
        }),
      );
      setMsg(
        printedCount > 0
          ? `Printing stopped after ${printedCount} of ${files.length} files.`
          : error?.message || 'Print failed',
      );
    } finally {
      setBusy(false);
      setBusySubtitle('');
    }
  }

  const heading = (() => {
    const depth = navPath.length;
    if (depth === 0) return 'Select a Year';
    if (isStandardYearLabel(rootLabel)) {
      if (depth === 1) return 'Select a Subject';
      if (depth === 2) return 'Select a Strand';
      if (depth === 3) return 'Select Content';
    }
    return 'Select a Folder';
  })();

  return (
    <div className="print-page">
      <div ref={topRef} />
      <Header />

      <BusyOverlay open={busy} title={busyTitle} subtitle={busySubtitle} />

      {needStudent && (
        <div className="modal-overlay" onClick={() => setNeedStudent(false)}>
          <div className="card modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="section-title" style={{ marginBottom: 8 }}>Enter student name</div>
            <div className="text-muted" style={{ marginBottom: 16 }}>
              Please choose or type a student before printing. Nothing will be sent to the printer until a student is selected.
            </div>
            <div className="flex gap-2" style={{ justifyContent: 'flex-end' }}>
              <button
                className="btn-primary"
                onClick={() => {
                  setNeedStudent(false);
                  scrollTop();
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="container">
        <div className="card">
          <div className="flex items-center justify-between" style={{ gap: 12, flexWrap: 'wrap' }}>
            <div className="badge-success">{status}</div>
            {msg && <div className="text-sm text-muted">{msg}</div>}
          </div>

          <div className="grid grid-col mt-4">
            <div>
              <div className="label">Quantity</div>
              <input
                className="input w-28"
                type="number"
                min={1}
                max={50}
                value={qty}
                onChange={(e) => {
                  const next = parseInt(e.target.value || '1', 10);
                  setQty(Number.isFinite(next) ? Math.max(1, next) : 1);
                }}
              />
            </div>
            <div>
              <div className="label">Student (required)</div>
              <StudentPicker
                value={student}
                onChange={setStudent}
                onPronouns={setPronouns}
                allowCustom
                customLabel="Use new student"
                onCustomPick={(name) => {
                  setMsg(`Using new student: ${name}`);
                }}
                required
              />
              <div className="text-sm text-muted mt-2">New student? Type their name and choose “Use new student”.</div>
            </div>
          </div>

          {dropdownLevels.length > 0 && (
            <div className="mt-4 desktop-only">
              <div className="grid grid-col" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                {dropdownLevels.map((level, idx) => (
                  <div key={idx}>
                    <div className="label">{level.label}</div>
                    <select className="input" value={level.value} onChange={(e) => setDropdownAt(idx, e.target.value)}>
                      <option value="">Select…</option>
                      {level.options.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
                <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                  <button className="btn w-full" onClick={scrollSelection}>Go to selection</button>
                </div>
              </div>
              <div className="text-sm text-muted mt-2">Desktop quick navigation: jump through folders without the page auto-scrolling.</div>
            </div>
          )}

          <div className="mt-4" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn" onClick={refresh}>Refresh</button>
            <button className="btn" onClick={clearAll}>Clear</button>
            <button className="btn" onClick={scrollTop}>Return to top</button>
            {navPath.length > 0 && (
              <div className="text-sm text-muted" style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {navPath.map((segment, idx) => (
                  <button
                    key={`${segment}-${idx}`}
                    className="btn"
                    style={{ padding: '.35rem .65rem', borderRadius: 999, opacity: idx === navPath.length - 1 ? 1 : 0.85 }}
                    onClick={() => setNavPath(navPath.slice(0, idx + 1))}
                  >
                    {segment}
                  </button>
                ))}
                <button className="btn" style={{ padding: '.35rem .65rem', borderRadius: 999 }} onClick={goBack}>
                  Back
                </button>
              </div>
            )}
          </div>
        </div>

        <div ref={selectionRef} />

        {navPath.length > 0 && !isLeafFolderSelection && childNames.length > 0 && (
          <section className="card mt-6">
            <div className="section-title" style={{ marginBottom: '.35rem' }}>{navPath.join(' • ')}</div>
            <div className="text-sm text-muted">
              Keep going until you reach the final content folder. Bulk printing only appears at the last folder level.
            </div>
          </section>
        )}

        {isLeafFolderSelection && (
          <section className="card mt-6">
            <div className="flex items-center justify-between" style={{ gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div className="section-title" style={{ marginBottom: '.35rem' }}>{navPath.join(' • ')}</div>
                <div className="text-sm text-muted">
                  Final folder ready to print · {files.length} file{files.length === 1 ? '' : 's'}
                  {currentContext.topic ? ` · Topic: ${currentContext.topic}` : ''}
                </div>
              </div>
              <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
                <button className="btn-primary" disabled={busy || !printerReady || !files.length} onClick={printFolderAll}>
                  Print Folder
                </button>
              </div>
            </div>
          </section>
        )}

        {childNames.length > 0 && (
          <section className="card mt-6">
            <h2 className="section-title">{heading}</h2>
            <div className={`grid ${navPath.length === 0 ? 'grid-2' : 'grid-3'} grid-col`}>
              {childNames.map((name) => (
                <button
                  key={name}
                  className="tile p-6"
                  onClick={() => {
                    setMsg('');
                    setNavPath([...navPath, name]);
                  }}
                >
                  <div className="text-xl" style={{ fontWeight: 700 }}>{name}</div>
                </button>
              ))}
            </div>
          </section>
        )}

        {isLeafFolderSelection && files.length > 0 && (
          <section className="card mt-6">
            <div className="head mt-2">
              <div>Type</div>
              <div>Name</div>
              <div style={{ textAlign: 'right' }}>Action</div>
            </div>

            {files.map((file) => (
              <div key={file.id} className="row">
                <div>{getFileTypeLabel(file)}</div>
                <div>{getFileDisplayName(file)}</div>
                <div style={{ textAlign: 'right' }}>
                  <button className="btn-primary" disabled={busy || !printerReady} onClick={() => printOne(file)}>
                    Print
                  </button>
                </div>
              </div>
            ))}
          </section>
        )}

        <footer className="container footer mt-8" style={{ textAlign: 'center' }}>
          © Success Tutoring Parramatta · Theme: dark/orange
        </footer>
      </main>

      <StickyBar>
        <button onClick={refresh} className="btn flex-1">Refresh</button>
        <button onClick={clearAll} className="btn flex-1">Clear</button>
        <button onClick={scrollTop} className="btn flex-1">Return to top</button>
      </StickyBar>
    </div>
  );
}
