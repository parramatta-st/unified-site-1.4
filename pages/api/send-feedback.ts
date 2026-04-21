import type { NextApiRequest, NextApiResponse } from 'next';
import nodemailer from 'nodemailer';
import Papa from 'papaparse';

type ContactRow = {
  id?: string;
  firstName?: string;
  lastName?: string;
  gender?: string;
  parentName?: string;
  parentEmail?: string;
  years?: string;
  pronouns?: string;
  Name?: string;
  Email?: string;
  Year?: string;
  Gender?: string;
  Pronouns?: string;
  ParentName?: string;
  ParentEmail?: string;
};

type LookupArgs = {
  studentId?: string;
  studentName?: string;
  parentEmail?: string;
};

type FeedbackMeta = {
  campusKey?: string;
  campusName?: string;
  tutorName?: string;
  studentId?: string;
  studentName?: string;
  studentFirstName?: string;
  studentLastName?: string;
  studentYear?: string;
  parentName?: string;
  parentEmail?: string;
  mode?: string;
  feedbackType?: string;
  programKey?: string;
  programLabel?: string;
  templateIndex?: number | null;
  lessonNumber?: string;
  assessmentName?: string;
  completionStatus?: string;
  sourceForm?: string;
  year?: string;
  subject?: string;
  strand?: string;
  lesson?: string;
  topic?: string;
  subjectLine?: string;
};

function normalizeSpace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeLower(value: string) {
  return normalizeSpace(value).toLowerCase();
}

function extractContact(row: ContactRow) {
  const first = normalizeSpace(row.firstName || '');
  const last = normalizeSpace(row.lastName || '');
  const full = normalizeSpace(`${first} ${last}`) || normalizeSpace(row.Name || '');
  const parentEmail = normalizeSpace(row.parentEmail || row.ParentEmail || row.Email || '');
  const id = normalizeSpace(row.id || '');
  return {
    id: id || undefined,
    first,
    full,
    parentEmail,
  };
}

async function lookupParentEmail(args: LookupArgs): Promise<string | undefined> {
  const directEmail = normalizeSpace(args.parentEmail || '');
  if (directEmail) return directEmail;

  const contacts = process.env.NEXT_PUBLIC_CONTACTS_CSV_URL;
  if (!contacts) return undefined;

  const res = await fetch(contacts);
  if (!res.ok) return undefined;

  const text = await res.text();
  const parsed = Papa.parse<ContactRow>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => normalizeSpace(header),
  });

  const rows = (parsed.data || []).map(extractContact);
  const studentId = normalizeSpace(args.studentId || '');
  const target = normalizeLower(args.studentName || '');

  if (studentId) {
    const exactId = rows.find((row) => row.id && row.id === studentId && row.parentEmail);
    if (exactId?.parentEmail) return exactId.parentEmail;
  }

  if (!target) return undefined;

  const exactFull = rows.find((row) => row.full && normalizeLower(row.full) === target && row.parentEmail);
  if (exactFull?.parentEmail) return exactFull.parentEmail;

  const exactFirst = rows.find((row) => row.first && normalizeLower(row.first) === target && row.parentEmail);
  if (exactFirst?.parentEmail) return exactFirst.parentEmail;

  return undefined;
}

function deriveFeedbackType(meta: FeedbackMeta) {
  const explicit = normalizeSpace(meta.feedbackType || '').toLowerCase();
  if (explicit) return explicit;

  const lesson = normalizeLower(meta.lesson || '');
  if (lesson === 'assessment') return 'assessment';
  if (normalizeLower(meta.mode || '') === 'custom') return 'custom';
  return 'curriculum_lesson';
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const { toName, subject, text, meta } = (req.body || {}) as {
    toName?: string;
    subject?: string;
    text?: string;
    meta?: FeedbackMeta;
  };

  if (!toName || !subject || !text) {
    return res.status(400).json({ ok: false, error: 'Missing fields' });
  }

  const toEmail = await lookupParentEmail({
    studentId: meta?.studentId,
    studentName: meta?.studentName || toName,
    parentEmail: meta?.parentEmail,
  });
  if (!toEmail) {
    return res.status(400).json({ ok: false, error: 'Parent email not found for selected student' });
  }

  const user = process.env.MAIL_USER || '';
  const pass = process.env.MAIL_PASS || '';
  const replyTo = process.env.REPLY_TO || user;
  const campusName = process.env.NEXT_PUBLIC_CAMPUS_NAME || 'Success Tutoring Parramatta';

  if (!user || !pass) {
    return res.status(500).json({ ok: false, error: 'MAIL_USER/PASS not configured' });
  }

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass },
    });

    const from = `${campusName} <${user}>`;

    const info = await transporter.sendMail({
      from,
      to: toEmail,
      replyTo,
      subject,
      text,
    });

    const feedbackWebhook = (process.env.FEEDBACK_LOG_WEBHOOK_URL || '').trim();
    const printWebhook = (process.env.PRINT_LOG_WEBHOOK_URL || '').trim();
    let logWarning = '';

    if (feedbackWebhook && printWebhook && feedbackWebhook === printWebhook) {
      logWarning = 'Feedback log webhook matches PRINT_LOG_WEBHOOK_URL. Feedback email was sent, but logging was skipped to prevent writing into the print log sheet.';
      console.error(logWarning);
    }

    if (feedbackWebhook && !logWarning) {
      const studentName = normalizeSpace(meta?.studentName || toName);
      const studentFirstName = normalizeSpace(meta?.studentFirstName || studentName.split(' ')[0] || '');
      const feedbackType = deriveFeedbackType(meta || {});
      const completionStatus = normalizeSpace(meta?.completionStatus || (feedbackType === 'assessment' ? 'completed' : feedbackType === 'custom' ? '' : 'in_progress'));

      const payload = {
        kind: 'feedback',
        timestamp: new Date().toISOString(),
        campusKey: meta?.campusKey || 'parramatta',
        campusName: meta?.campusName || campusName,
        tutorName: meta?.tutorName || '',
        studentId: meta?.studentId || '',
        studentName,
        studentFirstName,
        studentLastName: meta?.studentLastName || '',
        studentYear: meta?.studentYear || '',
        parentName: meta?.parentName || '',
        parentEmail: toEmail,
        mode: meta?.mode || '',
        feedbackType,
        programKey: meta?.programKey || '',
        programLabel: meta?.programLabel || '',
        templateIndex: meta?.templateIndex ?? '',
        lessonNumber: meta?.lessonNumber || '',
        assessmentName: meta?.assessmentName || '',
        completionStatus,
        sourceForm: meta?.sourceForm || 'feedback',
        year: meta?.year || '',
        subject: meta?.subject || '',
        strand: meta?.strand || '',
        lesson: meta?.lesson || '',
        topic: meta?.topic || '',
        subjectLine: meta?.subjectLine || subject,
        messageId: info?.messageId || '',
      };

      try {
        const logRes = await fetch(feedbackWebhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!logRes.ok) {
          logWarning = `Feedback email was sent, but logging failed (${logRes.status}).`;
          console.error('Feedback logging failed', await logRes.text());
        }
      } catch (err) {
        logWarning = 'Feedback email was sent, but logging failed.';
        console.error('Feedback logging error', err);
      }
    }

    return res.status(200).json({ ok: true, logWarning: logWarning || undefined });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || 'send failed' });
  }
}
