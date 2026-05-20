// cspell:ignore mypw s3cret
import { describe, expect, test } from 'vitest';

import {
  HanaQueryError,
  classifyHanaSqlStatement,
  executeHanaQuery,
  executeHanaQueryBatch,
  formatHanaCellValue,
  normalizeSingleHanaStatement,
  sanitizeHanaErrorMessage,
  type HdbCallbackError,
  type HdbClient,
  type HdbExecCallback,
  type HdbRow,
  type HdbRowsOrAffected,
  type HdbStatement,
} from './hanaSqlService';

interface FakeStatementMetadata {
  readonly columnDisplayName?: string;
  readonly columnName?: string;
  readonly displayName?: string;
}

interface FakeStatementOptions {
  readonly metadata?: readonly FakeStatementMetadata[];
  readonly rowsOrAffected?: HdbRowsOrAffected;
  readonly execError?: Error;
  readonly omitSuccessError?: boolean;
}

interface FakeClientOptions {
  readonly connectError?: Error;
  readonly prepareError?: Error;
  readonly statement?: FakeStatementOptions;
  readonly disconnectError?: Error;
}

interface FakeClientCallLog {
  readonly events: string[];
}

function createFakeClient(
  options: FakeClientOptions = {}
): { client: HdbClient; log: FakeClientCallLog } {
  const events: string[] = [];
  const statementOptions = options.statement ?? {};
  const fakeStatement: HdbStatement = {
    resultSetMetadata: statementOptions.metadata,
    exec: (_values, callback: HdbExecCallback) => {
      events.push('statement.exec');
      setImmediate(() => {
        if (statementOptions.execError !== undefined) {
          callback(statementOptions.execError, 0);
          return;
        }
        if (statementOptions.omitSuccessError === true) {
          callback(undefined, statementOptions.rowsOrAffected ?? []);
          return;
        }
        callback(null, statementOptions.rowsOrAffected ?? []);
      });
    },
    drop: (callback) => {
      events.push('statement.drop');
      setImmediate(() => callback?.(null));
    },
  };

  const fakeClient = {
    connect: (callback) => {
      events.push('client.connect');
      setImmediate(() => callback(options.connectError ?? null));
    },
    exec: (sql: string, callback: HdbExecCallback) => {
      events.push(`client.exec:${sql}`);
      setImmediate(() => {
        if (statementOptions.execError !== undefined) {
          callback(statementOptions.execError, 0);
          return;
        }
        if (statementOptions.omitSuccessError === true) {
          callback(undefined, statementOptions.rowsOrAffected ?? []);
          return;
        }
        callback(null, statementOptions.rowsOrAffected ?? []);
      });
    },
    prepare: (sql, callback) => {
      events.push(`client.prepare:${sql}`);
      setImmediate(() => {
        if (options.prepareError !== undefined) {
          callback(options.prepareError, fakeStatement);
          return;
        }
        callback(null, fakeStatement);
      });
    },
    disconnect: (callback) => {
      events.push('client.disconnect');
      setImmediate(() => callback?.(options.disconnectError ?? null));
    },
    close: () => {
      events.push('client.close');
    },
    on: () => {
      // no-op
    },
  } as HdbClient & { exec(command: string, callback: HdbExecCallback): void };

  return { client: fakeClient, log: { events } };
}

