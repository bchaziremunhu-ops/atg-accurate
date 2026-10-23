import { readFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';

const TABLES = [
  'User',
  'SecurityEvent',
  'Wallet',
  'Signal',
  'Course',
  'Lesson',
  'Resource',
  'Enrollment',
  'LessonProgress',
  'Purchase',
  'Subscription',
  'Transaction',
  'TransactionStatusHistory',
  'Group',
  'GroupMember',
  'GroupPost',
  'PostLike',
  'Comment',
  'Message',
  'Notification',
  'PushSubscription',
  'WatchlistItem',
  'Certificate',
  'BrokerTransaction',
  'BrokerAuditLog',
  'BrokerBalance',
  'Setting',
  'BrokerAccount',
  'BrokerAccountEvent',
];

const FINANCIAL_FIELDS = {
  Wallet: ['balance'],
  Transaction: ['amount', 'fee', 'netAmount'],
  Purchase: ['amount'],
  BrokerTransaction: ['amount', 'feePct', 'feeAmount'],
  BrokerBalance: ['balance'],
};

function decode(value) {
  if (Array.isArray(value)) return value.map(decode);
  if (value !== null && typeof value === 'object') {
    if (Object.keys(value).length === 1 && typeof value.$atgDate === 'string') {
      const date = new Date(value.$atgDate);
      if (Number.isNaN(date.getTime())) throw new Error('Invalid snapshot date');
      return date;
    }
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, decode(entry)]));
  }
  return value;
}

function normalize(value) {
  if (value instanceof Date) return { $date: value.toISOString() };
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(value[key])]));
  }
  return value;
}

function sum(rows, field) {
  return rows.reduce((total, row) => total + (row[field] ?? 0), 0);
}

const filePath = process.argv[2];
if (!filePath) throw new Error('Usage: node scripts/verify-mysql-snapshot.mjs <snapshot.json>');
const snapshot = JSON.parse(await readFile(filePath, 'utf8'));
if (snapshot.format !== 1 || snapshot.source !== 'postgresql') {
  throw new Error('Unsupported source snapshot format');
}

const prisma = new PrismaClient();
try {
  const actualTables = {};
  await prisma.$transaction(async (tx) => {
    for (const table of TABLES) {
      const delegate = tx[table[0].toLowerCase() + table.slice(1)];
      const actual = await delegate.findMany();
      const expected = decode(snapshot.tables[table]);
      if (actual.length !== snapshot.rowCounts[table] || expected.length !== actual.length) {
        throw new Error(`Row count mismatch for ${table}`);
      }

      const primaryKey = table === 'Setting' ? 'key' : 'id';
      const actualById = new Map(actual.map((row) => [row[primaryKey], row]));
      for (const sourceRow of expected) {
        const targetRow = actualById.get(sourceRow[primaryKey]);
        if (!targetRow || JSON.stringify(normalize(targetRow)) !== JSON.stringify(normalize(sourceRow))) {
          throw new Error(`Record mismatch in ${table}; record details omitted`);
        }
      }
      actualTables[table] = actual;
    }
  }, { isolationLevel: 'RepeatableRead', maxWait: 10_000, timeout: 120_000 });

  for (const [table, fields] of Object.entries(FINANCIAL_FIELDS)) {
    for (const field of fields) {
      const sourceTotal = sum(decode(snapshot.tables[table]), field);
      const targetTotal = sum(actualTables[table], field);
      if (Math.abs(sourceTotal - targetTotal) > Math.max(1, Math.abs(sourceTotal)) * 1e-12) {
        throw new Error(`Financial aggregate mismatch for ${table}.${field}`);
      }
    }
  }

  console.log(`Exact record comparison passed for all ${TABLES.length} tables.`);
  console.log('IDs, relationships, timestamps, and preserved credential hashes match.');
  console.log('Wallet, transaction, purchase, and broker financial aggregates match.');
} finally {
  await prisma.$disconnect();
}
