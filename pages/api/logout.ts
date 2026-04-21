import type { NextApiRequest, NextApiResponse } from 'next';
import { serialize } from 'cookie';

function shouldUseSecureCookie(req: NextApiRequest) {
  return req.headers['x-forwarded-proto'] === 'https' || process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const cookie = serialize('st_auth', '', {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: shouldUseSecureCookie(req),
    maxAge: 0,
    expires: new Date(0),
  });

  res.setHeader('Set-Cookie', cookie);
  return res.status(200).json({ ok: true });
}
