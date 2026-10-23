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

const filePath = process.argv[2];
if (!filePath) throw new Error('Usage: node scripts/import-mysql-snapshot.mjs <snapshot.json>');

const snapshot = JSON.parse(await readFile(filePath, 'utf8'));
if (snapshot.format !== 1 || snapshot.source !== 'postgresql') {
  throw new Error('Unsupported source snapshot format');
}
if (
  Object.keys(snapshot.tables).length !== TABLES.length ||
  TABLES.some((table) => !Array.isArray(snapshot.tables[table]) ||
    snapshot.rowCounts[table] !== snapshot.tables[table].length)
) {
  throw new Error('Snapshot table set or row counts do not match the import whitelist');
}

const prisma = new PrismaClient();
try {
  const delegates = TABLES.map((table) => {
    const delegate = prisma[table[0].toLowerCase() + table.slice(1)];
    if (!delegate?.count || !delegate?.createMany) {
      throw new Error(`Prisma model delegate unavailable for ${table}`);
    }
    return [table, delegate];
  });

  const occupied = [];
  for (const [table, delegate] of delegates) {
    const count = await delegate.count();
    if (count !== 0) occupied.push(`${table}=${count}`);
  }
  if (occupied.length) {
    throw new Error(`Refusing to import into non-empty tables: ${occupied.join(', ')}`);
  }

  await prisma.$transaction(async (tx) => {
    for (const table of TABLES) {
      const rows = decode(snapshot.tables[table]);
      if (!rows.length) continue;
      const delegate = tx[table[0].toLowerCase() + table.slice(1)];
      const result = await delegate.createMany({ data: rows });
      if (result.count !== rows.length) {
        throw new Error(`Imported ${result.count}/${rows.length} rows for ${table}`);
      }
    }
  }, { maxWait: 10_000, timeout: 120_000 });

  for (const [table, delegate] of delegates) {
    const count = await delegate.count();
    if (count !== snapshot.rowCounts[table]) {
      throw new Error(`Post-import count mismatch for ${table}: ${count}/${snapshot.rowCounts[table]}`);
    }
    console.log(`${table}: ${count}`);
  }
  console.log(`Imported and verified ${TABLES.length} tables.`);
} finally {
  await prisma.$disconnect();
}