describe('executeHanaQuery (rows)', () => {
  test('uses resultSetMetadata column names when provided and maps rows in column order', async () => {
    const rows: HdbRow[] = [
      { ID: 42, NAME: 'alice' },
      { ID: 7, NAME: 'bob' },
    ];
    const { client, log } = createFakeClient({
      statement: {
        metadata: [{ columnDisplayName: 'ID' }, { columnDisplayName: 'NAME' }],
        rowsOrAffected: rows,
      },
    });

    const result = await executeHanaQuery(
      { host: 'h', port: 443, user: 'u', password: 'p' },
      'SELECT ID, NAME FROM USERS',
      { clientFactory: () => client }
    );

    expect(result.kind).toBe('resultset');
    if (result.kind !== 'resultset') return;
    expect(result.columns).toEqual(['ID', 'NAME']);
    expect(result.rows).toEqual([
      ['42', 'alice'],
      ['7', 'bob'],
    ]);
    expect(result.rowCount).toBe(2);
    expect(log.events).toContain('client.connect');
    expect(log.events).toContain('client.prepare:SELECT ID, NAME FROM USERS');
    expect(log.events).toContain('statement.drop');
    expect(log.events).toContain('client.disconnect');
  });

  test('decodes text-like Buffer values while mapping rows', async () => {
    const payload =
      '{"status":"Success","message":"This is mock data for testing","timestamp":"2026-04-08T03:10:07.482Z"}';
    const rows: HdbRow[] = [{ ID: 1, PAYLOAD: Buffer.from(payload, 'utf8') }];
    const { client } = createFakeClient({
      statement: {
        metadata: [{ columnDisplayName: 'ID' }, { columnDisplayName: 'PAYLOAD' }],
        rowsOrAffected: rows,
      },
    });

    const result = await executeHanaQuery(
      { host: 'h', port: 443, user: 'u', password: 'p' },
      'SELECT ID, PAYLOAD FROM SAMPLE_MESSAGES',
      { clientFactory: () => client }
    );

    expect(result.kind).toBe('resultset');
    if (result.kind !== 'resultset') return;
    expect(result.rows).toEqual([['1', payload]]);
  });

  test('falls back to row keys when statement metadata is absent', async () => {
    const rows: HdbRow[] = [{ FOO: 1, BAR: 'x' }];
    const { client } = createFakeClient({
      statement: { rowsOrAffected: rows },
    });

    const result = await executeHanaQuery(
      { host: 'h', port: 443, user: 'u', password: 'p' },
      'SELECT FOO, BAR FROM T',
      { clientFactory: () => client }
    );

    if (result.kind !== 'resultset') throw new Error('expected resultset');
    expect(result.columns).toEqual(['FOO', 'BAR']);
    expect(result.rows).toEqual([['1', 'x']]);
  });

  test('returns empty rows array with no columns when query returns nothing and metadata is absent', async () => {
    const { client } = createFakeClient({
      statement: { rowsOrAffected: [] },
    });

    const result = await executeHanaQuery(
      { host: 'h', port: 443, user: 'u', password: 'p' },
      'SELECT 1 FROM EMPTY',
      { clientFactory: () => client }
    );

    if (result.kind !== 'resultset') throw new Error('expected resultset');
    expect(result.columns).toEqual([]);
    expect(result.rows).toEqual([]);
    expect(result.rowCount).toBe(0);
  });
});

describe('executeHanaQuery (status)', () => {
  test('renders 1 row affected message for affected count of 1', async () => {
    const { client, log } = createFakeClient({
      statement: { rowsOrAffected: 1 },
    });

    const result = await executeHanaQuery(
      { host: 'h', port: 443, user: 'u', password: 'p' },
      "UPDATE ORDERS SET STATUS = 'OPEN'",
      { clientFactory: () => client }
    );

    expect(result.kind).toBe('status');
    if (result.kind !== 'status') return;
    expect(result.message).toBe('1 row affected.');
    expect(log.events).toContain("client.exec:UPDATE ORDERS SET STATUS = 'OPEN'");
    expect(log.events).not.toContain("client.prepare:UPDATE ORDERS SET STATUS = 'OPEN'");
  });

  test('renders pluralized message for affected counts other than 1', async () => {
    const { client, log } = createFakeClient({
      statement: { rowsOrAffected: 0 },
    });

    const result = await executeHanaQuery(
      { host: 'h', port: 443, user: 'u', password: 'p' },
      'DELETE FROM ORDERS WHERE 1 = 0',
      { clientFactory: () => client }
    );

    if (result.kind !== 'status') throw new Error('expected status');
    expect(result.message).toBe('0 rows affected.');
    expect(log.events).toContain('client.exec:DELETE FROM ORDERS WHERE 1 = 0');
    expect(log.events).not.toContain('client.prepare:DELETE FROM ORDERS WHERE 1 = 0');
  });

  test('accepts direct DML success callbacks that omit the error argument', async () => {
    const { client, log } = createFakeClient({
      statement: { rowsOrAffected: 2, omitSuccessError: true },
    });

    const result = await executeHanaQuery(
      { host: 'h', port: 443, user: 'u', password: 'p' },
      "UPDATE SAMPLE_ORDERS SET STATUS = 'OPEN'",
      { clientFactory: () => client }
    );

    if (result.kind !== 'status') throw new Error('expected status');
    expect(result.message).toBe('2 rows affected.');
    expect(log.events).toContain("client.exec:UPDATE SAMPLE_ORDERS SET STATUS = 'OPEN'");
    expect(log.events).not.toContain("client.prepare:UPDATE SAMPLE_ORDERS SET STATUS = 'OPEN'");
  });
});

