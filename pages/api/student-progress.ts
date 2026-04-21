import type { NextApiRequest, NextApiResponse } from 'next';
import {
  buildStudentProgress,
  normalizeProgressRows,
  parseProgressCsv,
  resolveGoogleSheetsCsvUrl,
} from '../../lib/progress';

function normalizeSpace(value: string) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const studentId = normalizeSpace(String(req.query.studentId || ''));
  const studentName = normalizeSpace(String(req.query.studentName || ''));
  const parentEmail = normalizeSpace(String(req.query.parentEmail || ''));

  if (!studentId && !studentName) {
    return res.status(400).json({ ok: false, error: 'Missing student identifier' });
  }

  const rawUrl = process.env.FEEDBACK_PROGRESS_CSV_URL || process.env.NEXT_PUBLIC_FEEDBACK_PROGRESS_CSV_URL || '';
  const preferredSheetName = process.env.FEEDBACK_PROGRESS_SHEET_NAME || 'sentmsgs new';
  const csvUrl = resolveGoogleSheetsCsvUrl(rawUrl, preferredSheetName);

  if (!csvUrl) {
    return res.status(500).json({ ok: false, error: 'FEEDBACK_PROGRESS_CSV_URL is not configured.' });
  }

  try {
    const response = await fetch(csvUrl, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache, no-store, max-age=0, must-revalidate',
        Pragma: 'no-cache',
      },
    });

    if (!response.ok) {
      return res.status(502).json({
        ok: false,
        error: `Failed to load progress CSV (${response.status}).`,
      });
    }

    const text = await response.text();
    const parsed = parseProgressCsv(text);

    if (parsed.looksLikePrintLog) {
      return res.status(500).json({
        ok: false,
        error: 'The progress data source is pointing at a print log sheet instead of the feedback sheet.',
      });
    }

    const events = normalizeProgressRows(parsed.rows);
    const progress = buildStudentProgress(events, { studentId, studentName, parentEmail });

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      ok: true,
      progress,
      source: {
        rowCount: parsed.rows.length,
        eventCount: events.length,
        looksLikePrintLog: parsed.looksLikePrintLog,
      },
    });
  } catch (error: any) {
    console.error('student-progress error', error);
    return res.status(500).json({
      ok: false,
      error: error?.message || 'Failed to build student progress.',
    });
  }
}
