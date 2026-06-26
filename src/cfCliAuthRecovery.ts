import { prepareCfCliSession } from './cfClient';
import { isRecoverableCfCliAuthError } from './cfCliAuthError';

export { isRecoverableCfCliAuthError } from './cfCliAuthError';

const CF_CLI_AUTH_RECOVERY_RETRIES = 2;

export interface CfCliAuthRecoverySession {
  readonly apiEndpoint: string;
  readonly email: string;
  readonly password: string;
  readonly orgName: string;
  readonly spaceName: string;
  readonly cfHomeDir?: string;
}

export async function runWithCfCliAuthRecovery<T>(
  session: CfCliAuthRecoverySession,
  operation: () => Promise<T>
): Promise<T> {
  let lastError: unknown = null;
  for (let retryIndex = 0; retryIndex <= CF_CLI_AUTH_RECOVERY_RETRIES; retryIndex += 1) {
    try {
      await prepareCfCliSession(buildSessionParams(session, retryIndex > 0));
      return await operation();
    } catch (error) {
      lastError = error;
      if (!shouldRetryCfCliAuth(error, retryIndex)) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Cloud Foundry CLI operation failed.');
}

function shouldRetryCfCliAuth(error: unknown, retryIndex: number): boolean {
  return (
    retryIndex < CF_CLI_AUTH_RECOVERY_RETRIES &&
    isRecoverableCfCliAuthError(error)
  );
}

function buildSessionParams(
  session: CfCliAuthRecoverySession,
  forceReauth: boolean
): {
  readonly apiEndpoint: string;
  readonly email: string;
  readonly password: string;
  readonly orgName: string;
  readonly spaceName: string;
  readonly cfHomeDir?: string;
  readonly forceReauth?: boolean;
} {
  const base = {
    apiEndpoint: session.apiEndpoint,
    email: session.email,
    password: session.password,
    orgName: session.orgName,
    spaceName: session.spaceName,
    ...(session.cfHomeDir === undefined ? {} : { cfHomeDir: session.cfHomeDir }),
  };
  return forceReauth ? { ...base, forceReauth: true } : base;
}