describe('executeHanaQuery (error mapping)', () => {
  test('maps HANA auth code 10 to auth error kind', async () => {
    const { client } = createFakeClient({
      connectError: Object.assign(new Error('authentication failed'), { code: 10 }),
    });

    await expect(
      executeHanaQuery(
        { host: 'h', port: 443, user: 'u', password: 'p' },
        'SELECT 1 FROM DUMMY',
        { clientFactory: () => client }
      )
    ).rejects.toMatchObject({
      kind: 'auth',
      message: 'authentication failed',
    });
  });

  test('maps ECONNREFUSED on connect to connection error kind', async () => {
    const error = Object.assign(new Error('connect ECONNREFUSED 1.2.3.4:443'), {
      code: 'ECONNREFUSED',
    });
    const { client } = createFakeClient({ connectError: error });

    await expect(
      executeHanaQuery(
        { host: 'h', port: 443, user: 'u', password: 'p' },
        'SELECT 1 FROM DUMMY',
        { clientFactory: () => client }
      )
    ).rejects.toMatchObject({
      kind: 'connection',
    });
  });

  test('maps SQL syntax errors during exec to sql error kind', async () => {
    const { client } = createFakeClient({
      statement: {
        execError: Object.assign(new Error('sql syntax error: incorrect syntax near "broken"'), {
          code: 257,
        }),
      },
    });

    await expect(
      executeHanaQuery(
        { host: 'h', port: 443, user: 'u', password: 'p' },
        'SELECT broken',
        { clientFactory: () => client }
      )
    ).rejects.toMatchObject({
      kind: 'sql',
      exitCode: 257,
    });
  });

  test('still drops the statement and disconnects after SQL exec error', async () => {
    const { client, log } = createFakeClient({
      statement: {
        execError: new Error('boom'),
      },
    });

    await expect(
      executeHanaQuery(
        { host: 'h', port: 443, user: 'u', password: 'p' },
        'SELECT 1',
        { clientFactory: () => client }
      )
    ).rejects.toBeInstanceOf(HanaQueryError);

    expect(log.events).toContain('statement.drop');
    expect(log.events).toContain('client.disconnect');
  });

  test('rejects empty SQL with HanaQueryError of kind empty without contacting hdb', async () => {
    let invoked = false;
    await expect(
      executeHanaQuery(
        { host: 'h', port: 443, user: 'u', password: 'p' },
        '   ;   ',
        {
          clientFactory: () => {
            invoked = true;
            const { client } = createFakeClient();
            return client;
          },
        }
      )
    ).rejects.toMatchObject({ kind: 'empty' });
    expect(invoked).toBe(false);
  });

  test('rejects multi-statement SQL before invoking the client', async () => {
    let invoked = false;
    await expect(
      executeHanaQuery(
        { host: 'h', port: 443, user: 'u', password: 'p' },
        'SELECT 1 FROM DUMMY; DROP TABLE X',
        {
          clientFactory: () => {
            invoked = true;
            const { client } = createFakeClient();
            return client;
          },
        }
      )
    ).rejects.toMatchObject({
      kind: 'sql',
      message: 'Only one SQL statement can be executed at a time.',
    });
    expect(invoked).toBe(false);
  });

  test('honors timeout when connect never resolves', async () => {
    const stalledClient: HdbClient = {
      connect: () => {
        /* never calls back */
      },
      prepare: (_sql, callback) => {
        callback(null, {
          exec: (_values, cb) => cb(null, []),
          drop: (cb) => cb?.(null),
        });
      },
      disconnect: (callback) => callback?.(null),
      close: () => {
        /* noop */
      },
    };

    await expect(
      executeHanaQuery(
        { host: 'h', port: 443, user: 'u', password: 'p' },
        'SELECT 1 FROM DUMMY',
        {
          clientFactory: () => stalledClient,
          timeoutMs: 30,
        }
      )
    ).rejects.toMatchObject({ kind: 'timeout' });
  });
});

