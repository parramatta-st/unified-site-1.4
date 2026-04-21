import Papa from 'papaparse';

export type ProgressCsvRow = Record<string, string>;

export type StudentLookup = {
  studentId?: string;
  studentName?: string;
  parentEmail?: string;
};

export type ProgressEvent = {
  messageId: string;
  timestampLabel: string;
  timestampIso: string;
  timestampMs: number;
  campusKey: string;
  campusName: string;
  tutorName: string;
  studentId: string;
  studentName: string;
  studentFirstName: string;
  studentLastName: string;
  studentYear: string;
  parentName: string;
  parentEmail: string;
  mode: string;
  feedbackType: string;
  programKey: string;
  programLabel: string;
  programFamilyKey: string;
  templateIndex: string;
  lessonNumber: string;
  lessonOrder: number | null;
  assessmentName: string;
  completionStatus: string;
  sourceForm: string;
  year: string;
  subject: string;
  strand: string;
  lesson: string;
  topic: string;
  subjectLine: string;
};

export type ProgressProgramStatus = 'in_progress' | 'completed' | 'moved_on_without_assessment';

export type ProgressProgramEvent = {
  id: string;
  kind: 'lesson' | 'assessment';
  label: string;
  topic: string;
  tutorName: string;
  timestampIso: string;
  timestampLabel: string;
};

export type ProgressProgram = {
  id: string;
  title: string;
  year: string;
  subject: string;
  status: ProgressProgramStatus;
  startedAt: string;
  lastActivityAt: string;
  eventCount: number;
  events: ProgressProgramEvent[];
};

export type ProgressSubjectSection = {
  key: string;
  label: string;
  programs: ProgressProgram[];
};

export type StudentProgressResult = {
  student: {
    studentId: string;
    studentName: string;
    parentEmail: string;
  };
  subjects: ProgressSubjectSection[];
  totalPrograms: number;
  totalEvents: number;
};

function normalizeSpace(value: string) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\u2060]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLower(value: string) {
  return normalizeSpace(value).toLowerCase();
}

function slugify(value: string) {
  return normalizeLower(value)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function pick(row: ProgressCsvRow, keys: string[]) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') {
      return String(row[key]);
    }
  }
  return '';
}

function normalizeObjectKeys(input: any): ProgressCsvRow {
  const out: ProgressCsvRow = {};
  for (const [rawKey, rawValue] of Object.entries(input || {})) {
    out[normalizeSpace(String(rawKey))] = String(rawValue ?? '');
  }
  return out;
}

function parseTimestamp(value: string) {
  const trimmed = normalizeSpace(value);
  if (!trimmed) return { iso: '', ms: 0 };

  const parsed = Date.parse(trimmed);
  if (!Number.isNaN(parsed)) {
    return { iso: new Date(parsed).toISOString(), ms: parsed };
  }

  return { iso: '', ms: 0 };
}

function parseYearRank(value: string): number | null {
  const trimmed = normalizeLower(value);
  if (!trimmed) return null;
  if (trimmed === 'kindy' || trimmed === 'kindergarten' || trimmed === 'k') return 0;

  const yearMatch = trimmed.match(/year\s*(\d{1,2})/);
  if (yearMatch) return Number(yearMatch[1]);

  const numberMatch = trimmed.match(/^(\d{1,2})$/);
  if (numberMatch) return Number(numberMatch[1]);

  return null;
}

