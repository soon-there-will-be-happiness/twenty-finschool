#!/usr/bin/env node
/**
 * FinSchool → Twenty SSO bridge (listen 127.0.0.1:3099 inside compose / host-mapped).
 *
 * POST /enter         { email, password?, firstName?, lastName? }
 * POST /sync-password { email, password, firstName?, lastName? }
 * GET  /healthz
 */
const http = require('http');
const crypto = require('crypto');
const { Client } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const LISTEN = process.env.SSO_BRIDGE_LISTEN || '0.0.0.0';
const PORT = Number(process.env.SSO_BRIDGE_PORT || 3099);
const CRM_ORIGIN = process.env.CRM_ORIGIN || 'https://crm.finschool.pro';
const WORKSPACE_ID = process.env.TWENTY_WORKSPACE_ID || '';
const INVITE_HASH = process.env.TWENTY_INVITE_HASH || '';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '';
const PG = {
  host: process.env.PG_DATABASE_HOST || 'db',
  port: Number(process.env.PG_DATABASE_PORT || 5432),
  user: process.env.PG_DATABASE_USER || 'postgres',
  password: process.env.PG_DATABASE_PASSWORD || 'postgres',
  database: process.env.PG_DATABASE_NAME || 'default',
};
const TWENTY_META = process.env.TWENTY_METADATA_URL || 'http://server:3000/metadata';

const V2_PREFIX = 'enc:v2:';
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;
const HKDF_INFO = 'twenty:enc:v2:';
const INSTANCE_CTX = 'instance';
const ZERO_SALT = Buffer.alloc(32);

function deriveGcmKey(rawKey, workspaceId) {
  return Buffer.from(
    crypto.hkdfSync(
      'sha256',
      Buffer.from(rawKey),
      ZERO_SALT,
      Buffer.from(`${HKDF_INFO}${workspaceId ?? INSTANCE_CTX}`),
      KEY_LEN,
    ),
  );
}