describe('formatHanaCellValue', () => {
  test('returns empty string for null and undefined', () => {
    expect(formatHanaCellValue(null)).toBe('');
    expect(formatHanaCellValue(undefined)).toBe('');
  });

  test('passes strings through unchanged', () => {
    expect(formatHanaCellValue('hello')).toBe('hello');
  });

  test('stringifies numbers, bigints, and booleans', () => {
    expect(formatHanaCellValue(42)).toBe('42');
    expect(formatHanaCellValue(BigInt('9007199254740993'))).toBe('9007199254740993');
    expect(formatHanaCellValue(true)).toBe('true');
  });

  test('renders Date as ISO string', () => {
    const date = new Date('2026-04-25T12:34:56.000Z');
    expect(formatHanaCellValue(date)).toBe('2026-04-25T12:34:56.000Z');
  });

  test('renders UTF-8 JSON Buffer as readable text', () => {
    const payload =
      '{"status":"Success","message":"This is mock data for testing","timestamp":"2026-04-08T03:10:07.482Z"}';
    expect(formatHanaCellValue(Buffer.from(payload, 'utf8'))).toBe(payload);
  });

  test('renders multiline UTF-8 text Buffer as readable text', () => {
    expect(formatHanaCellValue(Buffer.from('first line\nsecond line\twith tab', 'utf8'))).toBe(
      'first line\nsecond line\twith tab'
    );
  });

  test('renders binary Buffer as hex prefixed with 0x', () => {
    const buffer = Buffer.from([0xab, 0xcd, 0x10]);
    expect(formatHanaCellValue(buffer)).toBe('0xabcd10');
  });

  test('renders invalid UTF-8 Buffer as hex', () => {
    const buffer = Buffer.from([0xc3, 0x28]);
    expect(formatHanaCellValue(buffer)).toBe('0xc328');
  });

  test('serializes plain objects as JSON', () => {
    expect(formatHanaCellValue({ x: 1, y: 'z' })).toBe('{"x":1,"y":"z"}');
  });
});

describe('classifyHanaSqlStatement', () => {
  test('recognizes readonly statements', () => {
    expect(classifyHanaSqlStatement('SELECT 1 FROM DUMMY')).toBe('readonly');
    expect(classifyHanaSqlStatement('  WITH x AS (SELECT 1) SELECT * FROM x')).toBe('readonly');
    expect(classifyHanaSqlStatement('-- comment\nSELECT 1')).toBe('readonly');
  });

  test('recognizes mutating statements', () => {
    expect(classifyHanaSqlStatement("UPDATE ORDERS SET STATUS = 'OPEN'")).toBe('mutating');
    expect(classifyHanaSqlStatement('DELETE FROM ORDERS')).toBe('mutating');
    expect(classifyHanaSqlStatement('CREATE TABLE T (ID INT)')).toBe('mutating');
  });

  test('recognizes empty statements', () => {
    expect(classifyHanaSqlStatement('   ')).toBe('empty');
    expect(classifyHanaSqlStatement('-- only comment\n')).toBe('empty');
  });
});

describe('normalizeSingleHanaStatement', () => {
  test('strips trailing semicolon and whitespace', () => {
    expect(normalizeSingleHanaStatement('SELECT 1 ;  ')).toBe('SELECT 1');
  });

  test('returns empty string for blank input', () => {
    expect(normalizeSingleHanaStatement('   ')).toBe('');
    expect(normalizeSingleHanaStatement(';')).toBe('');
  });

  test('throws sql error for multiple statements outside literals', () => {
    expect(() => normalizeSingleHanaStatement('SELECT 1; SELECT 2')).toThrowError(
      /one SQL statement/
    );
  });

  test('does not flag semicolons inside string literals', () => {
    expect(normalizeSingleHanaStatement("SELECT 'a;b' FROM DUMMY")).toBe(
      "SELECT 'a;b' FROM DUMMY"
    );
  });
});

describe('sanitizeHanaErrorMessage', () => {
  test('redacts inline secrets passed by the caller', () => {
    expect(sanitizeHanaErrorMessage('login failed for s3cret', ['s3cret'])).toBe(
      'login failed for [redacted]'
    );
  });

  test('redacts password=value patterns even without an explicit secret list', () => {
    expect(sanitizeHanaErrorMessage('connect: password=mypw failed')).toBe(
      'connect: password=[redacted] failed'
    );
  });
});

