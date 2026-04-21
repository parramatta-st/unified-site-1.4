import { useEffect, useMemo, useState } from 'react';
import Header from '../components/Header';
import StudentPicker, { type StudentPickerValue } from '../components/StudentPicker';
import useAuthGuard from '../hooks/useAuthGuard';

type ProgressProgramStatus = 'in_progress' | 'completed' | 'moved_on_without_assessment';

type ProgressProgramEvent = {
  id: string;
  kind: 'lesson' | 'assessment';
  label: string;
  topic: string;
  tutorName: string;
  timestampIso: string;
  timestampLabel: string;
};

type ProgressProgram = {
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

type ProgressSubjectSection = {
  key: string;
  label: string;
  programs: ProgressProgram[];
};

type ProgressResponse = {
  ok: boolean;
  error?: string;
  progress?: {
    student: {
      studentId: string;
      studentName: string;
      parentEmail: string;
    };
    subjects: ProgressSubjectSection[];
    totalPrograms: number;
    totalEvents: number;
  };
};

const subjectDisplayOrder = ['English', 'Maths'];

function formatStatus(status: ProgressProgramStatus) {
  switch (status) {
    case 'completed':
      return 'Completed';
    case 'moved_on_without_assessment':
      return 'Moved On Without Assessment';
    default:
      return 'In Progress';
  }
}

function formatEventDate(value: string) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';

  if (trimmed.includes('/')) {
    return trimmed.split(/\s+/)[0] || trimmed;
  }

  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return trimmed;
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Australia/Sydney',
  }).format(new Date(parsed));
}

function buildOrderedSubjects(subjects: ProgressSubjectSection[]) {
  const byKey = new Map(subjects.map((subject) => [subject.label, subject]));
  const ordered: ProgressSubjectSection[] = [];

  for (const label of subjectDisplayOrder) {
    ordered.push(byKey.get(label) || { key: label.toLowerCase(), label, programs: [] });
    byKey.delete(label);
  }

  const remaining = [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label));
  return ordered.concat(remaining);
}

export default function ProgressPage() {
  useAuthGuard();

  const [student, setStudent] = useState('');
  const [selectedStudent, setSelectedStudent] = useState<StudentPickerValue | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<ProgressResponse['progress'] | null>(null);
  const [openPrograms, setOpenPrograms] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!selectedStudent) {
      setProgress(null);
      setError('');
      setOpenPrograms({});
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams();
    if (selectedStudent.id) params.set('studentId', selectedStudent.id);
    if (selectedStudent.name) params.set('studentName', selectedStudent.name);
    if (selectedStudent.email) params.set('parentEmail', selectedStudent.email);

    setLoading(true);
    setError('');

    fetch(`/api/student-progress?${params.toString()}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        const json = (await response.json().catch(() => ({}))) as ProgressResponse;
        if (!response.ok || !json.ok) {
          throw new Error(json.error || 'Failed to load student progress.');
        }
        setProgress(json.progress || null);
        setOpenPrograms({});
      })
      .catch((fetchError: any) => {
        if (fetchError?.name === 'AbortError') return;
        setProgress(null);
        setError(fetchError?.message || 'Failed to load student progress.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [selectedStudent]);

  const orderedSubjects = useMemo(() => buildOrderedSubjects(progress?.subjects || []), [progress?.subjects]);

  const toggleProgram = (programId: string) => {
    setOpenPrograms((current) => ({
      ...current,
      [programId]: !current[programId],
    }));
  };

  return (
    <div>
      <Header />
      <main className="container">
        <div className="card progress-shell">
          <div className="progress-hero">
            <div>
              <h2 className="section-title">Student Progress</h2>
              <p className="text-muted progress-lead">
                Search for a student to see English and Maths progress grouped by topic and year.
              </p>
            </div>
          </div>

          <div className="progress-picker mt-4">
            <label className="label">Student</label>
            <StudentPicker
              value={student}
              onChange={(value) => {
                setStudent(value);
                if (selectedStudent && value !== selectedStudent.name) {
                  setSelectedStudent(null);
                }
              }}
              onStudentPick={setSelectedStudent}
              required
            />
          </div>

          {selectedStudent && (
            <div className="progress-selected mt-4">
              <div>
                <strong>{selectedStudent.name}</strong>
                <span className="text-muted"> {selectedStudent.year ? `• ${selectedStudent.year}` : ''}</span>
              </div>
              {progress && (
                <div className="text-muted text-sm">
                  {progress.totalPrograms} topic{progress.totalPrograms === 1 ? '' : 's'} · {progress.totalEvents} logged item{progress.totalEvents === 1 ? '' : 's'}
                </div>
              )}
            </div>
          )}

          {loading && (
            <div className="progress-empty mt-6">
              <div className="progress-loading-dot" aria-hidden="true" />
              <span>Loading progress…</span>
            </div>
          )}

          {!loading && error && (
            <div className="progress-error mt-6">
              {error}
            </div>
          )}

          {!loading && !error && !selectedStudent && (
            <div className="progress-empty mt-6">
              Choose a student to load their progress.
            </div>
          )}

          {!loading && !error && selectedStudent && progress && (
            <div className="progress-sections mt-6">
              {orderedSubjects.map((subject) => (
                <section key={subject.key} className="progress-subject-block">
                  <div className="progress-subject-header">
                    <h3>{subject.label}</h3>
                    <span className="text-muted text-sm">
                      {subject.programs.length} topic{subject.programs.length === 1 ? '' : 's'}
                    </span>
                  </div>

                  {subject.programs.length === 0 ? (
                    <div className="progress-empty-card">
                      No {subject.label} progress has been logged for this student yet.
                    </div>
                  ) : (
                    <div className="progress-program-list">
                      {subject.programs.map((program) => {
                        const isOpen = !!openPrograms[program.id];
                        return (
                          <article key={program.id} className="progress-program-card">
                            <button
                              type="button"
                              className="progress-program-summary"
                              onClick={() => toggleProgram(program.id)}
                              aria-expanded={isOpen}
                            >
                              <div className="progress-program-main">
                                <div className="progress-program-title-row">
                                  <span className="progress-program-title">{program.title}</span>
                                  <span className="progress-year-chip">{program.year}</span>
                                </div>
                              </div>
                              <div className="progress-program-summary-right">
                                <span className={`progress-status-badge status-${program.status}`}>
                                  {formatStatus(program.status)}
                                </span>
                                <span className={`progress-chevron ${isOpen ? 'open' : ''}`} aria-hidden="true">
                                  ▾
                                </span>
                              </div>
                            </button>

                            {isOpen && (
                              <div className="progress-program-body">
                                <div className="progress-events-header">
                                  <span>Progress history</span>
                                  <span className="text-muted text-sm">Ordered by lesson, with assessment at the end.</span>
                                </div>

                                <div className="progress-events-list">
                                  {program.events.map((event) => (
                                    <div key={event.id} className="progress-event-row">
                                      <div className="progress-event-left">
                                        <div className="progress-event-label-row">
                                          <span className={`progress-event-kind ${event.kind === 'assessment' ? 'assessment' : 'lesson'}`}>
                                            {event.label}
                                          </span>
                                          <span className="progress-event-topic">{event.topic}</span>
                                        </div>
                                        <div className="progress-event-meta">
                                          <span>Tutor: {event.tutorName || '—'}</span>
                                        </div>
                                      </div>
                                      <div className="progress-event-date">
                                        {formatEventDate(event.timestampLabel || event.timestampIso)}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  )}
                </section>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