function decryptV2(value, rawKey) {
  const rest = value.slice(V2_PREFIX.length);
  const sep = rest.indexOf(':');
  const keyId = rest.slice(0, sep);
  const payloadBase64 = rest.slice(sep + 1);
  const expectedId = crypto.createHash('sha256').update(rawKey).digest('hex').slice(0, 8);
  if (keyId !== expectedId) throw new Error(`keyId mismatch ${keyId} vs ${expectedId}`);
  const buffer = Buffer.from(payloadBase64, 'base64');
  const iv = buffer.subarray(0, IV_LEN);
  const authTag = buffer.subarray(buffer.length - TAG_LEN);
  const ciphertext = buffer.subarray(IV_LEN, buffer.length - TAG_LEN);
  const key = deriveGcmKey(rawKey, undefined);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

async function withDb(fn) {
  const client = new Client(PG);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function getWorkspace(client) {
  if (WORKSPACE_ID && INVITE_HASH) {
    return { id: WORKSPACE_ID, inviteHash: INVITE_HASH };
  }
  const { rows } = await client.query(
    `SELECT id, "inviteHash" FROM core.workspace WHERE "activationStatus"='ACTIVE' ORDER BY "createdAt" ASC LIMIT 1`,
  );
  if (!rows[0]) throw new Error('no_active_workspace');
  return { id: rows[0].id, inviteHash: rows[0].inviteHash };
}

async function getSigningMaterial(client) {
  const { rows } = await client.query(
    `SELECT id, "privateKey" FROM core."signingKey" WHERE "isCurrent"=true LIMIT 1`,
  );
  if (!rows[0]) throw new Error('no current signing key');
  return { id: rows[0].id, pem: decryptV2(rows[0].privateKey, ENCRYPTION_KEY) };
}

async function mintLoginToken(client, email, workspaceId) {
  const { id, pem } = await getSigningMaterial(client);
  return jwt.sign(
    {
      type: 'LOGIN',
      sub: email.toLowerCase(),
      workspaceId,
      authProvider: 'password',
      jti: crypto.randomUUID(),
    },
    pem,
    { algorithm: 'ES256', expiresIn: '5m', keyid: id },
  );
}

async function findUserId(client, email) {
  const { rows } = await client.query(
    `SELECT id FROM core."user" WHERE email=$1 AND "deletedAt" IS NULL LIMIT 1`,
    [email.toLowerCase()],
  );
  return rows[0]?.id || '';
}

async function ensureMembership(client, userId, workspaceId) {
  const { rows } = await client.query(
    `SELECT id FROM core."userWorkspace" WHERE "userId"=$1 AND "workspaceId"=$2 AND "deletedAt" IS NULL LIMIT 1`,
    [userId, workspaceId],
  );
  if (rows[0]) return rows[0].id;
  const inserted = await client.query(
    `INSERT INTO core."userWorkspace" (id, "userId", "workspaceId", locale, "createdAt", "updatedAt")
     VALUES (uuid_generate_v4(), $1, $2, 'ru-RU', now(), now()) RETURNING id`,
    [userId, workspaceId],
  );
  return inserted.rows[0].id;
}

function metadata(query, variables) {
  const body = JSON.stringify({ query, variables });
  const url = new URL(TWENTY_META);
  const lib = url.protocol === 'https:' ? require('https') : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(d));
          } catch (e) {
            reject(new Error(d.slice(0, 300)));
          }
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function ensureUser(client, { email, password, firstName, lastName }) {
  email = email.toLowerCase().trim();
  const workspace = await getWorkspace(client);
  let userId = await findUserId(client, email);
  if (userId) {
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      await client.query(
        `UPDATE core."user" SET "passwordHash"=$1, "isEmailVerified"=true,
         "firstName"=COALESCE(NULLIF($2,''), "firstName"),
         "lastName"=COALESCE(NULLIF($3,''), "lastName"),
         locale='ru-RU', "updatedAt"=now() WHERE id=$4`,
        [hash, firstName || '', lastName || '', userId],
      );
    }
    await ensureMembership(client, userId, workspace.id);
    return { userId, created: false, workspaceId: workspace.id };
  }
  if (!password) throw new Error('user_not_in_crm_need_password');

  const result = await metadata(
    `mutation($email:String!, $password:String!, $workspaceInviteHash:String, $locale:String) {
      signUpInWorkspace(email:$email, password:$password, workspaceInviteHash:$workspaceInviteHash, locale:$locale) {
        loginToken { token }
        user { id email }
      }
    }`,
    {
      email,
      password,
      workspaceInviteHash: workspace.inviteHash,
      locale: 'ru-RU',
    },
  );

  userId = result.data?.signUpInWorkspace?.user?.id || (await findUserId(client, email));
  if (!userId) {
    const hash = await bcrypt.hash(password, 10);
    const inserted = await client.query(
      `INSERT INTO core."user" (id, email, "firstName", "lastName", "passwordHash", "isEmailVerified", locale, "canImpersonate", "canAccessFullAdminPanel", "createdAt", "updatedAt")
       VALUES (uuid_generate_v4(), $1, $2, $3, $4, true, 'ru-RU', false, false, now(), now())
       RETURNING id`,
      [email, firstName || '', lastName || '', hash],
    );
    userId = inserted.rows[0]?.id;
    if (!userId) {
      throw new Error('create_failed: ' + JSON.stringify(result.errors || result).slice(0, 400));
    }
  }
  await ensureMembership(client, userId, workspace.id);
  await client.query(
    `UPDATE core."user" SET "isEmailVerified"=true, locale='ru-RU',
     "firstName"=COALESCE(NULLIF($1,''), "firstName"),
     "lastName"=COALESCE(NULLIF($2,''), "lastName")
     WHERE id=$3`,
    [firstName || '', lastName || '', userId],
  );
  return {
    userId,
    created: true,
    workspaceId: workspace.id,
    loginToken: result.data?.signUpInWorkspace?.loginToken?.token,
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => {
      try {
        resolve(d ? JSON.parse(d) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/healthz') {
      return send(res, 200, { status: 'ok' });
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
    const data = await readBody(req);
    const email = (data.email || '').toLowerCase().trim();
    if (!email.includes('@')) return send(res, 400, { error: 'email_required' });

    if (req.url === '/sync-password') {
      if (!data.password) return send(res, 400, { error: 'password_required' });
      const out = await withDb((client) => ensureUser(client, data));
      return send(res, 200, { ok: true, ...out });
    }
    if (req.url === '/enter') {
      const out = await withDb(async (client) => {
        const workspace = await getWorkspace(client);
        const existing = await findUserId(client, email);
        if (!existing) {
          if (!data.password) throw new Error('user_not_in_crm_need_password');
          await ensureUser(client, data);
        } else if (data.password) {
          await ensureUser(client, data);
        } else {
          await ensureMembership(client, existing, workspace.id);
        }
        const loginToken = await mintLoginToken(client, email, workspace.id);
        const verifyUrl = `${CRM_ORIGIN}/verify?loginToken=${encodeURIComponent(loginToken)}&email=${encodeURIComponent(email)}`;
        return { loginToken, verifyUrl, workspaceId: workspace.id };
      });
      return send(res, 200, { ok: true, ...out });
    }
    return send(res, 404, { error: 'not_found' });
  } catch (e) {
    const msg = String(e.message || e);
    console.error(e);
    const code = msg.includes('user_not_in_crm_need_password') ? 409 : 500;
    return send(res, code, { error: msg });
  }
});

if (!ENCRYPTION_KEY) {
  console.error('ENCRYPTION_KEY is required');
  process.exit(1);
}

server.listen(PORT, LISTEN, () => {
  console.log(`twenty-sso-bridge on ${LISTEN}:${PORT}`);
});