describe('HanaQueryError', () => {
  test('stores kind and exit code', () => {
    const err = new HanaQueryError('connection', 'refused', 42);

    expect(err.kind).toBe('connection');
    expect(err.exitCode).toBe(42);
    expect(err.message).toBe('refused');
    expect(err.name).toBe('HanaQueryError');
  });

  test('defaults exit code to null', () => {
    const err = new HanaQueryError('auth', 'bad password');

    expect(err.exitCode).toBeNull();
  });
});

interface BatchStatementBehavior {
  readonly metadata?: readonly FakeStatementMetadata[];
  readonly rowsOrAffected?: HdbRowsOrAffected;
  readonly execError?: Error;
}

interface BatchClientOptions {
  readonly connectError?: Error;
  readonly commitError?: Error;
  readonly rollbackError?: Error;
  readonly behaviorBySql?: ReadonlyMap<string, BatchStatementBehavior>;
  readonly defaultBehavior?: BatchStatementBehavior;
  readonly omitTransactionApis?: boolean;
}

function createBatchFakeClient(
  options: BatchClientOptions = {}
): { client: HdbClient; log: FakeClientCallLog; autoCommitState: { current: boolean } } {
  const events: string[] = [];
  const autoCommitState = { current: true };

  function resolveBehavior(sql: string): BatchStatementBehavior {
    return options.behaviorBySql?.get(sql) ?? options.defaultBehavior ?? { rowsOrAffected: [] };
  }

  function buildStatement(sql: string): HdbStatement {
    const behavior = resolveBehavior(sql);
    return {
      resultSetMetadata: behavior.metadata,
      exec: (_values, callback: HdbExecCallback) => {
        events.push(`statement.exec:${sql}`);
        setImmediate(() => {
          if (behavior.execError !== undefined) {
            callback(behavior.execError, 0);
            return;
          }
          callback(null, behavior.rowsOrAffected ?? []);
        });
      },
      drop: (callback) => {
        events.push(`statement.drop:${sql}`);
        setImmediate(() => callback?.(null));
      },
    };
  }

  const client = {
    connect: (callback) => {
      events.push('client.connect');
      setImmediate(() => callback(options.connectError ?? null));
    },
    exec: (sql: string, callback: HdbExecCallback) => {
      events.push(`client.exec:${sql}`);
      const behavior = resolveBehavior(sql);
      setImmediate(() => {
        if (behavior.execError !== undefined) {
          callback(behavior.execError, 0);
          return;
        }
        callback(null, behavior.rowsOrAffected ?? []);
      });
    },
    prepare: (sql, callback) => {
      events.push(`client.prepare:${sql}`);
      setImmediate(() => callback(null, buildStatement(sql)));
    },
    disconnect: (callback) => {
      events.push('client.disconnect');
      setImmediate(() => callback?.(null));
    },
    close: () => {
      events.push('client.close');
    },
    on: () => undefined,
  } as HdbClient & { exec(command: string, callback: HdbExecCallback): void };

  if (options.omitTransactionApis !== true) {
    Object.assign(client, {
      setAutoCommit: (autoCommit: boolean): void => {
        autoCommitState.current = autoCommit;
        events.push(`client.setAutoCommit:${autoCommit ? 'on' : 'off'}`);
      },
      commit: (callback: (err: HdbCallbackError) => void): void => {
        events.push('client.commit');
        setImmediate(() => callback(options.commitError ?? null));
      },
      rollback: (callback: (err: HdbCallbackError) => void): void => {
        events.push('client.rollback');
        setImmediate(() => callback(options.rollbackError ?? null));
      },
    });
  }

  return { client, log: { events }, autoCommitState };
}

