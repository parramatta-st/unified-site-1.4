import type { NextApiRequest, NextApiResponse } from 'next';
import { serialize } from 'cookie';

function shouldUseSecureCookie(req: NextApiRequest) {
  return req.headers['x-forwarded-proto'] === 'https' || process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const { tutor, password } = req.body || {};
  const expected = process.env.TUTOR_PASSWORD || '';

  if (!tutor || !password) {
    return res.status(400).json({ ok: false, error: 'Missing tutor or password' });
  }

  if (expected && password !== expected) {
    return res.status(401).json({ ok: false, error: 'Incorrect password' });
  }

  const cookie = serialize('st_auth', '1', {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: shouldUseSecureCookie(req),
    maxAge: 60 * 60 * 24 * 30,
  });

  res.setHeader('Set-Cookie', cookie);
  return res.status(200).json({ ok: true });
}