function parseLessonOrder(value: string): number | null {
  const trimmed = normalizeLower(value);
  if (!trimmed) return null;
  const match = trimmed.match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

function isAssessmentValue(value: string) {
  return normalizeLower(value) === 'assessment';
}

function isLikelyPrintLog(fields: string[]) {
  const normalized = fields.map((field) => normalizeLower(field));
  const hasRaw = normalized.includes('raw');
  const hasKind = normalized.includes('kind');
  const hasFeedbackType = normalized.includes('feedbacktype');
  const hasProgramKey = normalized.includes('programkey');
  return hasRaw && hasKind && !hasFeedbackType && !hasProgramKey;
}

function appendCacheBust(url: string) {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}_cb=${Date.now()}`;
}

export function resolveGoogleSheetsCsvUrl(rawUrl: string, preferredSheetName?: string) {
  const trimmed = normalizeSpace(rawUrl);
  if (!trimmed) return '';

  if (/tqx=out:csv/i.test(trimmed) || /format=csv/i.test(trimmed) || /output=csv/i.test(trimmed)) {
    return appendCacheBust(trimmed);
  }

  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) return appendCacheBust(trimmed);

  const spreadsheetId = match[1];
  const sheetName = normalizeSpace(preferredSheetName || '');

  // When we know the target sheet tab, prefer it over any gid from a copied browser URL.
  if (sheetName) {
    return appendCacheBust(
      `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`
    );
  }

  const gidMatch = trimmed.match(/[?&#]gid=([0-9]+)/i);
  const gid = gidMatch ? gidMatch[1] : '';
  if (gid) {
    return appendCacheBust(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`);
  }

  return appendCacheBust(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv`);
}

export function parseProgressCsv(text: string) {
  const parsed = Papa.parse<ProgressCsvRow>(text || '', {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => normalizeSpace(header),
  });

  const fields = (parsed.meta.fields || []).map((field) => normalizeSpace(field));

  return {
    fields,
    rows: (parsed.data || []).map((row) => normalizeObjectKeys(row)) as ProgressCsvRow[],
    looksLikePrintLog: isLikelyPrintLog(fields),
  };
}

function deriveStructuredRow(row: ProgressCsvRow): ProgressCsvRow {
  const rawCell = pick(row, ['Raw', 'raw']);
  if (!rawCell) return row;

  const alreadyStructured =
    normalizeSpace(pick(row, ['subject'])) &&
    (normalizeSpace(pick(row, ['feedbackType'])) || normalizeSpace(pick(row, ['programKey'])));
  if (alreadyStructured) return row;

  try {
    const parsedRaw = JSON.parse(rawCell);
    return normalizeObjectKeys({
      ...parsedRaw,
      timestamp: parsedRaw.timestamp || pick(row, ['Timestamp', 'timestamp', 'when']),
    });
  } catch {
    return row;
  }
}

export function normalizeProgressRows(rows: ProgressCsvRow[]) {
  const seenMessageIds = new Set<string>();
  const events: ProgressEvent[] = [];

  for (const originalRow of rows || []) {
    const row = deriveStructuredRow(originalRow);
    const timestamp = parseTimestamp(pick(row, ['timestamp', 'Timestamp', 'when']));
    if (!timestamp.ms) continue;

    const mode = normalizeLower(pick(row, ['mode']));
    const rawFeedbackType = normalizeLower(pick(row, ['feedbackType', 'kind']));
    if (mode === 'custom' || rawFeedbackType === 'custom') continue;

    const subject = normalizeSpace(pick(row, ['subject', 'Subject']));
    const programLabel = normalizeSpace(pick(row, ['programLabel', 'strand', 'Strand']));
    const year = normalizeSpace(pick(row, ['year', 'Year']));
    const studentName = normalizeSpace(pick(row, ['studentName', 'student', 'Student']));
    const messageId = normalizeSpace(pick(row, ['messageId']));

    if (!subject || !programLabel || !year || !studentName) continue;

    if (messageId) {
      if (seenMessageIds.has(messageId)) continue;
      seenMessageIds.add(messageId);
    }

    const lessonRaw = normalizeSpace(pick(row, ['lesson']));
    const lessonNumber = normalizeSpace(pick(row, ['lessonNumber'])) || lessonRaw;
    const topicRaw = normalizeSpace(pick(row, ['topic', 'Topic']));

    const feedbackType = rawFeedbackType === 'feedback'
      ? (isAssessmentValue(lessonRaw) || isAssessmentValue(topicRaw) ? 'assessment' : 'curriculum_lesson')
      : (rawFeedbackType || (isAssessmentValue(lessonRaw) || isAssessmentValue(topicRaw) ? 'assessment' : 'curriculum_lesson'));

    const programKey = normalizeSpace(pick(row, ['programKey'])) || slugify(`${subject} ${programLabel} ${year}`);
    const programFamilyKey = slugify(`${subject} ${programLabel}`);
    const assessmentName = normalizeSpace(pick(row, ['assessmentName'])) || (feedbackType === 'assessment' ? (topicRaw || lessonRaw || 'Assessment') : '');

    events.push({
      messageId,
      timestampLabel: normalizeSpace(pick(row, ['timestamp', 'Timestamp', 'when'])),
      timestampIso: timestamp.iso,
      timestampMs: timestamp.ms,
      campusKey: normalizeSpace(pick(row, ['campusKey'])),
      campusName: normalizeSpace(pick(row, ['campusName'])),
      tutorName: normalizeSpace(pick(row, ['tutorName', 'tutor', 'Tutor'])),
      studentId: normalizeSpace(pick(row, ['studentId'])),
      studentName,
      studentFirstName: normalizeSpace(pick(row, ['studentFirstName'])),
      studentLastName: normalizeSpace(pick(row, ['studentLastName'])),
      studentYear: normalizeSpace(pick(row, ['studentYear'])),
      parentName: normalizeSpace(pick(row, ['parentName'])),
      parentEmail: normalizeSpace(pick(row, ['parentEmail'])),
      mode,
      feedbackType,
      programKey,
      programLabel,
      programFamilyKey,
      templateIndex: normalizeSpace(String(pick(row, ['templateIndex']))),
      lessonNumber,
      lessonOrder: parseLessonOrder(lessonNumber),
      assessmentName,
      completionStatus: normalizeLower(pick(row, ['completionStatus'])),
      sourceForm: normalizeLower(pick(row, ['sourceForm'])),
      year,
      subject,
      strand: normalizeSpace(pick(row, ['strand', 'Strand'])),
      lesson: lessonRaw,
      topic: topicRaw,
      subjectLine: normalizeSpace(pick(row, ['subjectLine'])),
    });
  }

  return events;
}

function namesLooselyMatch(targetName: string, eventName: string, targetFirstName: string, eventFirstName: string) {
  if (targetName && eventName && targetName === eventName) return true;
  if (targetFirstName && eventFirstName && targetFirstName === eventFirstName) return true;
  if (targetName && eventFirstName && targetName === eventFirstName) return true;
  if (targetFirstName && eventName && eventName.startsWith(targetFirstName + ' ')) return true;
  return false;
}

function matchesStudent(event: ProgressEvent, target: StudentLookup) {
  const targetId = normalizeSpace(target.studentId || '');
  const targetName = normalizeLower(target.studentName || '');
  const targetEmail = normalizeLower(target.parentEmail || '');
  const targetFirstName = normalizeLower((target.studentName || '').split(/\s+/)[0] || '');

  if (targetId && event.studentId && event.studentId === targetId) return true;

  const eventName = normalizeLower(event.studentName || '');
  const eventFirstName = normalizeLower(event.studentFirstName || event.studentName.split(/\s+/)[0] || '');
  const emailMatches = !!targetEmail && normalizeLower(event.parentEmail || '') === targetEmail;

  if (targetName && namesLooselyMatch(targetName, eventName, targetFirstName, eventFirstName)) {
    if (!targetEmail) return true;
    return emailMatches;
  }

  if (emailMatches) {
    if (!targetName) return true;
    return namesLooselyMatch(targetName, eventName, targetFirstName, eventFirstName);
  }

  return false;
}

function buildProgramEvent(event: ProgressEvent): ProgressProgramEvent {
  const kind = event.feedbackType === 'assessment' ? 'assessment' : 'lesson';
  return {
    id: event.messageId || `${event.programKey}-${event.timestampMs}-${event.lessonNumber || event.assessmentName}`,
    kind,
    label: kind === 'assessment' ? 'Assessment' : event.lessonNumber ? `Lesson ${event.lessonNumber}` : 'Lesson',
    topic: kind === 'assessment'
      ? (event.assessmentName || event.topic || 'Assessment')
      : (event.topic || event.lesson || 'Lesson'),
    tutorName: event.tutorName,
    timestampIso: event.timestampIso,
    timestampLabel: event.timestampLabel || event.timestampIso,
  };
}

function compareProgramEvents(a: ProgressEvent, b: ProgressEvent) {
  const aAssessment = a.feedbackType === 'assessment';
  const bAssessment = b.feedbackType === 'assessment';
  if (aAssessment !== bAssessment) return aAssessment ? 1 : -1;

  if (!aAssessment && !bAssessment) {
    const aLesson = a.lessonOrder ?? Number.MAX_SAFE_INTEGER;
    const bLesson = b.lessonOrder ?? Number.MAX_SAFE_INTEGER;
    if (aLesson !== bLesson) return aLesson - bLesson;
  }

  return a.timestampMs - b.timestampMs;
}

export function buildStudentProgress(events: ProgressEvent[], target: StudentLookup): StudentProgressResult {
  const filtered = events.filter((event) => matchesStudent(event, target));

  const groups = new Map<string, {
    subject: string;
    programKey: string;
    programLabel: string;
    programFamilyKey: string;
    year: string;
    startMs: number;
    lastMs: number;
    completed: boolean;
    events: ProgressEvent[];
  }>();

  for (const event of filtered) {
    const key = event.programKey || slugify(`${event.subject} ${event.programLabel} ${event.year}`);
    const existing = groups.get(key);

    if (!existing) {
      groups.set(key, {
        subject: event.subject,
        programKey: key,
        programLabel: event.programLabel,
        programFamilyKey: event.programFamilyKey,
        year: event.year,
        startMs: event.timestampMs,
        lastMs: event.timestampMs,
        completed: event.feedbackType === 'assessment' || event.completionStatus === 'completed',
        events: [event],
      });
      continue;
    }

    existing.startMs = Math.min(existing.startMs, event.timestampMs);
    existing.lastMs = Math.max(existing.lastMs, event.timestampMs);
    existing.completed = existing.completed || event.feedbackType === 'assessment' || event.completionStatus === 'completed';
    existing.events.push(event);
  }

  const groupList = [...groups.values()];

  const programs: ProgressProgram[] = groupList.map((group) => {
    const yearRank = parseYearRank(group.year);
    const movedOn = !group.completed && groupList.some((candidate) => {
      if (candidate.subject !== group.subject) return false;
      if (candidate.programFamilyKey !== group.programFamilyKey) return false;
      if (candidate.programKey === group.programKey) return false;
      const candidateRank = parseYearRank(candidate.year);
      if (yearRank === null || candidateRank === null) return false;
      return candidateRank > yearRank && candidate.startMs > group.startMs;
    });

    const status: ProgressProgramStatus = group.completed
      ? 'completed'
      : movedOn
        ? 'moved_on_without_assessment'
        : 'in_progress';

    return {
      id: group.programKey,
      title: group.programLabel,
      year: group.year,
      subject: group.subject,
      status,
      startedAt: new Date(group.startMs).toISOString(),
      lastActivityAt: new Date(group.lastMs).toISOString(),
      eventCount: group.events.length,
      events: group.events.slice().sort(compareProgramEvents).map(buildProgramEvent),
    };
  });

  const subjectOrder = ['english', 'maths'];
  const programsBySubject = new Map<string, ProgressProgram[]>();
  for (const program of programs) {
    const key = normalizeSpace(program.subject) || 'Other';
    const list = programsBySubject.get(key) || [];
    list.push(program);
    programsBySubject.set(key, list);
  }

  const subjects: ProgressSubjectSection[] = [...programsBySubject.entries()]
    .sort((a, b) => {
      const aIndex = subjectOrder.indexOf(normalizeLower(a[0]));
      const bIndex = subjectOrder.indexOf(normalizeLower(b[0]));
      const safeA = aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex;
      const safeB = bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex;
      if (safeA !== safeB) return safeA - safeB;
      return a[0].localeCompare(b[0]);
    })
    .map(([subject, subjectPrograms]) => ({
      key: slugify(subject),
      label: subject,
      programs: subjectPrograms.slice().sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt)),
    }));

  const fallbackStudentName = normalizeSpace(target.studentName || '') || filtered[0]?.studentName || '';
  const fallbackStudentId = normalizeSpace(target.studentId || '') || filtered[0]?.studentId || '';
  const fallbackParentEmail = normalizeSpace(target.parentEmail || '') || filtered[0]?.parentEmail || '';

  return {
    student: {
      studentId: fallbackStudentId,
      studentName: fallbackStudentName,
      parentEmail: fallbackParentEmail,
    },
    subjects,
    totalPrograms: programs.length,
    totalEvents: filtered.length,
  };
}