describe('executeHanaQueryBatch', () => {
  test('returns an empty error when no statements are provided', async () => {
    const { client } = createBatchFakeClient();
    await expect(
      executeHanaQueryBatch(
        { host: 'h', port: 443, user: 'u', password: 'p' },
        [],
        { clientFactory: () => client }
      )
    ).rejects.toMatchObject({ kind: 'empty' });
  });

  test('runs all readonly statements on a single connection without a transaction', async () => {
    const { client, log, autoCommitState } = createBatchFakeClient({
      defaultBehavior: { rowsOrAffected: [{ ID: 1 }] },
    });

    const summary = await executeHanaQueryBatch(
      { host: 'h', port: 443, user: 'u', password: 'p' },
      [
        { sql: 'SELECT 1 FROM DUMMY', statementKind: 'readonly' },
        { sql: 'SELECT 2 FROM DUMMY', statementKind: 'readonly' },
      ],
      { clientFactory: () => client }
    );

    expect(summary.outcomes).toHaveLength(2);
    expect(summary.outcomes.every((outcome) => outcome.status === 'success')).toBe(true);
    expect(summary.usedTransaction).toBe(false);
    expect(summary.committed).toBe(false);
    expect(autoCommitState.current).toBe(true);
    expect(log.events.filter((event) => event === 'client.connect')).toHaveLength(1);
    expect(log.events.filter((event) => event === 'client.disconnect')).toHaveLength(1);
    expect(log.events).not.toContain('client.commit');
    expect(log.events).not.toContain('client.rollback');
  });

  test('wraps mutating statements in a transaction and commits on success', async () => {
    const { client, log, autoCommitState } = createBatchFakeClient({
      defaultBehavior: { rowsOrAffected: 1 },
    });

    const summary = await executeHanaQueryBatch(
      { host: 'h', port: 443, user: 'u', password: 'p' },
      [
        { sql: "UPDATE T SET X = 1 WHERE ID = 1", statementKind: 'mutating' },
        { sql: "UPDATE T SET X = 2 WHERE ID = 2", statementKind: 'mutating' },
      ],
      { clientFactory: () => client }
    );

    expect(summary.usedTransaction).toBe(true);
    expect(summary.committed).toBe(true);
    expect(summary.rolledBack).toBe(false);
    expect(summary.outcomes.every((outcome) => outcome.status === 'success')).toBe(true);
    expect(autoCommitState.current).toBe(false);
    expect(log.events).toContain('client.setAutoCommit:off');
    expect(log.events).toContain('client.commit');
    expect(log.events).not.toContain('client.rollback');
  });

  test('rolls back the transaction and marks remaining statements as skipped when one fails', async () => {
    const behaviorBySql = new Map<string, BatchStatementBehavior>([
      ["UPDATE T SET X = 1", { rowsOrAffected: 1 }],
      [
        "UPDATE T SET X = 'bad'",
        { execError: Object.assign(new Error('boom'), { code: 257 }) },
      ],
      ["UPDATE T SET X = 3", { rowsOrAffected: 1 }],
    ]);
    const { client, log } = createBatchFakeClient({ behaviorBySql });
    const progress: { index: number; status: string }[] = [];

    const summary = await executeHanaQueryBatch(
      { host: 'h', port: 443, user: 'u', password: 'p' },
      [
        { sql: 'UPDATE T SET X = 1', statementKind: 'mutating' },
        { sql: "UPDATE T SET X = 'bad'", statementKind: 'mutating' },
        { sql: 'UPDATE T SET X = 3', statementKind: 'mutating' },
      ],
      {
        clientFactory: () => client,
        onStatementComplete: (index, outcome) => {
          progress.push({ index, status: outcome.status });
        },
      }
    );

    expect(summary.usedTransaction).toBe(true);
    expect(summary.committed).toBe(false);
    expect(summary.rolledBack).toBe(true);
    expect(summary.outcomes.map((outcome) => outcome.status)).toEqual([
      'success',
      'error',
      'skipped',
    ]);
    expect(summary.outcomes[1]?.errorMessage).toBe('boom');
    expect(progress.map((entry) => entry.status)).toEqual(['success', 'error', 'skipped']);
    expect(log.events).toContain('client.rollback');
    expect(log.events).not.toContain('client.commit');
  });

  test('runs without a transaction when the HDB client omits transaction APIs and the batch is mutating', async () => {
    const { client, log } = createBatchFakeClient({
      omitTransactionApis: true,
      defaultBehavior: { rowsOrAffected: 1 },
    });

    const summary = await executeHanaQueryBatch(
      { host: 'h', port: 443, user: 'u', password: 'p' },
      [
        { sql: 'UPDATE T SET X = 1', statementKind: 'mutating' },
      ],
      { clientFactory: () => client }
    );

    expect(summary.usedTransaction).toBe(false);
    expect(summary.transactionUnavailableReason).toMatch(/transaction/i);
    expect(log.events).not.toContain('client.commit');
    expect(log.events).not.toContain('client.rollback');
  });
});
